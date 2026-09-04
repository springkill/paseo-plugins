/**
 * Pi Kit 设置面板 —— 语言 + 功能开关。
 *
 * ⭐ 这个面板**永远注册**，与开关无关。否则四个功能全关之后，就再也没有
 * 入口把它们打开了。
 *
 * 切开关会让插件自重载（见 domain/features.shared.ts 的取舍说明），所以：
 * - 切换时把整块设为 pending，避免连点造成多次重载
 * - 重载会掐断当前连接，查询失败是**预期内**的，靠 refetch 恢复而不是报错
 */

import { type PluginAgentPanelProps, type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { featuresRpc, setFeatureRpc } from "../domain/contracts.shared";
import { FEATURES, type Feature } from "../domain/features.shared";
import type { Translator } from "../domain/i18n.shared";
import { getClientFlags, setClientFlags, subscribeClientFlags } from "./features.client";
import { LanguagePicker, useLocale } from "./locale.client";
import { PiSubagentsPanel } from "./subagents.client";

function label(feature: Feature, t: Translator): { title: string; desc: string } {
  switch (feature) {
    case "todos": return { title: t.feature_todos, desc: t.feature_todos_desc };
    case "subagents": return { title: t.feature_subagents, desc: t.feature_subagents_desc };
    case "notices": return { title: t.feature_notices, desc: t.feature_notices_desc };
    case "balances": return { title: t.feature_balances, desc: t.feature_balances_desc };
  }
}

export function PiKitSettingsPanel({ theme, host }: PluginWorkspacePanelProps) {
  const ctx = useLocale(host.id);
  const t = ctx.t;
  const getFeatures = useRpc(featuresRpc);
  const setFeature = useRpc(setFeatureRpc);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["pi-kit", "features", host.id],
    queryFn: () => getFeatures({}),
  });

  const mutate = useMutation({
    mutationFn: (input: { feature: Feature; enabled: boolean }) => setFeature(input),
    onSuccess(value) {
      queryClient.setQueryData(["pi-kit", "features", host.id], { flags: value.flags });
      // ⭐ 同一个 client bundle 里的模块级缓存 —— 喂进去，transformer 和 pill 立刻跟上
      setClientFlags(value.flags);
    },
  });

  const flags = query.data?.flags;

  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
      <View style={{ gap: 3 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "800" }}>
          {t.settings_features}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
          {t.settings_features_hint}
        </Text>
      </View>

      {FEATURES.map((feature) => {
        const { title, desc } = label(feature, t);
        const enabled = flags?.[feature] ?? true;
        return (
          <View
            key={feature}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              padding: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface1,
              opacity: flags ? 1 : 0.5,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "700" }}>{title}</Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>{desc}</Text>
            </View>
            <Switch
              value={enabled}
              disabled={!flags || mutate.isPending}
              onValueChange={(next) => mutate.mutate({ feature, enabled: next })}
            />
          </View>
        );
      })}

      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
        {t.settings_menu_note}
      </Text>

      <LanguagePicker ctx={ctx} hostId={host.id} theme={theme} />
    </ScrollView>
  );
}

/**
 * 关掉 subagents 之后，面板与命令面板项仍然在 —— 它们注册在 client bundle，
 * 那边读不到服务端开关，注册时无从判断，而 SDK 又不给注销句柄。
 *
 * 所以入口留着，点进来如实说明，并给一个就地打开的按钮。
 */
export function GatedSubagentsPanel(props: PluginAgentPanelProps) {
  const { t } = useLocale(props.host.id);
  const setFeature = useRpc(setFeatureRpc);
  const [flags, setFlags] = React.useState(getClientFlags);
  React.useEffect(() => subscribeClientFlags(() => setFlags(getClientFlags())), []);

  if (flags.subagents) return <PiSubagentsPanel {...props} />;
  return (
    <View style={{ padding: 16, gap: 10, alignItems: "flex-start" }}>
      <Text style={{ color: props.theme.colors.foreground, fontSize: 13, fontWeight: "700" }}>
        {t.feature_subagents}
      </Text>
      <Text style={{ color: props.theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
        {t.feature_disabled}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void setFeature({ feature: "subagents", enabled: true }).then((r) => setClientFlags(r.flags));
        }}
        style={{
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: 8,
          backgroundColor: props.theme.colors.accent,
        }}
      >
        <Text style={{ color: props.theme.colors.accentForeground, fontSize: 12, fontWeight: "700" }}>
          {t.feature_enable}
        </Text>
      </Pressable>
    </View>
  );
}
