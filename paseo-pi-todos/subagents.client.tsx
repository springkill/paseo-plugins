import {
  type PluginAgentPanelProps,
  type PluginClientContext,
  type PluginComposerPillProps,
  type PluginTheme,
  type PluginTimelineItemProps,
  useAgent,
  useRpc,
} from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { subagentCallsRpc, type SubagentCall, type SubagentChild } from "./contracts.shared";

function statusMeta(status: SubagentCall["status"] | SubagentChild["status"], theme: PluginTheme) {
  if (status === "completed") return { label: "完成", icon: "CheckCircle2", color: theme.colors.statusSuccess };
  if (status === "failed") return { label: "失败", icon: "CircleX", color: theme.colors.statusDanger };
  if (status === "canceled") return { label: "取消", icon: "Ban", color: theme.colors.foregroundMuted };
  return { label: "运行中", icon: "LoaderCircle", color: theme.colors.accent };
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

function ChildRow({ child, theme, expanded }: { child: SubagentChild; theme: PluginTheme; expanded: boolean }) {
  const meta = statusMeta(child.status, theme);
  const facts = [
    child.model,
    child.context ? `[${child.context}]` : null,
    child.toolCount === undefined ? null : `${child.toolCount} tools`,
    compactNumber(child.tokens) ? `${compactNumber(child.tokens)} tokens` : null,
    formatDuration(child.durationMs),
    child.costUsd === undefined ? null : `$${child.costUsd.toFixed(3)}`,
  ].filter(Boolean);
  return (
    <View style={{ gap: 6, padding: 10, borderRadius: 9, backgroundColor: theme.colors.surface0, borderWidth: 1, borderColor: theme.colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flex: 1 }}>
          <Icon name="Bot" size={15} color={meta.color} />
          <Text style={{ color: theme.colors.foreground, fontWeight: "700", flex: 1 }}>#{child.index + 1} {child.agent}</Text>
        </View>
        <Text style={{ color: meta.color, fontSize: 11, fontWeight: "800" }}>{meta.label}</Text>
      </View>
      {facts.length ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{facts.join(" · ")}</Text> : null}
      {child.acceptance ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Acceptance: {child.acceptance}</Text> : null}
      {expanded && child.finalOutput ? (
        <Text selectable style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12 }}>{child.finalOutput}</Text>
      ) : null}
      {expanded && child.residualRisks?.length ? (
        <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>残余风险：{child.residualRisks.join("；")}</Text>
      ) : null}
    </View>
  );
}

