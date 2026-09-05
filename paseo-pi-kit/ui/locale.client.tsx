/**
 * 语言 hook 与选择器。
 *
 * 设置是**三个 Paseo 插件共用**的，所以这里改一次，rumen 和 provider-balances
 * 下次渲染也跟着变。
 */

import { type PluginTheme, useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { NativeModules, Pressable, Text, View } from "react-native";
import { localeRpc, setLocaleRpc } from "../domain/contracts.shared";
import { translator, type Translator } from "../domain/i18n.shared";
import { LOCALE_NATIVE_NAME, LOCALES, type Locale, type LocalePreference } from "../domain/locale.shared";
import { RADIUS, SPACE, text } from "./tokens.client";

/**
 * 客户端自己是什么语言 —— **对齐 Paseo 自己的取法**。
 *
 * Paseo 的原逻辑（web-ui bundle 里读出来的）：
 *
 * ```js
 * isWeb && navigator.languages.length > 0
 *   ? [...navigator.languages]              // web：浏览器语言列表
 *   : getLocales().map(e => e.languageTag)  // 原生：expo-localization 取系统 locale
 * ```
 *
 * 插件拿不到 `expo-localization`（它不在宿主提供的 external 列表里），
 * 所以原生那半边用 `react-native` 的 `NativeModules` 取同一个系统值，
 * 最后再退到 `Intl`。顺序刻意与 Paseo 一致，免得同一台机器上
 * Paseo 显示一种语言、插件显示另一种。
 *
 * ⚠️ 只负责**报告**，判定在服务端 —— 两边各判一次必然判出不一样的结果。
 */
export function detectClientLocale(): string | undefined {
  // ① web：与 Paseo 完全同源
  try {
    const globals = globalThis as unknown as {
      navigator?: { language?: string; languages?: readonly string[] };
    };
    const languages = globals.navigator?.languages;
    if (languages && languages.length > 0) return languages[0];
    if (globals.navigator?.language) return globals.navigator.language;
  } catch {
    // 沙箱里可能没有 navigator
  }

  // ② 原生：expo-localization 读的就是这两个系统值
  try {
    const modules = (NativeModules ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const ios = modules.SettingsManager?.settings as
      | { AppleLocale?: string; AppleLanguages?: string[] }
      | undefined;
    const fromIos = ios?.AppleLocale ?? ios?.AppleLanguages?.[0];
    if (typeof fromIos === "string" && fromIos) return fromIos;
    const android = modules.I18nManager?.localeIdentifier;
    if (typeof android === "string" && android) return android;
  } catch {
    // 非原生环境没有 NativeModules
  }

  // ③ 兜底
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale; // hermes-ok: 整段在 try/catch 里，Hermes 没有 Intl 时抛出后返回 undefined，调用方继续往下找
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
    queryKey: ["pi-kit", "locale", hostId],
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
      queryClient.setQueryData(["pi-kit", "locale", hostId], value);
      // 共享设置变了，把所有跟语言相关的缓存都作废
      void queryClient.invalidateQueries();
    },
  });

  const options: Array<{ id: LocalePreference; label: string }> = [
    { id: "auto", label: ctx.t.settings_language_auto },
    ...LOCALES.map((locale) => ({ id: locale as LocalePreference, label: LOCALE_NATIVE_NAME[locale] })),
  ];

  return (
    <View style={{ gap: SPACE.tight, flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
      <Text style={text(theme, "meta", { muted: true })}>{ctx.t.settings_language}</Text>
      <View style={{ flexDirection: "row", borderRadius: RADIUS.chip, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" }}>
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
                paddingVertical: SPACE.hair,
                paddingHorizontal: SPACE.gap,
                backgroundColor: selected ? theme.colors.accent : theme.colors.surface1,
                borderLeftWidth: index === 0 ? 0 : 1,
                borderLeftColor: theme.colors.border,
                opacity: ctx.lockedByEnv ? 0.5 : 1,
              }}
            >
              <Text style={selected ? { ...text(theme, "meta", { strong: true }), color: theme.colors.accentForeground } : text(theme, "meta", { strong: true })}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={text(theme, "chip", { muted: true })}>
        {ctx.lockedByEnv ? ctx.t.settings_language_locked : ctx.t.settings_language_shared}
      </Text>
    </View>
  );
}
