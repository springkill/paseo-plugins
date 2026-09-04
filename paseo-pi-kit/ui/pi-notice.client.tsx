/**
 * Pi 通知卡片。
 *
 * 替掉时间线上那几段裸文本：`<background-task-notification>` XML、
 * "Subagent needs a supervisor decision."、以及最难看的那种 ——
 * workflow 完成通知里被 `JSON.stringify` 转义过、又被硬截断的返回值预览。
 *
 * 结构见 `docs/pi-message-formats.md`。
 *
 * 设计取向：**卡片只放人当下要判断的东西**。
 *
 * - 后台任务：名字 + 终态 + 退出码。输出路径次要，小字。
 * - workflow / 完成：终态 + 每个子任务各自的输出，而不是一坨 JSON。
 * - 需要关注：留警示色（长跑 / 卡住值得一眼看到），但不给强调边框 ——
 *   它是发给父 agent 的，不是你的待办。
 * - 进度更新 / 抓取完成：最轻，一行带过。
 * - 仅模型可见（goal 契约、压缩提示）：折成一行灰字，默认不展开。
 *
 * 这些在解析层就丢掉了，因为对人零信息量，且是原文里最占地方的部分：
 * 内部路由地址（`Child intercom target`）、给模型抄的工具调用
 * （`subagent({ action: "steer", … })`、`Reply with: …`）、
 * 以及 `guidance` 那种「不要 poll」的模型操作指令。
 *
 * ⭐ 结构化数据（`Structured output:` / workflow `Return:`）不在这里画，
 * 交给 `ui/structured.client.tsx` —— 那边先认形状再画，不是画 JSON 树。
 */

import { type PluginTheme, type PluginTimelineItemProps } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/react-native";
import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { PiChildOutput, PiCompletionEntry, PiNotice } from "../domain/contracts.shared";
import type { Translator } from "../domain/i18n.shared";
import { buildStructuredView } from "../domain/structured-view.shared";
import { useLocale } from "./locale.client";
import { StructuredBlock } from "./structured.client";
import {
  CardHeader,
  CardShell,
  CardTitle,
  Chip,
  ExpandToggle,
  ICON,
  KeyValue,
  MetaRow,
  Mono,
  RowShell,
  SPACE,
  SectionTitle,
  text,
  type Tone,
} from "./tokens.client";

/** 正文超过这个长度就折起来 —— 子任务输出动辄几千字。 */
const COLLAPSE_OVER = 320;

function headline(notice: PiNotice, t: Translator): string {
  switch (notice.kind) {
    case "background_task":
      return notice.taskName ?? t.notice_background_task;
    case "completion": {
      if (notice.variant === "grouped") return t.notice_completion_group(notice.entries.length);
      const agent = notice.entries[0]?.agent;
      // workflow 是 Pi 给它的字面 agent 名，不是我们编的
      return agent === "workflow" ? t.notice_workflow : agent ?? t.notice_background_task;
    }
    case "supervisor":
      return notice.variant === "need_decision"
        ? t.notice_supervisor_decision
        : notice.variant === "interview_request"
          ? t.notice_supervisor_interview
          : t.notice_supervisor_progress;
    case "control":
      return notice.variant === "failed"
        ? t.notice_control_failed
        : notice.variant === "long_running"
          ? t.notice_control_long_running
          : t.notice_control_attention;
    case "wait":
      return t.notice_wait;
    case "web_fetch":
      return notice.variant === "error" ? t.notice_web_search_error : t.notice_web_search;
    case "model_only":
      return notice.variant === "goal_contract"
        ? t.notice_model_only_goal
        : t.notice_model_only_compaction;
  }
}

function visuals(notice: PiNotice, theme: PluginTheme): { icon: string; color: string; accent: boolean } {
  // ⭐ supervisor 不在这里 —— 它不是问你，见下面 COLLAPSED 的说明。
  // ⚠️ 留警示色（长跑 / 卡住值得一眼看到），但不给强调边框：
  // 这条是发给父 agent 的，不是你的待办
  if (notice.kind === "control" && notice.variant !== "failed") {
    return { icon: "TriangleAlert", color: theme.colors.statusWarning, accent: false };
  }
  if (notice.status === "failed") {
    return { icon: "CircleX", color: theme.colors.statusDanger, accent: true };
  }
  if (notice.status === "stopped" || notice.status === "paused" || notice.status === "timed_out") {
    return { icon: "CircleOff", color: theme.colors.foregroundMuted, accent: false };
  }
  const byKind: Record<PiNotice["kind"], string> = {
    background_task: "Terminal",
    completion: "Workflow",
    supervisor: "ArrowLeftRight",
    control: "TriangleAlert",
    wait: "AlarmClock",
    web_fetch: "Globe",
    model_only: "EyeOff",
  };
  return { icon: byKind[notice.kind], color: theme.colors.foregroundMuted, accent: false };
}

