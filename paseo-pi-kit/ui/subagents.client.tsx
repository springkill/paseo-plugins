/**
 * Pi subagent 调用。
 *
 * 时间线卡片、composer pill、explorer 侧边面板三处共用同一个 `SubagentCardView`。
 * 视觉全部走 `ui/tokens.client.tsx` —— 这张卡片曾经完全没用套件，自己画头部、
 * 自己写状态文字，于是跟旁边的通知卡片一个 CardShell 一个裸 View。
 */

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
import React, { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { subagentCallsRpc, type SubagentCall, type SubagentChild } from "../domain/contracts.shared";
import { translator, type Translator } from "../domain/i18n.shared";
import { localeFromTag } from "../domain/locale.shared";
import { withCardBoundary } from "./card-boundary.client";
import { openPanelPreferExplorer } from "./open-panel.client";
import { detectClientLocale, LanguagePicker, useLocale } from "./locale.client";
import {
  CardHeader,
  CardShell,
  CardTitle,
  Chip,
  EmptyState,
  ErrorText,
  ExpandToggle,
  ICON,
  KeyValue,
  MetaRow,
  Mono,
  PanelShell,
  RowShell,
  SPACE,
  text,
  type Tone,
} from "./tokens.client";

function statusMeta(
  status: SubagentCall["status"] | SubagentChild["status"],
  theme: PluginTheme,
  t: Translator,
): { label: string; icon: string; color: string; tone: Tone | undefined } {
  if (status === "completed") return { label: t.status_completed, icon: "CircleCheck", color: theme.colors.statusSuccess, tone: "ok" };
  if (status === "failed") return { label: t.status_failed, icon: "CircleX", color: theme.colors.statusDanger, tone: "danger" };
  if (status === "canceled") return { label: t.status_canceled, icon: "Ban", color: theme.colors.foregroundMuted, tone: "warning" };
  return { label: t.status_running, icon: "LoaderCircle", color: theme.colors.accent, tone: undefined };
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

function ChildRow({ child, theme, expanded, t }: {
  child: SubagentChild;
  theme: PluginTheme;
  expanded: boolean;
  t: Translator;
}) {
  const meta = statusMeta(child.status, theme, t);
  const facts = [
    child.model,
    child.context ? `[${child.context}]` : null,
    child.toolCount === undefined ? null : `${child.toolCount} tools`,
    compactNumber(child.tokens) ? `${compactNumber(child.tokens)} tokens` : null,
    formatDuration(child.durationMs),
    child.costUsd === undefined ? null : `$${child.costUsd.toFixed(3)}`,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <RowShell theme={theme} {...(meta.tone === "danger" ? { tone: meta.tone } : {})}>
      <MetaRow>
        <Icon name="Bot" size={ICON.row} color={meta.color} />
        <Text style={text(theme, "rowTitle", { flex: 1 })}>#{child.index + 1} {child.agent}</Text>
        <Chip text={meta.label} theme={theme} {...(meta.tone ? { tone: meta.tone } : {})} />
      </MetaRow>
      {facts.length ? (
        <Text style={text(theme, "meta", { muted: true })}>{facts.join(" · ")}</Text>
      ) : null}
      {child.acceptance ? (
        <KeyValue label={t.subagents_acceptance} theme={theme} stacked>
          <Text style={text(theme, "meta", { muted: true })}>{child.acceptance}</Text>
        </KeyValue>
      ) : null}
      {expanded && child.finalOutput ? (
        <Text selectable style={text(theme, "body", { mono: true })}>{child.finalOutput}</Text>
      ) : null}
      {expanded && child.residualRisks?.length ? (
        <KeyValue label={t.subagents_residual_risks} theme={theme} stacked>
          <Text style={text(theme, "body", { tone: "warning" })}>{child.residualRisks.join("；")}</Text>
        </KeyValue>
      ) : null}
    </RowShell>
  );
}

export function SubagentCardView({ call, theme, compact, t, initiallyExpanded = false }: {
  call: SubagentCall;
  theme: PluginTheme;
  t: Translator;
  compact: boolean;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const meta = statusMeta(call.status, theme, t);

  return (
    <CardShell theme={theme} compact={compact}>
      <CardHeader trailing={<Chip text={meta.label} theme={theme} {...(meta.tone ? { tone: meta.tone } : {})} />}>
        {call.status === "running"
          ? <ActivityIndicator size="small" color={meta.color} />
          : <Icon name={meta.icon} size={ICON.card} color={meta.color} />}
        <CardTitle label={t.subagents_card_title(call.subAgentType ?? call.mode ?? "workflow")} theme={theme} />
      </CardHeader>

      {call.description ? <Text style={text(theme, "body")}>{call.description}</Text> : null}

      <MetaRow>
        {call.children.length ? <Chip text={t.subagents_children(call.children.length)} theme={theme} /> : null}
        {call.runId ? <Mono label={`${t.notice_run} ${call.runId.slice(0, 8)}`} theme={theme} /> : null}
        {call.missionId ? (
          <Mono label={`${t.subagents_mission} ${call.missionId.slice(0, 8)} · ${call.missionStatus ?? "—"}`} theme={theme} />
        ) : null}
      </MetaRow>

      {call.children.map((child) => (
        <ChildRow t={t} key={`${call.callId}-${child.index}`} child={child} theme={theme} expanded={expanded} />
      ))}
      {!call.children.length ? (
        <Text selectable style={text(theme, "body", { mono: true, muted: true })}>
          {call.log || (call.status === "running" ? t.subagents_starting : t.subagents_no_output)}
        </Text>
      ) : null}

      {call.children.some((child) => child.finalOutput || child.residualRisks?.length) ? (
        <ExpandToggle
          expanded={expanded}
          onPress={() => setExpanded((value) => !value)}
          theme={theme}
          moreLabel={t.subagents_expand_output}
          lessLabel={t.subagents_collapse_output}
        />
      ) : null}
    </CardShell>
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
      const live = query.state.data?.calls.some(
        (call) => call.status === "running" || call.children.some((child) => child.status === "running"),
      );
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
    <PanelShell
      theme={theme}
      title={t.panel_subagents}
      subtitle={t.subagents_summary(counts.active, counts.total, query.data?.calls.length ?? 0)}
      actions={query.isFetching ? <ActivityIndicator color={theme.colors.accent} /> : null}
      footer={<LanguagePicker ctx={localeCtx} hostId={host.id} theme={theme} />}
    >
      {query.error ? <ErrorText error={query.error} theme={theme} /> : null}
      {query.data?.calls.map((call) => (
        <SubagentCardView key={call.callId} call={call} theme={theme} compact={layout.compact} t={t} />
      ))}
      {!query.isLoading && !query.error && query.data?.calls.length === 0 ? (
        <EmptyState label={t.subagents_none_for_agent} theme={theme} />
      ) : null}
    </PanelShell>
  );
}

function SubagentStatusPill({ theme, host, agentId }: PluginComposerPillProps) {
  const { t } = useLocale(host.id);
  const agent = useAgent(agentId, ({ status, title }) => ({ status, title }));
  const query = useSubagentCalls(agentId, host.id, agent?.status === "running");
  const { active, total } = subagentCounts(query.data?.calls);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.tight, flexShrink: 1 }}>
      {active
        ? <ActivityIndicator size="small" color={theme.colors.accent} />
        : <Icon name="Network" size={ICON.row} color={theme.colors.foregroundMuted} />}
      <Text numberOfLines={1} style={text(theme, "meta", { strong: true, ...(active ? { accent: true } : { muted: true }) })}>
        {t.subagents_pill(active, total)}
      </Text>
    </View>
  );
}

export function contributeSubagentPills(client: PluginClientContext) {
  // 注册时刻拿不到 useLocale；title 只是 tooltip，面板内容走完整判定
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
        Component: withCardBoundary("pi-subagents-pill", SubagentStatusPill),
        onPress() {
          // ⚠️ 不能直接写 location: "explorer" —— 手机上 explorer 是 overlay
          // 形态，没有可用的 pane，宿主会抛 "Explorer is unavailable"，
          // 点了就什么都不发生。见 ui/open-panel.client.ts。
          openPanelPreferExplorer(client.openPanel, "pi-subagents", { workspaceId, agentId });
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
