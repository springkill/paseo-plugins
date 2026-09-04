/**
 * 卡片的视觉基线。
 *
 * ## 为什么要有这个文件
 *
 * 四张卡片（任务 / subagent / 通知 / provider 用量）原本各写各的：
 * 字号散落在 10/11/12/13/15/17/18/20，圆角有 5/8/9/10/12，
 * 两条进度条连轨道颜色都不一样（`surface2` vs `foregroundMuted`）。
 * 单看每张都合理，放在同一条时间线上就很杂。
 *
 * ⭐ **规矩：卡片里不写字面量字号和圆角，一律从这里取。**
 * 需要新档位就在这里加，不要在组件里临时挑一个数。
 */

import type { PluginTheme } from "@getpaseo/plugin";
import React from "react";
import { Text, View } from "react-native";

/** 字号只有五档 —— 档位越少越不容易走样。 */
export const FONT = {
  /** 面板 / 弹窗标题 */
  panelTitle: 18,
  /** 时间线卡片标题 */
  cardTitle: 15,
  /** 卡片内的小节标题、条目标题 */
  rowTitle: 13,
  /** 正文 */
  body: 13,
  /** 次要说明、元信息 */
  meta: 11,
  /** 角标 */
  chip: 10,
} as const;

/** 行高跟着字号走，别各写各的。 */
export const LINE = {
  body: 19,
  meta: 16,
} as const;

export const RADIUS = {
  card: 12,
  row: 9,
  inner: 8,
  chip: 6,
  bar: 4,
} as const;

export const SPACE = {
  card: 12,
  row: 10,
  gap: 8,
  tight: 4,
} as const;

export const BAR_HEIGHT = 6;

export type Tone = "default" | "ok" | "warning" | "danger";

export function toneColor(theme: PluginTheme, tone: Tone | undefined): string {
  switch (tone) {
    case "ok": return theme.colors.statusSuccess ?? theme.colors.accent;
    case "warning": return theme.colors.statusWarning;
    case "danger": return theme.colors.statusDanger;
    default: return theme.colors.foregroundMuted;
  }
}

/** 统一的角标。描边款，不填充 —— 填充款在深色主题上太抢。 */
export function Chip({ text, theme, tone }: { text: string; theme: PluginTheme; tone?: Tone }) {
  const color = toneColor(theme, tone);
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: RADIUS.chip,
        borderWidth: 1,
        borderColor: color,
      }}
    >
      <Text style={{ color, fontSize: FONT.chip, fontWeight: "700" }}>{text}</Text>
    </View>
  );
}

/**
 * 统一的进度条。
 *
 * ⚠️ 轨道用 `surface2` —— 曾经有一处用 `foregroundMuted`，那是**前景色**，
 * 在深色主题上亮得像已填满，跟旁边的卡片对不上。
 */
export function ProgressBar({ percent, theme, tone }: { percent: number; theme: PluginTheme; tone?: Tone }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View
      style={{
        height: BAR_HEIGHT,
        borderRadius: RADIUS.bar,
        backgroundColor: theme.colors.surface2 ?? theme.colors.border,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${clamped}%`,
          height: BAR_HEIGHT,
          borderRadius: RADIUS.bar,
          backgroundColor: tone ? toneColor(theme, tone) : theme.colors.accent,
        }}
      />
    </View>
  );
}

/** 卡片外框。四张卡片的内边距、圆角、描边从此只有一处定义。 */
export function CardShell({ theme, accentColor, children }: {
  theme: PluginTheme;
  accentColor?: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        gap: SPACE.gap,
        padding: SPACE.card,
        borderRadius: RADIUS.card,
        borderWidth: 1,
        borderColor: accentColor ?? theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      {children}
    </View>
  );
}

/** 卡片标题行：图标 + 标题 + 右侧尾巴。 */
export function CardHeader({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.gap }}>
      {children}
      {trailing ?? null}
    </View>
  );
}

/** 标题文字。⭐ 通知卡片曾经漏了 fontSize，用默认值，比别的卡片明显小一号。 */
export function CardTitle({ text, theme }: { text: string; theme: PluginTheme }) {
  return (
    <Text numberOfLines={2} style={{ color: theme.colors.foreground, fontWeight: "800", fontSize: FONT.cardTitle, flex: 1 }}>
      {text}
    </Text>
  );
}
