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
 * - 等你裁决：最重的一档 —— 它真的卡在那儿不动了，所以给强调色和一句明话。
 * - 进度更新 / 抓取完成：最轻，一行带过。
 * - 仅模型可见（goal 契约、压缩提示）：折成一行灰字，默认不展开。
 *
 * 这些在解析层就丢掉了，因为对人零信息量，且是原文里最占地方的部分：
 * 内部路由地址（`Child intercom target`）、给模型抄的工具调用
 * （`subagent({ action: "steer", … })`、`Reply with: …`）、
 * 以及 `guidance` 那种「不要 poll」的模型操作指令。
 */

import { type PluginTheme, type PluginTimelineItemProps } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/react-native";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PiChildOutput, PiCompletionEntry, PiNotice } from "../domain/contracts.shared";
import type { Translator } from "../domain/i18n.shared";
import { useLocale } from "./locale.client";

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

function visuals(notice: PiNotice, theme: PluginTheme) {
  // ⭐ supervisor 不在这里 —— 它不是问你，见下面 COLLAPSED 的说明。
  // 只有「需要关注」是真的停住并且要人介入。
  // ⚠️ 留警示色（长跑/卡住值得一眼看到），但不给强调边框：
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

function Chip({ text, theme, tone }: { text: string; theme: PluginTheme; tone?: "warning" | "danger" }) {
  const color = tone === "danger"
    ? theme.colors.statusDanger
    : tone === "warning"
      ? theme.colors.statusWarning
      : theme.colors.foregroundMuted;
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, borderWidth: 1, borderColor: color }}>
      <Text style={{ color, fontSize: 10, fontWeight: "700" }}>{text}</Text>
    </View>
  );
}

function Mono({ text, theme }: { text: string; theme: PluginTheme }) {
  return (
    <Text selectable numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 10 }}>
      {text}
    </Text>
  );
}

function Labelled({ label, value, theme }: { label: string; value: string; theme: PluginTheme }) {
  return (
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
      {label}: {value}
    </Text>
  );
}

/** 一个子任务的输出。⭐ 这一块就是原来那坨 JSON 该变成的样子。 */
function ChildOutput({ child, theme, t }: { child: PiChildOutput; theme: PluginTheme; t: Translator }) {
  const [expanded, setExpanded] = useState(false);
  const preview = child.preview ?? "";
  const long = preview.length > COLLAPSE_OVER;
  const shown = expanded || !long ? preview : `${preview.slice(0, COLLAPSE_OVER)}…`;
  const failed = child.status !== undefined && child.status !== "completed";

  return (
    <View style={{ gap: 3, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: failed ? theme.colors.statusDanger : theme.colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "700" }}>
          {child.key ?? child.runId?.slice(0, 8) ?? "—"}
        </Text>
        {child.status ? <Chip text={child.status} theme={theme} tone={failed ? "danger" : undefined} /> : null}
        {child.runId && child.key ? <Mono text={child.runId.slice(0, 8)} theme={theme} /> : null}
      </View>
      {shown ? (
        <Text selectable style={{ color: theme.colors.foreground, fontSize: 12, lineHeight: 18 }}>
          {shown}
        </Text>
      ) : child.previewUnavailable ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontStyle: "italic" }}>
          {t.notice_no_preview(child.previewUnavailable)}
        </Text>
      ) : null}
      {child.savedOutputPath ? <Mono text={`${t.notice_saved_output}: ${child.savedOutputPath}`} theme={theme} /> : null}
      {long ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)} style={{ alignSelf: "flex-start", paddingVertical: 2 }}>
          <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: "700" }}>
            {expanded ? t.notice_collapse : t.notice_expand}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** 一次完成。单条通知渲染一个，合批通知渲染多个。 */
