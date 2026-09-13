/**
 * 卡片的视觉基线 + 组件套件。
 *
 * ## 为什么要有这个文件
 *
 * 四张卡片（任务 / subagent / 通知 / provider 用量）原本各写各的。实测残留：
 *
 * - 字号散落在 10/11/12/13/15/17/18/20，还有 8 处 `<Text>` **根本没写 fontSize**，
 *   吃 react-native 默认值 —— 于是它们跟旁边的字差一号，谁也说不清差在哪
 * - 圆角 5/8/9/10/12，内边距 5/7/8/9/10/11/12/14/18/28
 * - 图标 14/15/16/17 四种
 * - 两条进度条连轨道颜色都不一样（`surface2` vs `foregroundMuted` —— 后者是**前景色**）
 * - 五份各写各的「展开 / 收起」按钮
 * - `balances` 的卡片边框用 `foregroundMuted`，深色主题上比内容还亮
 *
 * 单看每张都合理，放在同一条时间线上就很杂。
 *
 * ## 规矩
 *
 * ⭐ **卡片里不写 `<Text style={{ … }}>`，一律 `style={text(theme, "body")}`。**
 * ⭐ **不写字面量字号 / 圆角 / 图标尺寸，从 FONT / RADIUS / ICON 取。**
 *
 * 缺档位就在这里加，不要在组件里临时挑一个数。`tests/visual-tokens.test.ts`
 * 会挡住违反的写法 —— 那条测试就是这段话的执行者。
 */

import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { createContext, useContext } from "react";
import { Pressable, ScrollView, Text, View, type TextStyle } from "react-native";

/** 字号只有六档 —— 档位越少越不容易走样。 */
export const FONT = {
  /** 面板标题 */
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
  panelTitle: 24,
  cardTitle: 20,
  rowTitle: 18,
  body: 19,
  meta: 16,
  chip: 14,
} as const;

/** 默认字重也跟着档位走 —— 标题不该有时 700 有时 800。 */
const WEIGHT: Record<keyof typeof FONT, TextStyle["fontWeight"]> = {
  panelTitle: "800",
  cardTitle: "800",
  rowTitle: "700",
  body: "400",
  meta: "400",
  chip: "700",
};

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
  hair: 2,
  /** 嵌套时左侧竖线到内容的距离 */
  rail: 10,
} as const;

/** 图标只有三档，跟字号档位对齐。 */
export const ICON = {
  /** 卡片标题行 */
  card: 16,
  /** 条目行首、composer pill */
  row: 14,
  /** 行内（展开箭头、✓/✗） */
  inline: 12,
} as const;

export const BAR_HEIGHT = 6;

export type Tone = "default" | "ok" | "warning" | "danger";

// ── 所在容器 ────────────────────────────────────────────────────────

/**
 * 同一批组件会出现在两种容器里，而两者的**宿主 chrome 完全不同**：
 *
 * | | 时间线 | composer pill 的 popover |
 * |---|---|---|
 * | 外框 | 没有，卡片自己画 | 宿主画（border + 圆角 + 阴影 + `surface0`） |
 *
 * popover 里的分层**一条边框都不画**，全靠底色：
 * 宿主 `surface0` → `CardShell` `surface1` → `RowShell` `surface2`。
 * | 内边距 | 卡片自己给 | 宿主给 `padding: spacing[3]` |
 * | 滚动 | 时间线滚 | 宿主 `scrollable: true` |
 * | 标题 | 卡片自己画 | 手机是 sheet，宿主已显示 `button.title` |
 * | 宽度 | 跟随时间线 | **280–420** |
 * | 高度 | 不限 | `maxHeight: 440` |
 *
 * ⭐ 在 popover 里继续画卡片边框就会**边框套边框**，内边距也会翻倍。
 * 但 `CardShell` / `RowShell` / `KeyValue` 是两处共享的，逐个透传 `flat`
 * 太脏 —— 用一个上下文让它们自己知道身处哪里。
 *
 * 尺寸与形态都是从宿主 web-ui 产物里读出来的（`MenuSurface` 那处）：
 * `minWidth:280 maxWidth:420 maxHeight:440 scrollable compactMode:"sheet"`。
 */
export type SurfaceKind = "timeline" | "popover";

const SurfaceContext = createContext<SurfaceKind>("timeline");

export function useSurfaceKind(): SurfaceKind {
  return useContext(SurfaceContext);
}

export function SurfaceProvider({ kind, children }: { kind: SurfaceKind; children: React.ReactNode }) {
  return <SurfaceContext.Provider value={kind}>{children}</SurfaceContext.Provider>;
}

export function toneColor(theme: PluginTheme, tone: Tone | undefined): string {
  switch (tone) {
    case "ok": return theme.colors.statusSuccess;
    case "warning": return theme.colors.statusWarning;
    case "danger": return theme.colors.statusDanger;
    default: return theme.colors.foregroundMuted;
  }
}

