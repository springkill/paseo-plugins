/**
 * Pi 通知卡片。
 *
 * 替掉时间线上那几段裸文本：`<background-task-notification>` XML、
 * "Subagent needs a supervisor decision." 之类。
 *
 * 设计取向：**卡片只放人当下要判断的东西**。
 *
 * - 后台任务：名字 + 终态 + 退出码。输出路径次要，小字。
 * - workflow：终态 + 子运行的成败分布。
 * - 等你裁决：最重的一档 —— 它真的卡在那儿不动了，所以给强调色和一句明话。
 * - 进度更新 / 抓取完成：最轻，一行带过。
 *
 * 内部路由地址（`Child intercom target`）、给模型看的 `guidance`、
 * `Reply with: subagent_supervisor({...})` 样板 —— 都在解析层丢掉了，
 * 它们对人没有信息量，是原来那段裸文本里最占地方的部分。
 */

import { type PluginTheme, type PluginTimelineItemProps } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/react-native";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PiNotice } from "../domain/contracts.shared";
import type { Translator } from "../domain/i18n.shared";
import { useLocale } from "./locale.client";

/** 正文超过这个长度就折起来 —— workflow 的返回值动辄几千字。 */
const COLLAPSE_OVER = 320;

function headline(notice: PiNotice, t: Translator): string {
  switch (notice.kind) {
    case "background_task":
      return notice.taskName ?? t.notice_background_task;
    case "workflow":
      return t.notice_workflow;
    case "supervisor":
      return notice.variant === "need_decision" ? t.notice_supervisor_decision : t.notice_supervisor_progress;
    case "attention":
      return t.notice_attention;
    case "web_search":
      return t.notice_web_search;
  }
}

function visuals(notice: PiNotice, theme: PluginTheme) {
  // ⭐ 只有「等你裁决」和「需要关注」值得抢注意力 —— 它们是真的停住了。
  // 别的都是既成事实，通知一声就够。
  if (notice.kind === "supervisor" && notice.variant === "need_decision") {
    return { icon: "MessageCircleQuestion", color: theme.colors.statusWarning, accent: true };
  }
  if (notice.kind === "attention") {
    return { icon: "TriangleAlert", color: theme.colors.statusWarning, accent: true };
  }
  if (notice.status === "failed") {
    return { icon: "CircleX", color: theme.colors.statusDanger, accent: true };
  }
  if (notice.status === "stopped") {
    return { icon: "CircleOff", color: theme.colors.foregroundMuted, accent: false };
  }
  const byKind: Record<PiNotice["kind"], string> = {
    background_task: "Terminal",
    workflow: "Workflow",
    supervisor: "MessagesSquare",
    attention: "TriangleAlert",
    web_search: "Globe",
  };
  return { icon: byKind[notice.kind], color: theme.colors.foregroundMuted, accent: false };
}

function statusLabel(notice: PiNotice, t: Translator): string | null {
  switch (notice.status) {
    case "completed": return t.notice_status_completed;
    case "failed": return t.notice_status_failed;
    case "stopped": return t.notice_status_stopped;
    case "running": return t.notice_status_running;
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

  const failedChildren = notice.childRuns.filter((run) => run.status && run.status !== "completed").length;

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
          <Chip
            text={status}
            theme={theme}
            tone={notice.status === "failed" ? "danger" : undefined}
          />
        ) : null}
      </View>

      {/* 元信息一行带过，不占主视线 */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {notice.kind === "background_task" && notice.exitCode !== undefined && notice.exitCode !== 0
          ? <Chip text={t.notice_exit_code(notice.exitCode)} theme={theme} tone="danger" />
          : null}
        {notice.agent ? <Chip text={t.notice_agent(notice.agent)} theme={theme} /> : null}
        {notice.childIndex !== undefined ? <Chip text={t.notice_child_index(notice.childIndex)} theme={theme} /> : null}
        {notice.childRuns.length
          ? <Chip text={t.notice_child_runs(notice.childRuns.length)} theme={theme} tone={failedChildren ? "warning" : undefined} />
          : null}
        {notice.fetched ? <Chip text={t.notice_fetched(notice.fetched.done, notice.fetched.total)} theme={theme} /> : null}
        {notice.runId
          ? (
            <Text selectable style={{ color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 10 }}>
              {t.notice_run} {notice.runId.slice(0, 8)}
            </Text>
          )
          : null}
      </View>

      {/* ⭐ 它真的卡住了，这句话得说明白 */}
      {notice.replyTo ? (
        <Text style={{ color: theme.colors.statusWarning, fontSize: 12, lineHeight: 17 }}>
          {t.notice_awaiting_reply}
        </Text>
      ) : null}

      {notice.signal ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          {t.notice_signal}: {notice.signal}
        </Text>
      ) : null}

      {body ? (
        <Text selectable style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 19 }}>
          {body}
        </Text>
      ) : null}

      {notice.childRuns.length > 0 && expanded ? (
        <View style={{ gap: 3, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: theme.colors.border }}>
          {notice.childRuns.map((run) => (
            <Text key={run.key} style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "monospace" }}>
              {run.status === "completed" ? "✓" : "✗"} {run.key}
              {run.runId ? ` · ${run.runId.slice(0, 8)}` : ""}
            </Text>
          ))}
        </View>
      ) : null}

      {notice.hint ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
          {t.notice_hint}: {notice.hint}
        </Text>
      ) : null}

      {notice.outputFile ? (
        <Text selectable numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 10 }}>
          {t.notice_output_file}: {notice.outputFile}
        </Text>
      ) : null}

      {long || notice.childRuns.length > 0 ? (
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