function statusLabel(notice: PiNotice, t: Translator): string | null {
  // control 的状态标题里已经写了（「Subagent 需要关注」），再挂个状态角标
  // 只会让它更像一件待办
  if (notice.kind === "control") return null;
  switch (notice.status) {
    case "completed": return t.notice_status_completed;
    case "failed": return t.notice_status_failed;
    case "paused": return t.notice_status_paused;
    case "stopped": return t.notice_status_stopped;
    case "running": return t.notice_status_running;
    case "timed_out": return t.notice_status_timed_out;
    case "unresolved": return t.notice_status_unresolved;
    default: return null;
  }
}

function statusTone(status: PiNotice["status"]): Tone | undefined {
  if (status === "failed") return "danger";
  if (status === "completed") return "ok";
  if (status === "paused" || status === "stopped" || status === "timed_out" || status === "attention") return "warning";
  return undefined;
}

/** 长文本折叠。卡片里有四处要这个行为，别各写各的。 */
function Body({ body, theme, t, tone }: { body: string; theme: PluginTheme; t: Translator; tone?: Tone }) {
  const [expanded, setExpanded] = useState(false);
  const long = body.length > COLLAPSE_OVER;
  const shown = expanded || !long ? body : `${body.slice(0, COLLAPSE_OVER)}…`;
  return (
    <View style={{ gap: SPACE.tight }}>
      <Text selectable style={text(theme, "body", tone ? { tone } : {})}>{shown}</Text>
      {long ? (
        <ExpandToggle
          expanded={expanded}
          onPress={() => setExpanded((value) => !value)}
          theme={theme}
          moreLabel={t.notice_expand}
          lessLabel={t.notice_collapse}
        />
      ) : null}
    </View>
  );
}

/**
 * 文本里恰好是一坨 JSON 时按结构画，否则当散文。
 *
 * ⭐ 子任务的 `Preview:` 经常就是 `JSON.stringify` 的产物（实测 `seed-scout`
 * 那条整段是 JSON）。当散文倒出来就又回到「一堵墙」了。
 */
function useMaybeStructured(body: string | undefined): unknown | undefined {
  return useMemo(() => {
    const trimmed = body?.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return undefined;
    try {
      const value: unknown = JSON.parse(trimmed);
      return value !== null && typeof value === "object" ? value : undefined;
    } catch {
      return undefined;
    }
  }, [body]);
}

function MaybeStructuredBody({ body, theme, t, tone }: {
  body: string;
  theme: PluginTheme;
  t: Translator;
  tone?: Tone;
}) {
  const structured = useMaybeStructured(body);
  const view = useMemo(() => (structured === undefined ? null : buildStructuredView(structured)), [structured]);
  if (view) return <StructuredBlock view={view} theme={theme} t={t} />;
  return <Body body={body} theme={theme} t={t} {...(tone ? { tone } : {})} />;
}

/** 一个子任务的输出。⭐ 这一块就是原来那坨 JSON 该变成的样子。 */
function ChildOutput({ child, theme, t }: { child: PiChildOutput; theme: PluginTheme; t: Translator }) {
  const failed = child.status !== undefined && child.status !== "completed";
  const tone: Tone | undefined = failed ? "danger" : undefined;
  return (
    <RowShell theme={theme} {...(tone ? { tone } : {})}>
      <MetaRow>
        <Text style={text(theme, "rowTitle", { flex: 1 })}>
          {child.key ?? child.runId?.slice(0, 8) ?? "—"}
        </Text>
        {child.status ? <Chip text={child.status} theme={theme} {...(tone ? { tone } : {})} /> : null}
        {child.runId && child.key ? <Mono label={child.runId.slice(0, 8)} theme={theme} /> : null}
      </MetaRow>
      {child.preview ? (
        <MaybeStructuredBody body={child.preview} theme={theme} t={t} />
      ) : child.previewUnavailable ? (
        <Text style={text(theme, "meta", { muted: true, italic: true })}>
          {t.notice_no_preview(child.previewUnavailable)}
        </Text>
      ) : null}
      {child.savedOutputPath ? <Mono label={`${t.notice_saved_output}: ${child.savedOutputPath}`} theme={theme} /> : null}
    </RowShell>
  );
}

