import {
  Icon,
  type PluginClientContext,
  type PluginAgentPanelProps,
  type PluginComposerPillProps,
  useAgent,
  useRpc,
} from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { providerUsageRpc } from "../domain/contracts.shared";
import { translator } from "../domain/i18n.shared";
import { localeFromTag } from "../domain/locale.shared";
import { detectClientLocale, useLocale } from "./locale.client";
import { ProviderBalancesCard } from "./balances-main.client";

const PASEO_USAGE_STALE_TIME_MS = 300_000;

function providerForAgent(provider: string | undefined, model: string | null | undefined): string | null {
  if (provider && provider !== "pi") return provider;
  const route = (model ?? "").split(/[/:]/, 1)[0].toLowerCase();
  if (route.includes("anthropic")) return "claude";
  if (route.includes("openai") || route.includes("codex")) return "codex";
  if (route.includes("xai") || route.includes("grok")) return "grok";
  if (route.includes("kimi")) return "kimi";
  if (route.includes("zai")) return "zai";
  return provider === "pi" ? "codex" : null;
}

function ProviderUsagePill(props: PluginComposerPillProps) {
  const { agentId, host, theme } = props;
  const { t } = useLocale(host.id);
  const listUsage = useRpc(providerUsageRpc);
  const agent = useAgent(agentId, ({ provider, model }) => ({ provider, model }));
  const preferredProviderId = providerForAgent(agent?.provider, agent?.model);
  const usageQuery = useQuery({
    queryKey: ["provider-balances", host.id],
    queryFn: () => listUsage({}),
    staleTime: PASEO_USAGE_STALE_TIME_MS,
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const preferred = usageQuery.data?.providers.find((provider) => provider.providerId === preferredProviderId);
  const danger = Boolean(
    usageQuery.error ||
      preferred?.status === "error" ||
      preferred?.windows.some((window) => (window.remainingPct ?? 100) <= 15 || window.tone === "danger") ||
      preferred?.balances?.some((balance) => balance.tone === "danger"),
  );
  const color = danger ? theme.colors.statusDanger : theme.colors.foregroundMuted;

  return (
    <>
      <View style={{ alignItems: "center", justifyContent: "center" }}>
        <Icon name="Gauge" size={15} color={color} />
      </View>
    </>
  );
}

/** Provider 用量面板 —— 与任务列表、Subagents 同在 explorer 里并列。 */
export function ProviderUsagePanel(props: PluginAgentPanelProps) {
  const agent = useAgent(props.agentId, ({ provider, model }) => ({ provider, model }));
  return (
    <View style={{ padding: props.layout.compact ? 10 : 14 }}>
      <ProviderBalancesCard
        theme={props.theme}
        host={props.host}
        layout={props.layout}
        preferredProviderId={providerForAgent(agent?.provider, agent?.model)}
      />
    </View>
  );
}

export function contributeProviderUsagePills(client: PluginClientContext) {
  // 注册时刻拿不到 useLocale；title 只是 tooltip，弹窗内容走完整判定
  const t = translator(localeFromTag(detectClientLocale()) ?? "en");
  const pills = new Map<string, { workspaceId: string; remove: () => void }>();
  let active = true;

  function remove(agentId: string) {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  }

  function upsert(agent: { id: string; workspaceId?: string; archivedAt?: string | null }) {
    if (!active || !agent.workspaceId || agent.archivedAt) {
      remove(agent.id);
      return;
    }
    // Paseo emits an upsert for every status/message change. Re-registering on
    // each one races React unmount cleanup and leaves the visible pill inert.
    const existing = pills.get(agent.id);
    if (existing?.workspaceId === agent.workspaceId) return;
    remove(agent.id);
    const { id: agentId, workspaceId } = agent;
    pills.set(agentId, {
      workspaceId,
      remove: client.addComposerPill({
        id: "provider-usage",
        title: t.usage_nav_open_usage,
        workspaceId,
        agentId,
        Component: ProviderUsagePill,
        onPress() {
          // ⭐ 开侧边面板而不是 Modal —— 它跟文件树、git 变更树在同一个 explorer
          // 容器里并列，能一直开着对照看，不遮挡对话
          client.openPanel("pi-usage", { workspaceId, agentId });
        },
      }),
    });
  }

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "upsert") upsert(update.agent);
    else if ("agentId" in update) remove(update.agentId);
  });

  void client.paseo.agents
    .list({})
    .then(({ entries }) => {
      if (!active) return;
      for (const { agent } of entries) upsert(agent);
    })
    .catch((error) => console.error("[provider-balances] failed to seed usage pills", error));

  return () => {
    active = false;
    unsubscribe();
    for (const registration of pills.values()) registration.remove();
    pills.clear();
  };
}
