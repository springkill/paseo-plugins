/**
 * 语言 hook 与选择器。
 *
 * 设置是**三个 Paseo 插件共用**的，所以这里改一次，rumen 和 provider-balances
 * 下次渲染也跟着变。
 */

import { type PluginTheme, useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { localeRpc, setLocaleRpc } from "../domain/contracts.shared";
import { translator, type Translator } from "../domain/i18n.shared";
import { LOCALE_NATIVE_NAME, LOCALES, type Locale, type LocalePreference } from "../domain/locale.shared";

/**
 * 客户端自己是什么语言。
 *
 * 只负责**报告**，判定在服务端 —— 两边各判一次必然判出不一样的结果。
 * Paseo 能从手机或浏览器访问，所以"看界面的人"和"跑 daemon 的机器"要分开。
 */
export function detectClientLocale(): string | undefined {
  try {
    const globals = globalThis as unknown as {
      navigator?: { language?: string; languages?: readonly string[] };
    };
    const fromNavigator = globals.navigator?.languages?.[0] ?? globals.navigator?.language;
    if (fromNavigator) return fromNavigator;
  } catch {
    // 沙箱里可能没有 navigator
  }
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

export interface LocaleContext {
  locale: Locale;
  t: Translator;
  clientLocale: string | undefined;
  preference: LocalePreference;
  lockedByEnv: boolean;
}

export function useLocale(hostId: string): LocaleContext {
  const clientLocale = React.useMemo(() => detectClientLocale(), []);
  const getLocale = useRpc(localeRpc);
  const query = useQuery({
    queryKey: ["provider-balances", "locale", hostId],
    queryFn: () => getLocale({ clientLocale }),
    staleTime: 60_000,
    retry: 0,
  });
  // 服务端答复回来之前先用客户端自己的语言兜着 —— 首帧闪一下英文比首帧空白好
  const fallback: Locale = clientLocale?.toLowerCase().startsWith("zh") ? "zh" : "en";
  const locale = query.data?.resolved ?? fallback;
  return {
    locale,
    t: translator(locale),
    clientLocale,
    preference: query.data?.preference ?? "auto",
    lockedByEnv: query.data?.lockedByEnv ?? false,
  };
}

/** 紧凑的语言选择器。放在弹窗页脚，不抢主内容的位置。 */
export function LanguagePicker({ ctx, hostId, theme }: {
  ctx: LocaleContext;
  hostId: string;
  theme: PluginTheme;
}) {
  const setLocale = useRpc(setLocaleRpc);
  const queryClient = useQueryClient();
  const mutate = useMutation({
    mutationFn: (preference: LocalePreference) => setLocale({ preference, clientLocale: ctx.clientLocale }),
    onSuccess(value) {
      queryClient.setQueryData(["provider-balances", "locale", hostId], value);
      // 共享设置变了，把所有跟语言相关的缓存都作废
      void queryClient.invalidateQueries();
    },
  });

  const options: Array<{ id: LocalePreference; label: string }> = [
    { id: "auto", label: ctx.t.settings_language_auto },
    ...LOCALES.map((locale) => ({ id: locale as LocalePreference, label: LOCALE_NATIVE_NAME[locale] })),
  ];

  return (
    <View style={{ gap: 5, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{ctx.t.settings_language}</Text>
        <View style={{ flexDirection: "row", borderRadius: 7, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" }}>
          {options.map((option, index) => {
            const selected = ctx.preference === option.id;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: ctx.lockedByEnv }}
                disabled={ctx.lockedByEnv || mutate.isPending}
                onPress={() => mutate.mutate(option.id)}
                style={{
                  paddingVertical: 4,
                  paddingHorizontal: 9,
                  backgroundColor: selected ? theme.colors.accent : theme.colors.surface1,
                  borderLeftWidth: index === 0 ? 0 : 1,
                  borderLeftColor: theme.colors.border,
                  opacity: ctx.lockedByEnv ? 0.5 : 1,
                }}
              >
                <Text style={{ color: selected ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 11, fontWeight: "600" }}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, lineHeight: 14 }}>
        {ctx.lockedByEnv ? ctx.t.settings_language_locked : ctx.t.settings_language_shared}
      </Text>
    </View>
  );
}