/** 一次完成。单条通知渲染一个，合批通知渲染多个。 */
function CompletionBlock({ entry, showAgent, theme, t }: {
  entry: PiCompletionEntry;
  showAgent: boolean;
  theme: PluginTheme;
  t: Translator;
}) {
  const failedChildren = entry.childOutputs.filter((child) => child.status && child.status !== "completed").length;
  const structuredView = useMemo(
    () => (entry.structured === undefined ? null : buildStructuredView(entry.structured)),
    [entry.structured],
  );

  return (
    <View style={{ gap: SPACE.gap }}>
      {showAgent ? (
        <Text style={text(theme, "rowTitle")}>
          {entry.agent}{entry.taskInfo ? ` ${entry.taskInfo}` : ""}
        </Text>
      ) : null}

      <MetaRow>
        {entry.workflow?.childCount !== undefined
          ? <Chip text={t.notice_child_runs(entry.workflow.childCount)} theme={theme} {...(failedChildren ? { tone: "warning" as const } : {})} />
          : entry.childRuns.length
            ? <Chip text={t.notice_child_runs(entry.childRuns.length)} theme={theme} />
            : null}
        {entry.workflow?.traceEvents !== undefined
          ? <Chip text={t.notice_trace(entry.workflow.traceEvents)} theme={theme} />
          : null}
        {entry.schedule ? <Chip text={t.notice_schedule(entry.schedule.name ?? entry.schedule.id)} theme={theme} /> : null}
        {entry.workflowRunId ? <Mono label={`${t.notice_run} ${entry.workflowRunId.slice(0, 8)}`} theme={theme} /> : null}
      </MetaRow>

      {entry.summary ? <MaybeStructuredBody body={entry.summary} theme={theme} t={t} /> : null}

      {structuredView ? (
        <View style={{ gap: SPACE.tight }}>
          <SectionTitle label={t.notice_structured_title} theme={theme} />
          <StructuredBlock view={structuredView} theme={theme} t={t} />
        </View>
      ) : null}

      {entry.structuredTruncated ? (
        <Text style={text(theme, "meta", { muted: true, italic: true })}>
          {t.notice_structured_truncated}
        </Text>
      ) : null}

      {entry.childOutputs.map((child, index) => (
        <ChildOutput key={child.key ?? child.runId ?? String(index)} child={child} theme={theme} t={t} />
      ))}

      {entry.omittedPreviews ? (
        <Text style={text(theme, "meta", { muted: true })}>
          {t.notice_omitted_previews(entry.omittedPreviews)}
        </Text>
      ) : null}

      {/* 子任务没有输出，但返回值预览确实被丢过 —— 说明白，别让人以为卡片坏了 */}
      {entry.workflow?.returnTruncated && entry.childOutputs.length > 0 && !entry.summary && !structuredView ? (
        <Text style={text(theme, "meta", { muted: true, italic: true })}>
          {t.notice_return_dropped}
        </Text>
      ) : null}

      {entry.workflow?.notes.map((note) => (
        <Text key={note} style={text(theme, "meta", { muted: true })}>{note}</Text>
      ))}

      {entry.handoffPath ? <Mono label={`${t.notice_handoff}: ${entry.handoffPath}`} theme={theme} /> : null}
      {entry.session ? <Mono label={entry.session.value} theme={theme} /> : null}
    </View>
  );
}