export type TextOptions = {
  tone?: Tone;
  /** 用次要前景色。`tone` 优先。 */
  muted?: boolean;
  /** 强调色（可点的东西） */
  accent?: boolean;
  /** 覆盖字重 */
  strong?: boolean;
  mono?: boolean;
  italic?: boolean;
  flex?: number;
};

/**
 * 唯一的文字样式入口。
 *
 * ⭐ 卡片里所有 `<Text>` 都必须 `style={text(theme, "…")}`。
 * 直接写内联对象是这套东西上次走样的唯一原因 —— 内联写法漏掉 fontSize
 * 时**不会报错**，只会安静地小一号。
 */
export function text(theme: PluginTheme, variant: keyof typeof FONT, options: TextOptions = {}): TextStyle {
  const color =
    options.tone !== undefined && options.tone !== "default" ? toneColor(theme, options.tone)
    : options.accent ? theme.colors.accent
    : options.muted ? theme.colors.foregroundMuted
    : theme.colors.foreground;
  return {
    color,
    fontSize: FONT[variant],
    lineHeight: LINE[variant],
    fontWeight: options.strong ? "700" : WEIGHT[variant],
    ...(options.mono ? { fontFamily: "monospace" } : {}),
    ...(options.italic ? { fontStyle: "italic" } : {}),
    ...(options.flex !== undefined ? { flex: options.flex } : {}),
  };
}

// ── 原子 ────────────────────────────────────────────────────────────