function CompletionBlock({ entry, showAgent, theme, t }: {
  entry: PiCompletionEntry;
  showAgent: boolean;
  theme: PluginTheme;
  t: Translator;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = entry.summary.length > COLLAPSE_OVER;
  const summary = expanded || !long ? entry.summary : `${entry.summary.slice(0, COLLAPSE_OVER)}…`;
  const failedChildren = entry.childOutputs.filter((c) => c.status && c.status !== "completed").length;

  return (
    <View style={{ gap: 6 }}>
      {showAgent ? (
        <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "800" }}>
          {entry.agent}{entry.taskInfo ? ` ${entry.taskInfo}` : ""}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {entry.workflow?.childCount !== undefined
          ? <Chip text={t.notice_child_runs(entry.workflow.childCount)} theme={theme} tone={failedChildren ? "warning" : undefined} />
          : entry.childRuns.length
            ? <Chip text={t.notice_child_runs(entry.childRuns.length)} theme={theme} />
            : null}
        {entry.workflow?.traceEvents !== undefined
          ? <Chip text={t.notice_trace(entry.workflow.traceEvents)} theme={theme} />
          : null}
        {entry.schedule ? <Chip text={t.notice_schedule(entry.schedule.name ?? entry.schedule.id)} theme={theme} /> : null}
        {entry.workflowRunId ? <Mono text={`${t.notice_run} ${entry.workflowRunId.slice(0, 8)}`} theme={theme} /> : null}
      </View>

      {summary ? (
        <Text selectable style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 19 }}>
          {summary}
        </Text>
      ) : null}
      {long ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)} style={{ alignSelf: "flex-start", paddingVertical: 2 }}>
          <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "700" }}>
            {expanded ? t.notice_collapse : t.notice_expand}
          </Text>
        </Pressable>
      ) : null}

      {entry.childOutputs.map((child, index) => (
        <ChildOutput key={child.key ?? child.runId ?? String(index)} child={child} theme={theme} t={t} />
      ))}

      {entry.omittedPreviews ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {t.notice_omitted_previews(entry.omittedPreviews)}
        </Text>
      ) : null}

      {/* 子任务没有输出，但返回值预览确实被丢过 —— 说明白，别让人以为卡片坏了 */}
      {entry.workflow?.returnTruncated && entry.childOutputs.length > 0 && !summary ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontStyle: "italic" }}>
          {t.notice_return_dropped}
        </Text>
      ) : null}

      {entry.workflow?.notes.map((note) => (
        <Text key={note} style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
          {note}
        </Text>
      ))}

      {entry.handoffPath ? <Mono text={`${t.notice_handoff}: ${entry.handoffPath}`} theme={theme} /> : null}
      {entry.session ? <Mono text={entry.session.value} theme={theme} /> : null}
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
  const long = notice.body.length > COLLAPSE_OVER;
  const body = expanded || !long ? notice.body : `${notice.body.slice(0, COLLAPSE_OVER)}…`;

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
      <View style={{ gap: 4, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1, opacity: 0.75 }}>
        <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name={look.icon} size={14} color={look.color} />
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, flex: 1 }}>
              {headline(notice, t)}
            </Text>
            <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: "700" }}>
              {expanded ? t.notice_collapse : t.notice_expand}
            </Text>
          </View>
        </Pressable>
        {expanded ? (
          <>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
              {notice.kind === "supervisor" ? t.notice_supervisor_body : t.notice_model_only_body}
            </Text>
            <Text selectable style={{ color: theme.colors.foreground, fontSize: 12, lineHeight: 18 }}>
              {notice.body}
            </Text>
          </>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={{
        gap: 8,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: look.accent ? look.color : theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name={look.icon} size={16} color={look.color} />
        <Text numberOfLines={2} style={{ color: theme.colors.foreground, fontWeight: "800", flex: 1 }}>
          {headline(notice, t)}
        </Text>
        {status ? (
          <Chip text={status} theme={theme} tone={notice.status === "failed" ? "danger" : undefined} />
        ) : null}
      </View>

      {/* 元信息一行带过，不占主视线 */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {notice.kind === "background_task" && notice.exitCode !== undefined && notice.exitCode !== 0
          ? <Chip text={t.notice_exit_code(notice.exitCode)} theme={theme} tone="danger" />
          : null}
        {notice.agent ? <Chip text={t.notice_agent(notice.agent)} theme={theme} /> : null}
        {notice.childIndex !== undefined ? <Chip text={t.notice_child_index(notice.childIndex)} theme={theme} /> : null}
        {notice.step !== undefined ? <Chip text={t.notice_step(notice.step)} theme={theme} /> : null}
        {notice.fetched ? <Chip text={t.notice_fetched(notice.fetched.done, notice.fetched.total)} theme={theme} /> : null}
        {notice.outcome ? <Chip text={notice.outcome} theme={theme} /> : null}
        {notice.runId ? <Mono text={`${t.notice_run} ${notice.runId.slice(0, 8)}`} theme={theme} /> : null}
      </View>

      {notice.error ? (
        <Text selectable style={{ color: theme.colors.statusDanger, fontSize: 12, lineHeight: 17 }}>
          {notice.error}
        </Text>
      ) : null}
      {notice.signal ? <Labelled label={t.notice_signal} value={notice.signal} theme={theme} /> : null}
      {notice.recentFailures ? <Labelled label={t.notice_recent_failures} value={notice.recentFailures} theme={theme} /> : null}

      {notice.facts.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {notice.facts.map((fact) => <Chip key={fact} text={fact} theme={theme} />)}
        </View>
      ) : null}

      {body ? (
        <Text selectable style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 19 }}>
          {body}
        </Text>
      ) : null}

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
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
          {t.notice_control_body}
        </Text>
      ) : null}

      {notice.outputFile ? <Mono text={`${t.notice_output_file}: ${notice.outputFile}`} theme={theme} /> : null}

      {long ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)} style={{ alignSelf: "flex-start", paddingVertical: 2 }}>
          <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "700" }}>
            {expanded ? t.notice_collapse : t.notice_expand}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function PiNoticeTimelineCard({ item, theme, host }: PluginTimelineItemProps<PiNotice>) {
  const { t } = useLocale(host.id);
  return <PiNoticeCard notice={item.data} theme={theme} t={t} />;
}
