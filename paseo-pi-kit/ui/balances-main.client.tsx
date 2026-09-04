import type { PluginHostProps, PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { output as ZodOutput } from "zod";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { providerUsageRpc } from "../domain/contracts.shared";
import type { Translator } from "../domain/i18n.shared";
import { LanguagePicker, useLocale } from "./locale.client";
import { FONT, LINE, ProgressBar, RADIUS, toneColor, type Tone } from "./tokens.client";

const PASEO_USAGE_STALE_TIME_MS = 300_000;
type Provider = ZodOutput<typeof providerUsageRpc.output>["providers"][number];
type Theme = PluginTheme;

function formatReset(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBalance(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return "—";
  if (unit === "usd") return `$${value.toFixed(2)}`;
  if (unit === "tokens") return `${value.toLocaleString()} tokens`;
  return `${value.toLocaleString()} ${unit}`;
}

function ProviderCard({
  provider,
  preferred,
  theme,
  t,
}: {
  provider: Provider;
  preferred: boolean;
  theme: Theme;
  t: Translator;
}) {
  const muted = { color: theme.colors.foregroundMuted };
  return (
    <View
      style={{
        gap: 10,
        padding: 12,
        borderWidth: preferred ? 2 : 1,
        borderColor: preferred ? theme.colors.accent : theme.colors.foregroundMuted,
        borderRadius: RADIUS.card,
      }}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: FONT.cardTitle, fontWeight: "800" }}>{provider.displayName}</Text>
          {preferred ? (
            <Text style={{ color: theme.colors.accent, fontSize: FONT.meta, fontWeight: "700" }}>{t.usage_preferred}</Text>
          ) : null}
        </View>
        <Text style={muted}>{provider.planLabel || provider.sourceLabel || t.usage_connected}</Text>
      </View>

      {provider.windows.map((window) => {
        const used = Math.max(0, Math.min(100, window.usedPct ?? (window.remainingPct === null || window.remainingPct === undefined ? 0 : 100 - window.remainingPct)));
        return (
          <View key={window.id} style={{ gap: 5 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{window.label}</Text>
              <Text style={{ color: toneColor(theme, window.tone as Tone | undefined), fontWeight: "700" }}>
                {window.remainingPct === null || window.remainingPct === undefined ? `${Math.round(used)}% used` : `${Math.round(window.remainingPct)}% left`}
              </Text>
            </View>
            <ProgressBar percent={used} theme={theme} tone={window.tone} />
            {window.resetsAt ? <Text style={[muted, { fontSize: FONT.meta }]}>Resets {formatReset(window.resetsAt)}</Text> : null}
            {window.runsOutAt ? <Text style={{ color: theme.colors.statusDanger, fontSize: FONT.meta }}>Runs out {formatReset(window.runsOutAt)}</Text> : null}
          </View>
        );
      })}

      {(provider.balances ?? []).map((balance) => (
        <View key={balance.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={muted}>{balance.label}</Text>
          <Text style={{ color: toneColor(theme, balance.tone as Tone | undefined), fontWeight: "700" }}>
            {formatBalance(balance.remaining, balance.unit)} remaining
          </Text>
        </View>
      ))}

      {(provider.details ?? []).map((detail) => (
        <View key={detail.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={muted}>{detail.label}</Text>
          <Text style={{ color: toneColor(theme, detail.tone as Tone | undefined) }}>{detail.value}</Text>
        </View>
      ))}

      {provider.error ? <Text style={{ color: theme.colors.statusDanger }}>{provider.error}</Text> : null}
      {provider.windows.length === 0 && (provider.balances ?? []).length === 0 && !provider.error ? (
        <Text style={muted}>{t.usage_no_windows}</Text>
      ) : null}
    </View>
  );
}

export function ProviderBalancesCard({
  theme,
  layout,
  host,
  preferredProviderId,
}: PluginHostProps & { preferredProviderId?: string | null }) {
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
    <View style={{ width: "100%", height: layout.compact ? 500 : 580, gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <View style={{ gap: 2 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: FONT.panelTitle, fontWeight: "800" }}>{t.usage_modal_title}</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT.meta }}>
            Paseo native usage · 5 minute cache
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.usage_action_refresh_a11y}
          disabled={usageQuery.isFetching}
          onPress={() => void refresh()}
          style={({ pressed }) => ({
            borderWidth: 1,
            borderColor: theme.colors.foregroundMuted,
            borderRadius: RADIUS.inner,
            paddingHorizontal: 11,
            paddingVertical: 8,
            opacity: usageQuery.isFetching ? 0.45 : pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>
            {usageQuery.isFetching ? t.usage_action_refreshing : t.usage_action_refresh}
          </Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 18 }}>
        {usageQuery.isLoading ? (
          <View style={{ padding: 28, alignItems: "center", gap: 8 }}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={{ color: theme.colors.foregroundMuted }}>{t.usage_loading}</Text>
          </View>
        ) : null}
        {usageQuery.error ? (
          <Text style={{ color: theme.colors.statusDanger }}>
            {usageQuery.error instanceof Error ? usageQuery.error.message : String(usageQuery.error)}
          </Text>
        ) : null}
        {visible.map((provider) => (
          <ProviderCard t={t}
            key={provider.providerId}
            provider={provider}
            preferred={provider.providerId === preferredProviderId}
            theme={theme}
          />
        ))}
        {!usageQuery.isLoading && visible.length === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>{t.usage_empty}</Text>
        ) : null}

        {unavailable.length ? (
          <View style={{ gap: 8, paddingTop: 4 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowUnavailable((value) => !value)}
              style={{ paddingVertical: 7 }}
            >
              <Text style={{ color: theme.colors.foregroundMuted, fontWeight: "700" }}>
                {t.usage_toggle_unavailable(showUnavailable, unavailable.length)}
              </Text>
            </Pressable>
            {showUnavailable
              ? unavailable.map((provider) => (
                  <View key={provider.providerId} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: theme.colors.foregroundMuted }}>
                    <Text style={{ color: theme.colors.foreground }}>{provider.displayName}</Text>
                    <Text style={{ color: theme.colors.foregroundMuted }}>{t.usage_unavailable}</Text>
                  </View>
                ))
              : null}
          </View>
        ) : null}
      </ScrollView>

      {usageQuery.data?.fetchedAt ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT.chip }}>
          Fetched {formatReset(usageQuery.data.fetchedAt)}
        </Text>
      ) : null}
      <LanguagePicker ctx={localeCtx} hostId={host.id} theme={theme} />
    </View>
  );
}
