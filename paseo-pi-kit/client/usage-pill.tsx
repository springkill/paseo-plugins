import type { PluginCleanup } from "@getpaseo/plugin";
import { type PluginClientContext, useAgent, useRpc } from "@getpaseo/plugin/client";
// ⚠️ Icon 从 `@getpaseo/plugin/react-native` 取，不从 `@getpaseo/plugin`。
// 两处宿主都注入了，但**npm 包本身只导出后者** —— 前者是宿主运行时额外塞进去的。
// 插件里其他文件一律走 /react-native，这里曾经是唯一的例外。
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { providerUsageRpc } from "../shared/contracts";
import { translator } from "../shared/i18n";
import { localeFromTag } from "../shared/locale";
import { detectClientLocale, useLocale } from "./locale";
import { registerAgentPill, type AgentPillContentProps, type AgentPillIconProps, type PushLabel } from "./pill";
import { ProviderBalancesCard } from "./balances-main";

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

/**
 * pill 的图标。用量这条**没有活标签**可推 —— 它本来就只画一个仪表图标，
 * 标签用固定标题。危险态（额度将尽 / provider 报错）靠图标颜色表达。
 */
function createProviderUsagePillIcon(_push: PushLabel) {
  return function ProviderUsagePillIcon({ theme, host, agentId, size, color }: AgentPillIconProps) {
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
    return <Icon name="Gauge" size={size} color={danger ? theme.colors.statusDanger : color} />;
  };
}

/**
 * 点 pill 弹出的 provider 用量。
 *
 * ⚠️ 这里不再套一层带内边距的 View：`ProviderBalancesCard` 自己就是
 * `PanelShell`，外面再包一层会双份内边距，而且把它的 `flex: 1` 卡死。
 */
export function ProviderUsagePopover(props: AgentPillContentProps) {
  const agent = useAgent(props.agentId, ({ provider, model }) => ({ provider, model }));
  return (
    <ProviderBalancesCard
      theme={props.theme}
      host={props.host}
      layout={props.layout}
      preferredProviderId={providerForAgent(agent?.provider, agent?.model)}
    />
  );
}

export function registerProviderUsagePill(client: PluginClientContext): PluginCleanup {
  // 注册时刻拿不到 useLocale；标题只是兜底文案，弹出内容走完整判定
  const t = translator(localeFromTag(detectClientLocale()) ?? "en");
  return registerAgentPill(client, {
    id: "provider-usage",
    title: t.usage_nav_open_usage,
    // ⭐ 用量对任何 provider 都有意义，不限 Pi
    piOnly: false,
    createIcon: createProviderUsagePillIcon,
    Content: ProviderUsagePopover,
  });
}