/** 统一的角标。描边款，不填充 —— 填充款在深色主题上太抢。 */
export function Chip({ text: label, theme, tone, icon }: {
  text: string;
  theme: PluginTheme;
  tone?: Tone;
  icon?: string;
}) {
  const color = toneColor(theme, tone);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.tight,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: RADIUS.chip,
        borderWidth: 1,
        borderColor: color,
      }}
    >
      {icon ? <Icon name={icon} size={ICON.inline} color={color} /> : null}
      <Text style={text(theme, "chip", tone ? { tone } : { muted: true })}>{label}</Text>
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
        backgroundColor: theme.colors.surface2,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${clamped}%`,
          height: BAR_HEIGHT,
          borderRadius: RADIUS.bar,
          backgroundColor: tone && tone !== "default" ? toneColor(theme, tone) : theme.colors.accent,
        }}
      />
    </View>
  );
}

export function Mono({ label, theme, tone }: { label: string; theme: PluginTheme; tone?: Tone }) {
  return (
    <Text selectable numberOfLines={1} style={text(theme, "chip", { mono: true, ...(tone ? { tone } : { muted: true }) })}>
      {label}
    </Text>
  );
}

/** ✓ / ✗。⭐ 布尔量画成这个，不画字面量 `true` / `false`。 */
export function BoolMark({ value, label, theme }: { value: boolean; label: string; theme: PluginTheme }) {
  const tone: Tone = value ? "ok" : "danger";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.tight }}>
      <Icon name={value ? "Check" : "X"} size={ICON.inline} color={toneColor(theme, tone)} />
      <Text style={text(theme, "body", { tone })}>{label}</Text>
    </View>
  );
}

// ── 容器 ────────────────────────────────────────────────────────────

/**
 * 卡片外框。四张卡片的内边距、圆角、描边从此只有一处定义。
 *
 * ⚠️ **在 popover 里它会自动摊平**（无边框、无背景、无内边距）——
 * 宿主的 `MenuSurface` 已经给了边框、圆角、阴影和 `padding: spacing[3]`，
 * 再画一层就是边框套边框、内边距翻倍。见 SurfaceKind 的说明。
 */
export function CardShell({ theme, accentColor, compact, children }: {
  theme: PluginTheme;
  accentColor?: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  if (useSurfaceKind() === "popover") {
    // ⭐ 不描边，改用底色分层：宿主 surface0 → 卡片 surface1 → 行 surface2。
    // 完全摊平（无背景）的话，连着几张卡片会糊成一片分不开。
    // 强调色只用左侧一条竖线，不围一圈。
    return (
      <View
        style={{
          gap: SPACE.gap,
          padding: SPACE.row,
          borderRadius: RADIUS.row,
          backgroundColor: theme.colors.surface1,
          ...(accentColor ? { borderLeftWidth: 3, borderLeftColor: accentColor } : {}),
        }}
      >
        {children}
      </View>
    );
  }
  return (
    <View
      style={{
        gap: SPACE.gap,
        padding: compact ? SPACE.row : SPACE.card,
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
export function CardTitle({ label, theme }: { label: string; theme: PluginTheme }) {
  return (
    <Text numberOfLines={2} style={text(theme, "cardTitle", { flex: 1 })}>
      {label}
    </Text>
  );
}

/**
 * 卡片里的一条。任务、subagent 子任务、子输出、结构化数据的行都用这个。
 *
 * `tone` 只染左边那条竖线和描边，不染背景 —— 整块染色在时间线上太吵。
 *
 * ⚠️ **popover 里改成「填充不描边」**：宿主外框已经有一圈线，行再描边就是
 * 第三层。用 `surface1` 填充在 `surface0` 底上，层次一样清楚且安静。
 */
export function RowShell({ theme, tone, active, children }: {
  theme: PluginTheme;
  tone?: Tone;
  active?: boolean;
  children: React.ReactNode;
}) {
  const accent = tone && tone !== "default" ? toneColor(theme, tone) : undefined;
  if (useSurfaceKind() === "popover") {
    // 行坐在卡片（surface1）之上，所以用 surface2；`active` 不换底色而是加一条
    // 强调竖线 —— 底色只用来表达层级，状态交给竖线，两者不抢。
    return (
      <View
        style={{
          gap: SPACE.tight,
          padding: SPACE.row,
          borderRadius: RADIUS.row,
          backgroundColor: theme.colors.surface2,
          ...(accent || active
            ? { borderLeftWidth: 3, borderLeftColor: accent ?? theme.colors.accent }
            : {}),
        }}
      >
        {children}
      </View>
    );
  }
  return (
    <View
      style={{
        gap: SPACE.tight,
        padding: SPACE.row,
        borderRadius: RADIUS.row,
        borderWidth: 1,
        borderLeftWidth: accent ? 3 : 1,
        borderColor: accent ?? (active ? theme.colors.accent : theme.colors.border),
        backgroundColor: active ? theme.colors.surface2 : theme.colors.surface0,
      }}
    >
      {children}
    </View>
  );
}

/** 条目标题行：行首标记 + 标题 + 右侧尾巴。 */
export function RowHeader({ leading, trailing, children }: {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.gap }}>
      {leading ?? null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.gap, flex: 1, flexWrap: "wrap" }}>
        {children}
      </View>
      {trailing ?? null}
    </View>
  );
}

/** 嵌套内容的左侧竖线。⭐ 结构化数据靠它表达层级，不靠花括号。 */
export function Rail({ theme, tone, children }: {
  theme: PluginTheme;
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        gap: SPACE.gap,
        paddingLeft: SPACE.rail,
        borderLeftWidth: 2,
        borderLeftColor: tone && tone !== "default" ? toneColor(theme, tone) : theme.colors.border,
      }}
    >
      {children}
    </View>
  );
}

/** 元信息横排，自动换行。角标、mono 标识都塞这里。 */
export function MetaRow({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.gap }}>
      {children}
    </View>
  );
}

/**
 * 「标签 + 值」一条。⭐ 结构化数据靠它铺开，不靠 `key: value` 的原样堆叠。
 *
 * `stacked` 时标签单独一行、值另起一段 —— 值是段落或嵌套结构时用。
 */
export function KeyValue({ label, theme, stacked, children }: {
  label: string;
  theme: PluginTheme;
  stacked?: boolean;
  children: React.ReactNode;
}) {
  // ⚠️ popover 只有 280–420 宽，「标签左 + 值右对齐」那一行在这里必然挤成
  // 两行且右对齐很难看 —— 窄容器里一律堆叠。
  if (stacked || useSurfaceKind() === "popover") {
    return (
      <View style={{ gap: SPACE.tight }}>
        <Text style={text(theme, "meta", { muted: true, strong: true })}>{label}</Text>
        {children}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACE.gap }}>
      <Text style={text(theme, "body", { muted: true })}>{label}</Text>
      <View style={{ flex: 1, alignItems: "flex-end" }}>{children}</View>
    </View>
  );
}

/** 小节标题。 */
export function SectionTitle({ label, theme }: { label: string; theme: PluginTheme }) {
  return <Text style={text(theme, "rowTitle", { muted: true })}>{label}</Text>;
}

// ── 交互 ────────────────────────────────────────────────────────────

/** 唯一的「展开 / 收起」。曾经有五份实现，字号和内边距各不相同。 */
export function ExpandToggle({ expanded, onPress, theme, moreLabel, lessLabel }: {
  expanded: boolean;
  onPress: () => void;
  theme: PluginTheme;
  moreLabel: string;
  lessLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: SPACE.tight, paddingVertical: SPACE.hair }}
    >
      <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={ICON.inline} color={theme.colors.accent} />
      <Text style={text(theme, "meta", { accent: true, strong: true })}>{expanded ? lessLabel : moreLabel}</Text>
    </Pressable>
  );
}

/** 可折叠小节的标题行（左侧箭头 + 标题 + 计数）。 */
export function DisclosureHeader({ open, onPress, label, theme, count, tone }: {
  open: boolean;
  onPress: () => void;
  label: string;
  theme: PluginTheme;
  count?: string;
  tone?: Tone;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.tight }}>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={ICON.inline} color={theme.colors.foregroundMuted} />
        <Text style={text(theme, "meta", { strong: true, ...(tone ? { tone } : { muted: true }) })}>{label}</Text>
        {count ? <Text style={text(theme, "chip", { muted: true })}>{count}</Text> : null}
      </View>
    </Pressable>
  );
}

// ── 面板 ────────────────────────────────────────────────────────────

/**
 * 内容外框 —— 同一份内容要出现在两种容器里，chrome 完全不同。
 *
 * ═══════════════════════════════════════════════════════════════════
 * ## `kind: "popover"` —— **这里几乎什么都不画，因为宿主已经画好了**
 *
 * 宿主渲染插件 popover 的方式（从 web-ui 产物读出来的）：
 *
 * ```js
 * <MenuSurface sheetTitle={button.title} minWidth={280} maxWidth={420}
 *              maxHeight={440} scrollable compactMode="sheet">
 *   <View style={{ padding: spacing[3], gap: spacing[2] }}>
 *     <Content … close={close} />
 * ```
 *
 * 宿主负责：外框（border + 圆角 + 阴影 + `surface0`）、内边距、子元素间距、
 * 滚动、以及窄屏的 sheet 标题。所以这里绝不能再套外边距 / ScrollView /
 * `flex: 1` / 边框 —— 那就是「边框套边框、内边距翻倍、双层滚动打架」的来源。
 *
 * ⚠️ 标题只在 `!compact` 时画：`compactMode: "sheet"` 意味着窄屏是 sheet，
 * 宿主已经把 `button.title` 显示在 sheet 头上了。
 *
 * ## `kind: "panel"` —— 相反，这里什么都得自己画
 *
 * 面板是个裸容器：要自己给内边距、滚动、标题、页脚。
 *
 * ⚠️ 面板只在**桌面 web** 才可能落到 explorer 侧栏
 * （`supportsDesktopPaneSplits()` 直接 `return isWeb`）；原生端会退回主区
 * 标签页。两种落点都是宽容器，所以卡片沿用时间线那套（描边 + `surface1`）。
 * ═══════════════════════════════════════════════════════════════════
 */
export function ContentShell({ kind, theme, compact, title, subtitle, actions, footer, children }: {
  kind: "popover" | "panel";
  theme: PluginTheme;
  /** 来自 `layout.compact`。popover 下为 true 表示宿主渲染成了带标题的 sheet。 */
  compact: boolean;
  title: string;
  subtitle?: string | null;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.gap }}>
      <View style={{ flex: 1, gap: SPACE.hair }}>
        <Text numberOfLines={1} style={text(theme, kind === "panel" ? "panelTitle" : "cardTitle")}>{title}</Text>
        {subtitle ? <Text style={text(theme, "meta", { muted: true })}>{subtitle}</Text> : null}
      </View>
      {actions ?? null}
    </View>
  );

  if (kind === "panel") {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
        <View style={{ paddingHorizontal: SPACE.card, paddingTop: SPACE.card, paddingBottom: SPACE.gap }}>
          {header}
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: SPACE.card, paddingBottom: SPACE.card, gap: SPACE.gap }}
        >
          {children}
        </ScrollView>
        {footer ? (
          <View style={{ paddingHorizontal: SPACE.card, paddingVertical: SPACE.gap, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
            {footer}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <SurfaceProvider kind="popover">
      <View style={{ gap: SPACE.gap }}>
        {compact ? null : header}
        {compact && subtitle ? <Text style={text(theme, "meta", { muted: true })}>{subtitle}</Text> : null}
        {compact && actions ? <MetaRow>{actions}</MetaRow> : null}
        {children}
        {footer ? (
          <View style={{ paddingTop: SPACE.gap, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
            {footer}
          </View>
        ) : null}
      </View>
    </SurfaceProvider>
  );
}

/** 次要按钮（面板右上角的「刷新」之类）。 */
export function ActionButton({ label, onPress, theme, disabled }: {
  label: string;
  onPress: () => void;
  theme: PluginTheme;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: RADIUS.inner,
        paddingHorizontal: SPACE.row,
        paddingVertical: SPACE.tight,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={text(theme, "meta", { strong: true })}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({ label, theme }: { label: string; theme: PluginTheme }) {
  return <Text style={text(theme, "body", { muted: true })}>{label}</Text>;
}

export function ErrorText({ error, theme }: { error: unknown; theme: PluginTheme }) {
  return (
    <Text selectable style={text(theme, "body", { tone: "danger" })}>
      {error instanceof Error ? error.message : String(error)}
    </Text>
  );
}
