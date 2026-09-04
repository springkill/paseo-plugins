import type { PluginHostProps, PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { output as ZodOutput } from "zod";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { providerUsageRpc } from "../domain/contracts.shared";

const PASEO_USAGE_STALE_TIME_MS = 300_000;
type Provider = ZodOutput<typeof providerUsageRpc.output>["providers"][number];
type Theme = PluginTheme;

function toneColor(theme: Theme, tone: string | undefined): string {
  if (tone === "danger") return theme.colors.statusDanger;
  if (tone === "warning") return theme.colors.foregroundMuted;
  return theme.colors.accent;
}

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
}: {
  provider: Provider;
  preferred: boolean;
  theme: Theme;
}) {
  const muted = { color: theme.colors.foregroundMuted };
  return (
    <View
      style={{
        gap: 10,
        padding: 12,
        borderWidth: preferred ? 2 : 1,
        borderColor: preferred ? theme.colors.accent : theme.colors.foregroundMuted,
        borderRadius: 10,
      }}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 17, fontWeight: "800" }}>{provider.displayName}</Text>
          {preferred ? (
            <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: "700" }}>当前优先</Text>
          ) : null}
        </View>
        <Text style={muted}>{provider.planLabel || provider.sourceLabel || "已连接"}</Text>
      </View>

      {provider.windows.map((window) => {
        const used = Math.max(0, Math.min(100, window.usedPct ?? (window.remainingPct === null || window.remainingPct === undefined ? 0 : 100 - window.remainingPct)));
        return (
          <View key={window.id} style={{ gap: 5 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{window.label}</Text>
              <Text style={{ color: toneColor(theme, window.tone), fontWeight: "700" }}>
                {window.remainingPct === null || window.remainingPct === undefined ? `${Math.round(used)}% used` : `${Math.round(window.remainingPct)}% left`}
              </Text>
            </View>
            <View style={{ height: 7, borderRadius: 4, backgroundColor: theme.colors.foregroundMuted, overflow: "hidden" }}>
              <View style={{ height: 7, width: `${used}%`, backgroundColor: toneColor(theme, window.tone) }} />
            </View>
            {window.resetsAt ? <Text style={[muted, { fontSize: 11 }]}>Resets {formatReset(window.resetsAt)}</Text> : null}
            {window.runsOutAt ? <Text style={{ color: theme.colors.statusDanger, fontSize: 11 }}>Runs out {formatReset(window.runsOutAt)}</Text> : null}
          </View>
        );
      })}

      {(provider.balances ?? []).map((balance) => (
        <View key={balance.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={muted}>{balance.label}</Text>
          <Text style={{ color: toneColor(theme, balance.tone), fontWeight: "700" }}>
            {formatBalance(balance.remaining, balance.unit)} remaining
          </Text>
        </View>
      ))}

      {(provider.details ?? []).map((detail) => (
        <View key={detail.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={muted}>{detail.label}</Text>
          <Text style={{ color: toneColor(theme, detail.tone) }}>{detail.value}</Text>
        </View>
      ))}

      {provider.error ? <Text style={{ color: theme.colors.statusDanger }}>{provider.error}</Text> : null}
      {provider.windows.length === 0 && (provider.balances ?? []).length === 0 && !provider.error ? (
        <Text style={muted}>Provider 可用，但没有返回额度窗口或余额。</Text>
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
          <Text style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "800" }}>Provider Usage</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            Paseo native usage · 5 minute cache
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh provider usage"
          disabled={usageQuery.isFetching}
          onPress={() => void refresh()}
          style={({ pressed }) => ({
            borderWidth: 1,
            borderColor: theme.colors.foregroundMuted,
            borderRadius: 8,
            paddingHorizontal: 11,
            paddingVertical: 8,
            opacity: usageQuery.isFetching ? 0.45 : pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>
            {usageQuery.isFetching ? "Refreshing…" : "Refresh"}
          </Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 18 }}>
        {usageQuery.isLoading ? (
          <View style={{ padding: 28, alignItems: "center", gap: 8 }}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={{ color: theme.colors.foregroundMuted }}>Loading provider balances…</Text>
          </View>
        ) : null}
        {usageQuery.error ? (
          <Text style={{ color: theme.colors.statusDanger }}>
            {usageQuery.error instanceof Error ? usageQuery.error.message : String(usageQuery.error)}
          </Text>
        ) : null}
        {visible.map((provider) => (
          <ProviderCard
            key={provider.providerId}
            provider={provider}
            preferred={provider.providerId === preferredProviderId}
            theme={theme}
          />
        ))}
        {!usageQuery.isLoading && visible.length === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>No authenticated provider returned usage data.</Text>
        ) : null}

        {unavailable.length ? (
          <View style={{ gap: 8, paddingTop: 4 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowUnavailable((value) => !value)}
              style={{ paddingVertical: 7 }}
            >
              <Text style={{ color: theme.colors.foregroundMuted, fontWeight: "700" }}>
                {showUnavailable ? "Hide" : "Show"} unavailable providers ({unavailable.length})
              </Text>
            </Pressable>
            {showUnavailable
              ? unavailable.map((provider) => (
                  <View key={provider.providerId} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: theme.colors.foregroundMuted }}>
                    <Text style={{ color: theme.colors.foreground }}>{provider.displayName}</Text>
                    <Text style={{ color: theme.colors.foregroundMuted }}>Unavailable</Text>
                  </View>
                ))
              : null}
          </View>
        ) : null}
      </ScrollView>

      {usageQuery.data?.fetchedAt ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>
          Fetched {formatReset(usageQuery.data.fetchedAt)}
        </Text>
      ) : null}
    </View>
  );
}