export function PiNoticeCard({ notice, theme, t }: {
  notice: PiNotice;
  theme: PluginTheme;
  t: Translator;
}) {
  const [expanded, setExpanded] = useState(false);
  const look = visuals(notice, theme);
  const status = statusLabel(notice, t);

  // ⭐ 折成一行的两类：
  //
  // - model_only：Pi 标了 display:false，它自己的界面从不显示。
  // - supervisor：subagent 发给**父 agent**的内部通信，正文结尾是
  //   `Reply with: subagent_supervisor({ … })` —— 那是个工具调用，只有模型能发。
  //   Paseo 真正的问答走的是另一条路（pi provider 的
  //   `mapExtensionUiRequestToPermission`，渲染成带选项的权限对话框）。
  //   所以这里绝不能做成「等你裁决」的样子：没有选项不是漏做了选项，
  //   而是它本来就不该问你。
  if (notice.kind === "model_only" || notice.kind === "supervisor") {
    return (
      <View style={{ opacity: 0.75 }}>
        <CardShell theme={theme} compact>
          <CardHeader
            trailing={
              <ExpandToggle
                expanded={expanded}
                onPress={() => setExpanded((value) => !value)}
                theme={theme}
                moreLabel={t.notice_expand}
                lessLabel={t.notice_collapse}
              />
            }
          >
            <Icon name={look.icon} size={ICON.row} color={look.color} />
            <Text numberOfLines={1} style={text(theme, "rowTitle", { muted: true, flex: 1 })}>
              {headline(notice, t)}
            </Text>
          </CardHeader>
          {expanded ? (
            <>
              <Text style={text(theme, "meta", { muted: true })}>
                {notice.kind === "supervisor" ? t.notice_supervisor_body : t.notice_model_only_body}
              </Text>
              <Text selectable style={text(theme, "body")}>{notice.body}</Text>
            </>
          ) : null}
        </CardShell>
      </View>
    );
  }

  return (
    <CardShell theme={theme} {...(look.accent ? { accentColor: look.color } : {})}>
      <CardHeader
        trailing={status ? <Chip text={status} theme={theme} {...(statusTone(notice.status) ? { tone: statusTone(notice.status)! } : {})} /> : null}
      >
        <Icon name={look.icon} size={ICON.card} color={look.color} />
        <CardTitle label={headline(notice, t)} theme={theme} />
      </CardHeader>

      {/* 元信息一行带过，不占主视线 */}
      <MetaRow>
        {notice.kind === "background_task" && notice.exitCode !== undefined && notice.exitCode !== 0
          ? <Chip text={t.notice_exit_code(notice.exitCode)} theme={theme} tone="danger" />
          : null}
        {notice.agent ? <Chip text={t.notice_agent(notice.agent)} theme={theme} /> : null}
        {notice.childIndex !== undefined ? <Chip text={t.notice_child_index(notice.childIndex)} theme={theme} /> : null}
        {notice.step !== undefined ? <Chip text={t.notice_step(notice.step)} theme={theme} /> : null}
        {notice.fetched ? <Chip text={t.notice_fetched(notice.fetched.done, notice.fetched.total)} theme={theme} /> : null}
        {notice.outcome ? <Chip text={notice.outcome} theme={theme} /> : null}
        {notice.runId ? <Mono label={`${t.notice_run} ${notice.runId.slice(0, 8)}`} theme={theme} /> : null}
      </MetaRow>

      {notice.error ? <Body body={notice.error} theme={theme} t={t} tone="danger" /> : null}
      {notice.signal ? (
        <KeyValue label={t.notice_signal} theme={theme} stacked>
          <Text selectable style={text(theme, "body")}>{notice.signal}</Text>
        </KeyValue>
      ) : null}
      {notice.recentFailures ? (
        <KeyValue label={t.notice_recent_failures} theme={theme} stacked>
          <Text selectable style={text(theme, "body")}>{notice.recentFailures}</Text>
        </KeyValue>
      ) : null}

      {notice.facts.length ? (
        <MetaRow>
          {notice.facts.map((fact) => <Chip key={fact} text={fact} theme={theme} />)}
        </MetaRow>
      ) : null}

      {notice.body ? <MaybeStructuredBody body={notice.body} theme={theme} t={t} /> : null}

      {notice.entries.map((entry, index) => (
        <CompletionBlock
          key={`${entry.agent}-${index}`}
          entry={entry}
          showAgent={notice.entries.length > 1}
          theme={theme}
          t={t}
        />
      ))}

      {notice.kind === "control" ? (
        <Text style={text(theme, "meta", { muted: true })}>{t.notice_control_body}</Text>
      ) : null}

      {notice.outputFile ? <Mono label={`${t.notice_output_file}: ${notice.outputFile}`} theme={theme} /> : null}
    </CardShell>
  );
}

export function PiNoticeTimelineCard({ item, theme, host }: PluginTimelineItemProps<PiNotice>) {
  const { t } = useLocale(host.id);
  return <PiNoticeCard notice={item.data} theme={theme} t={t} />;
}