export function SubagentCardView({
  call,
  theme,
  compact,
  initiallyExpanded = false,
}: {
  call: SubagentCall;
  theme: PluginTheme;
  compact: boolean;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const meta = statusMeta(call.status, theme);
  return (
    <View style={{ gap: compact ? 8 : 10, padding: compact ? 10 : 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flex: 1 }}>
          {call.status === "running" ? <ActivityIndicator size="small" color={meta.color} /> : <Icon name={meta.icon} size={17} color={meta.color} />}
          <Text style={{ color: theme.colors.foreground, fontWeight: "800", fontSize: 15, flex: 1 }}>
            Pi Subagent · {call.subAgentType ?? call.mode ?? "workflow"}
          </Text>
        </View>
        <Text style={{ color: meta.color, fontWeight: "800", fontSize: 11 }}>{meta.label}</Text>
      </View>

      {call.description ? <Text style={{ color: theme.colors.foreground }}>{call.description}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {call.children.length ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{call.children.length} children</Text> : null}
        {call.runId ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Run {call.runId.slice(0, 8)}</Text> : null}
        {call.missionId ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Mission {call.missionId.slice(0, 8)} · {call.missionStatus ?? "—"}</Text> : null}
      </View>

      {call.children.map((child) => <ChildRow key={`${call.callId}-${child.index}`} child={child} theme={theme} expanded={expanded} />)}
      {!call.children.length && call.log ? (
        <Text selectable style={{ color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 12 }}>{call.log}</Text>
      ) : null}

      {call.children.some((child) => child.finalOutput || child.residualRisks?.length) ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)} style={{ alignSelf: "flex-start", paddingVertical: 3 }}>
          <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>{expanded ? "收起子任务输出" : "展开子任务输出"}</Text>
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
  const agentRunning = useAgent(agentId, (agent) => agent.status === "running") ?? false;
  const query = useSubagentCalls(agentId, host.id, agentRunning);
  const call = query.data?.calls.find((candidate) => candidate.callId === item.data.callId) ?? item.data;
  return <SubagentCardView call={call} theme={theme} compact={layout.compact} />;
}

export function PiSubagentsPanel({ theme, host, layout, agentId }: PluginAgentPanelProps) {
  const agentRunning = useAgent(agentId, (agent) => agent.status === "running") ?? false;
  const query = useSubagentCalls(agentId, host.id, agentRunning);
  const counts = subagentCounts(query.data?.calls);
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0, padding: layout.compact ? 12 : 18, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ gap: 2 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 20, fontWeight: "800" }}>Pi Subagents</Text>
          <Text style={{ color: theme.colors.foregroundMuted }}>{counts.active} 个运行中 · 共 {counts.total} 个子任务 · 最近 {query.data?.calls.length ?? 0} 次调用</Text>
        </View>
        {query.isFetching ? <ActivityIndicator color={theme.colors.accent} /> : null}
      </View>
      {query.error ? <Text style={{ color: theme.colors.statusDanger }}>{query.error instanceof Error ? query.error.message : String(query.error)}</Text> : null}
      <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>
        {query.data?.calls.map((call) => <SubagentCardView key={call.callId} call={call} theme={theme} compact={layout.compact} />)}
        {!query.isLoading && !query.error && query.data?.calls.length === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>这个 Pi Agent 还没有 subagent 调用。</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const subagentOpeners = new Map<string, () => void>();

function SubagentStatusPill({ theme, host, layout, agentId }: PluginComposerPillProps) {
  const agent = useAgent(agentId, ({ status, title }) => ({ status, title }));
  const query = useSubagentCalls(agentId, host.id, agent?.status === "running");
  const [open, setOpen] = useState(false);
  const { active, total } = subagentCounts(query.data?.calls);

  useEffect(() => {
    const openCard = () => setOpen(true);
    subagentOpeners.set(agentId, openCard);
    return () => {
      if (subagentOpeners.get(agentId) === openCard) subagentOpeners.delete(agentId);
    };
  }, [agentId]);

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
        {active ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <Icon name="Network" size={14} color={theme.colors.foregroundMuted} />}
        <Text numberOfLines={1} style={{ color: active ? theme.colors.accent : theme.colors.foregroundMuted, fontWeight: "600", flexShrink: 1 }}>
          Subagents {active ? `${active} running / ${total}` : total}
        </Text>
      </View>
      <Modal title={`Pi Subagents · ${agent?.title ?? agentId.slice(0, 8)}`} open={open} onOpenChange={setOpen}>
        <Modal.Content>
          <ScrollView style={{ maxHeight: layout.compact ? 540 : 650 }} contentContainerStyle={{ gap: 10, padding: 12 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>仅显示当前 Agent：{agentId}</Text>
            {query.isFetching && !query.data ? <ActivityIndicator color={theme.colors.accent} /> : null}
            {query.error ? <Text style={{ color: theme.colors.statusDanger }}>{query.error instanceof Error ? query.error.message : String(query.error)}</Text> : null}
            {query.data?.calls.map((call) => <SubagentCardView key={call.callId} call={call} theme={theme} compact={layout.compact} />)}
            {!query.isLoading && !query.error && query.data?.calls.length === 0 ? (
              <Text style={{ color: theme.colors.foregroundMuted }}>当前 Agent 还没有 subagent 调用。</Text>
            ) : null}
          </ScrollView>
        </Modal.Content>
      </Modal>
    </>
  );
}

export function contributeSubagentPills(client: PluginClientContext) {
  const pills = new Map<string, { workspaceId: string; remove: () => void }>();
  let active = true;
  function remove(agentId: string) {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
    subagentOpeners.delete(agentId);
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
        title: "Open Pi subagents",
        workspaceId,
        agentId,
        Component: SubagentStatusPill,
        onPress() {
          subagentOpeners.get(agentId)?.();
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
    subagentOpeners.clear();
  };
}
