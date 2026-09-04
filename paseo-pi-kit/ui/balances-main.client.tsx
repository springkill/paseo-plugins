/**
 * Provider 用量 / 余额。
 *
 * 视觉全部走 `ui/tokens.client.tsx`。这张卡片原本的问题最多：
 *
 * - 卡片边框用 `foregroundMuted`（**前景色**当边框），深色主题上比内容还亮
 * - 9 处 `<Text>` 没写字号
 * - 面板写死 `height: 500 / 580` —— 开在 explorer 侧栏里要么留白要么被截
 * - `Resets` / `Runs out` / `remaining` / `Fetched` 是硬编码英文，没进 i18n
 */

import type { PluginHostProps, PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { output as ZodOutput } from "zod";
import React, { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { providerUsageRpc } from "../domain/contracts.shared";
import type { Translator } from "../domain/i18n.shared";
import { LanguagePicker, useLocale } from "./locale.client";
import {
  ActionButton,
  CardHeader,
  CardShell,
  CardTitle,
  Chip,
  DisclosureHeader,
  EmptyState,
  ErrorText,
  KeyValue,
  PanelShell,
  ProgressBar,
  SPACE,
  text,
  type Tone,
} from "./tokens.client";

const PASEO_USAGE_STALE_TIME_MS = 300_000;
type Provider = ZodOutput<typeof providerUsageRpc.output>["providers"][number];

function formatReset(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatBalance(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return "—";
  if (unit === "usd") return `$${value.toFixed(2)}`;
  if (unit === "tokens") return `${value.toLocaleString()} tokens`;
  return `${value.toLocaleString()} ${unit}`;
}

function ProviderCard({ provider, preferred, theme, t }: {
  provider: Provider;
  preferred: boolean;
  theme: PluginTheme;
  t: Translator;
}) {
  return (
    <CardShell theme={theme} {...(preferred ? { accentColor: theme.colors.accent } : {})}>
      <CardHeader trailing={preferred ? <Chip text={t.usage_preferred} theme={theme} tone="ok" /> : null}>
        <CardTitle label={provider.displayName} theme={theme} />
      </CardHeader>
      <Text style={text(theme, "meta", { muted: true })}>
        {provider.planLabel || provider.sourceLabel || t.usage_connected}
      </Text>

      {provider.windows.map((window) => {
        const used = Math.max(0, Math.min(100, window.usedPct ?? (
          window.remainingPct === null || window.remainingPct === undefined ? 0 : 100 - window.remainingPct
        )));
        const tone = window.tone as Tone | undefined;
        return (
          <View key={window.id} style={{ gap: SPACE.tight }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: SPACE.gap }}>
              <Text style={text(theme, "body", { flex: 1 })}>{window.label}</Text>
              <Text style={text(theme, "body", { strong: true, ...(tone ? { tone } : {}) })}>
                {window.remainingPct === null || window.remainingPct === undefined
                  ? t.usage_used_pct(Math.round(used))
                  : t.usage_left_pct(Math.round(window.remainingPct))}
              </Text>
            </View>
            <ProgressBar percent={used} theme={theme} {...(tone ? { tone } : {})} />
            {window.resetsAt ? (
              <Text style={text(theme, "meta", { muted: true })}>{t.usage_resets(formatReset(window.resetsAt))}</Text>
            ) : null}
            {window.runsOutAt ? (
              <Text style={text(theme, "meta", { tone: "danger" })}>{t.usage_runs_out(formatReset(window.runsOutAt))}</Text>
            ) : null}
          </View>
        );
      })}

      {(provider.balances ?? []).map((balance) => (
        <KeyValue key={balance.id} label={balance.label} theme={theme}>
          <Text style={text(theme, "body", { strong: true, ...(balance.tone ? { tone: balance.tone as Tone } : {}) })}>
            {t.usage_remaining(formatBalance(balance.remaining, balance.unit))}
          </Text>
        </KeyValue>
      ))}

      {(provider.details ?? []).map((detail) => (
        <KeyValue key={detail.id} label={detail.label} theme={theme}>
          <Text style={text(theme, "body", detail.tone ? { tone: detail.tone as Tone } : {})}>{detail.value}</Text>
        </KeyValue>
      ))}

      {provider.error ? <ErrorText error={provider.error} theme={theme} /> : null}
      {provider.windows.length === 0 && (provider.balances ?? []).length === 0 && !provider.error ? (
        <EmptyState label={t.usage_no_windows} theme={theme} />
      ) : null}
    </CardShell>
  );
}

export function ProviderBalancesCard({ theme, host, preferredProviderId }: PluginHostProps & {
  preferredProviderId?: string | null;
}) {
  const localeCtx = useLocale(host.id);
  const t = localeCtx.t;
  const listUsage = useRpc(providerUsageRpc);
  const queryClient = useQueryClient();
  const [showUnavailable, setShowUnavailable] = useState(false);
  const queryKey = ["provider-balances", host.id];
  const usageQuery = useQuery({
    queryKey,
    queryFn: () => listUsage({}),
    staleTime: PASEO_USAGE_STALE_TIME_MS,
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const providers = usageQuery.data?.providers ?? [];
  const visible = providers
    .filter((provider) => provider.status === "available" || provider.status === "error")
    .sort((left, right) => {
      if (left.providerId === preferredProviderId) return -1;
      if (right.providerId === preferredProviderId) return 1;
      return left.displayName.localeCompare(right.displayName);
    });
  const unavailable = providers.filter((provider) => provider.status === "unavailable");

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey });
    await usageQuery.refetch();
  }

  return (
    <PanelShell
      theme={theme}
      title={t.usage_modal_title}
      subtitle={usageQuery.data?.fetchedAt ? t.usage_fetched(formatReset(usageQuery.data.fetchedAt)) : t.usage_subtitle}
      actions={
        <ActionButton
          label={usageQuery.isFetching ? t.usage_action_refreshing : t.usage_action_refresh}
          onPress={() => void refresh()}
          theme={theme}
          disabled={usageQuery.isFetching}
        />
      }
      footer={<LanguagePicker ctx={localeCtx} hostId={host.id} theme={theme} />}
    >
      {usageQuery.isLoading ? (
        <View style={{ padding: SPACE.card, alignItems: "center", gap: SPACE.gap }}>
          <ActivityIndicator color={theme.colors.accent} />
          <EmptyState label={t.usage_loading} theme={theme} />
        </View>
      ) : null}
      {usageQuery.error ? <ErrorText error={usageQuery.error} theme={theme} /> : null}
      {visible.map((provider) => (
        <ProviderCard
          key={provider.providerId}
          t={t}
          provider={provider}
          preferred={provider.providerId === preferredProviderId}
          theme={theme}
        />
      ))}
      {!usageQuery.isLoading && visible.length === 0 ? <EmptyState label={t.usage_empty} theme={theme} /> : null}

      {unavailable.length ? (
        <View style={{ gap: SPACE.tight }}>
          <DisclosureHeader
            open={showUnavailable}
            onPress={() => setShowUnavailable((value) => !value)}
            label={t.usage_toggle_unavailable(showUnavailable, unavailable.length)}
            theme={theme}
          />
          {showUnavailable
            ? unavailable.map((provider) => (
                <KeyValue key={provider.providerId} label={provider.displayName} theme={theme}>
                  <Text style={text(theme, "meta", { muted: true })}>{t.usage_unavailable}</Text>
                </KeyValue>
              ))
            : null}
        </View>
      ) : null}
    </PanelShell>
  );
}
