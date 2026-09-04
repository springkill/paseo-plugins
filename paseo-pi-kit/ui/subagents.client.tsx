import {
  type PluginAgentPanelProps,
  type PluginClientContext,
  type PluginComposerPillProps,
  type PluginTheme,
  type PluginTimelineItemProps,
  useAgent,
  useRpc,
} from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { subagentCallsRpc, type SubagentCall, type SubagentChild } from "../domain/contracts.shared";
import { translator, type Translator } from "../domain/i18n.shared";
import { localeFromTag } from "../domain/locale.shared";
import { detectClientLocale, LanguagePicker, useLocale } from "./locale.client";
import { FONT, LINE, RADIUS, SPACE } from "./tokens.client";

function statusMeta(
  status: SubagentCall["status"] | SubagentChild["status"],
  theme: PluginTheme,
  t: Translator,
) {
  if (status === "completed") return { label: t.status_completed, icon: "CheckCircle2", color: theme.colors.statusSuccess };
  if (status === "failed") return { label: t.status_failed, icon: "CircleX", color: theme.colors.statusDanger };
  if (status === "canceled") return { label: t.status_canceled, icon: "Ban", color: theme.colors.foregroundMuted };
  return { label: t.status_running, icon: "LoaderCircle", color: theme.colors.accent };
}

function formatDuration(value?: number): string | null {
  if (value === undefined) return null;
  if (value < 1_000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${Math.round(value / 100) / 10} s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1_000)}s`;
}

function compactNumber(value?: number): string | null {
  if (value === undefined) return null;
  if (value < 1_000) return String(value);
  return `${Math.round(value / 100) / 10}k`;
}

function ChildRow({ child, theme, expanded, t }: { child: SubagentChild; theme: PluginTheme; expanded: boolean; t: Translator }) {
  const meta = statusMeta(child.status, theme, t);
  const facts = [
    child.model,
    child.context ? `[${child.context}]` : null,
    child.toolCount === undefined ? null : `${child.toolCount} tools`,
    compactNumber(child.tokens) ? `${compactNumber(child.tokens)} tokens` : null,
    formatDuration(child.durationMs),
    child.costUsd === undefined ? null : `$${child.costUsd.toFixed(3)}`,
  ].filter(Boolean);
  return (
    <View style={{ gap: 6, padding: SPACE.row, borderRadius: RADIUS.row, backgroundColor: theme.colors.surface0, borderWidth: 1, borderColor: theme.colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flex: 1 }}>
          <Icon name="Bot" size={15} color={meta.color} />
          <Text style={{ color: theme.colors.foreground, fontWeight: "700", flex: 1 }}>#{child.index + 1} {child.agent}</Text>
        </View>
        <Text style={{ color: meta.color, fontSize: FONT.meta, fontWeight: "800" }}>{meta.label}</Text>
      </View>
      {facts.length ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT.meta }}>{facts.join(" · ")}</Text> : null}
      {child.acceptance ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT.meta }}>Acceptance: {child.acceptance}</Text> : null}
      {expanded && child.finalOutput ? (
        <Text selectable style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: FONT.body }}>{child.finalOutput}</Text>
      ) : null}
      {expanded && child.residualRisks?.length ? (
        <Text style={{ color: theme.colors.statusWarning, fontSize: FONT.body }}>残余风险：{child.residualRisks.join("；")}</Text>
      ) : null}
    </View>
  );
}

export function SubagentCardView({
  call,
  theme,
  compact,
  t,
  initiallyExpanded = false,
}: {
  call: SubagentCall;
  theme: PluginTheme;
  t: Translator;
  compact: boolean;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const meta = statusMeta(call.status, theme, t);
  return (
    <View style={{ gap: compact ? SPACE.gap : SPACE.row, padding: compact ? SPACE.row : SPACE.card, borderRadius: RADIUS.card, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flex: 1 }}>
          {call.status === "running" ? <ActivityIndicator size="small" color={meta.color} /> : <Icon name={meta.icon} size={17} color={meta.color} />}
          <Text style={{ color: theme.colors.foreground, fontWeight: "800", fontSize: FONT.cardTitle, flex: 1 }}>
            Pi Subagent · {call.subAgentType ?? call.mode ?? "workflow"}
          </Text>
        </View>
        <Text style={{ color: meta.color, fontWeight: "800", fontSize: FONT.meta }}>{meta.label}</Text>
      </View>

      {call.description ? <Text style={{ color: theme.colors.foreground }}>{call.description}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {call.children.length ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT.meta }}>{call.children.length} children</Text> : null}
        {call.runId ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT.meta }}>Run {call.runId.slice(0, 8)}</Text> : null}
        {call.missionId ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT.meta }}>Mission {call.missionId.slice(0, 8)} · {call.missionStatus ?? "—"}</Text> : null}
      </View>

      {call.children.map((child) => <ChildRow t={t} key={`${call.callId}-${child.index}`} child={child} theme={theme} expanded={expanded} />)}
      {!call.children.length ? (
        <Text selectable style={{ color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: FONT.body }}>{call.log || (call.status === "running" ? t.subagents_starting : t.subagents_no_output)}</Text>
      ) : null}

      {call.children.some((child) => child.finalOutput || child.residualRisks?.length) ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)} style={{ alignSelf: "flex-start", paddingVertical: 3 }}>
          <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>{expanded ? t.subagents_collapse_output : t.subagents_expand_output}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function subagentCounts(calls: SubagentCall[] | undefined) {
  let active = 0;
  let total = 0;
  for (const call of calls ?? []) {
    if (call.children.length) {
      active += call.children.filter((child) => child.status === "running").length;
      total += call.children.length;
    } else if (call.status === "running") {
      active += 1;
      total += 1;
    }
  }
  return { active, total };
}

function useSubagentCalls(agentId: string, hostId: string, running: boolean) {
  const listCalls = useRpc(subagentCallsRpc);
  return useQuery({
    queryKey: ["pi-subagents", hostId, agentId],
    queryFn: () => listCalls({ agentId }),
    refetchInterval: (query) => {
      const live = query.state.data?.calls.some((call) => call.status === "running" || call.children.some((child) => child.status === "running"));
      return running || live ? 3_000 : 20_000;
    },
    retry: 1,
  });
}

export function SubagentTimelineCard({ item, theme, host, layout, agentId }: PluginTimelineItemProps<SubagentCall>) {
  const { t } = useLocale(host.id);
  const agentRunning = useAgent(agentId, (agent) => agent.status === "running") ?? false;
  const query = useSubagentCalls(agentId, host.id, agentRunning);
  const call = query.data?.calls.find((candidate) => candidate.callId === item.data.callId) ?? item.data;
  return <SubagentCardView call={call} theme={theme} compact={layout.compact} t={t} />;
}

export function PiSubagentsPanel({ theme, host, layout, agentId }: PluginAgentPanelProps) {
  const localeCtx = useLocale(host.id);
  const t = localeCtx.t;
  const agentRunning = useAgent(agentId, (agent) => agent.status === "running") ?? false;
  const query = useSubagentCalls(agentId, host.id, agentRunning);
  const counts = subagentCounts(query.data?.calls);
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0, padding: layout.compact ? 12 : 18, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ gap: 2 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: FONT.panelTitle, fontWeight: "800" }}>{t.panel_subagents}</Text>
          <Text style={{ color: theme.colors.foregroundMuted }}>{t.subagents_summary(counts.active, counts.total, query.data?.calls.length ?? 0)}</Text>
        </View>
        {query.isFetching ? <ActivityIndicator color={theme.colors.accent} /> : null}
      </View>
      {query.error ? <Text style={{ color: theme.colors.statusDanger }}>{query.error instanceof Error ? query.error.message : String(query.error)}</Text> : null}
      <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>
        {query.data?.calls.map((call) => <SubagentCardView key={call.callId} call={call} theme={theme} compact={layout.compact} t={t} />)}
        {!query.isLoading && !query.error && query.data?.calls.length === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>{t.subagents_none_for_agent}</Text>
        ) : null}
      </ScrollView>
      <LanguagePicker ctx={localeCtx} hostId={host.id} theme={theme} />
    </View>
  );
}


function SubagentStatusPill({ theme, host, layout, agentId }: PluginComposerPillProps) {
  const localeCtx = useLocale(host.id);
  const t = localeCtx.t;
  const agent = useAgent(agentId, ({ status, title }) => ({ status, title }));
  const query = useSubagentCalls(agentId, host.id, agent?.status === "running");
  const { active, total } = subagentCounts(query.data?.calls);

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
        {active ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <Icon name="Network" size={14} color={theme.colors.foregroundMuted} />}
        <Text numberOfLines={1} style={{ color: active ? theme.colors.accent : theme.colors.foregroundMuted, fontWeight: "600", flexShrink: 1 }}>
          Subagents {active ? `${active} running / ${total}` : total}
        </Text>
      </View>
    </>
  );
}

export function contributeSubagentPills(client: PluginClientContext) {
  // 注册时刻拿不到 useLocale；title 只是 tooltip，弹窗内容走完整判定
  const t = translator(localeFromTag(detectClientLocale()) ?? "en");
  const pills = new Map<string, { workspaceId: string; remove: () => void }>();
  let active = true;
  function remove(agentId: string) {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  }
  function upsert(agent: { id: string; workspaceId?: string; archivedAt?: string | null; provider?: string }) {
    const isPi = agent.provider === "pi" || agent.provider?.startsWith("pi/") === true;
    if (!active || !isPi || !agent.workspaceId || agent.archivedAt) {
      remove(agent.id);
      return;
    }
    const existing = pills.get(agent.id);
    if (existing?.workspaceId === agent.workspaceId) return;
    remove(agent.id);
    const { id: agentId, workspaceId } = agent;
    pills.set(agentId, {
      workspaceId,
      remove: client.addComposerPill({
        id: "pi-subagents",
        title: t.nav_open_subagents,
        workspaceId,
        agentId,
        Component: SubagentStatusPill,
        onPress() {
          // ⭐ `location: "explorer"` 不能省 —— 缺省是 "workspace"，那会开成
          // 主区的大标签页。带上它才落到文件树、git 变更树那个侧边容器里。
          client.openPanel("pi-subagents", { workspaceId, agentId, location: "explorer" });
        },
      }),
    });
  }
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "upsert") upsert(update.agent);
    else remove(update.agentId);
  });
  void client.paseo.agents.list({}).then(({ entries }) => {
    if (!active) return;
    for (const { agent } of entries) upsert(agent);
  }).catch((error) => console.error("[pi-subagents] failed to seed composer pills", error));
  return () => {
    active = false;
    unsubscribe();
    for (const registration of pills.values()) registration.remove();
    pills.clear();
  };
}
