/**
 * 结构化数据的渲染。
 *
 * ⭐ **这是这个插件最初要解决的东西。** Pi 的 `Structured output:` 和 workflow
 * `Return:` 会往正文里塞一坨 `JSON.stringify(v, null, 2)`，Paseo 当普通文本渲染，
 * 于是用户看到一堵墙。
 *
 * 第一版把它画成 JSON 树，结果只是把墙换成了树 —— `true` 还是 `true`，
 * 花括号还在，`[0] [1]` 还在，键名原样摆着。**信息全在，语义全丢。**
 *
 * 现在分两层：
 *
 * - `domain/structured-view.shared.ts` 认形状 —— `ok` 是成败位不是字段，
 *   `key` 是行标题不是字段，`output` 是正文不是字段
 * - 这个文件只负责把认出来的东西画出来
 *
 * 所以这里**不出现任何花括号、方括号、`true` / `false` 字面量**。
 * 层级靠左侧竖线表达，数组靠序号，布尔靠 ✓/✗，空值靠 `—`。
 */

import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/react-native";
import React, { useState } from "react";
import { Text, View } from "react-native";
import {
  type StructuredView,
  type ViewField,
  type ViewNode,
  type ViewValue,
} from "../domain/structured-view.shared";
import type { Translator } from "../domain/i18n.shared";
import {
  BoolMark,
  Chip,
  DisclosureHeader,
  ExpandToggle,
  ICON,
  KeyValue,
  MetaRow,
  Mono,
  ProgressBar,
  Rail,
  RowShell,
  SPACE,
  text,
  toneColor,
  type Tone,
} from "./tokens.client";

/** 正文超过这个长度就折起来 —— 子任务输出动辄几千字。 */
const COLLAPSE_OVER = 320;
/** 一次最多铺几条，剩下的折起来。 */
const LIST_PREVIEW = 5;
/** 这一层往下的嵌套默认收起 —— 再深就不是一眼能看的东西了。 */
const AUTO_COLLAPSE_DEPTH = 2;

/** 段落。长了就折，折的时候不截断在半个词上也不重要 —— 展开就在旁边。 */
function Paragraph({ body, theme, t, tone }: {
  body: string;
  theme: PluginTheme;
  t: Translator;
  tone?: Tone;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = body.length > COLLAPSE_OVER;
  const shown = expanded || !long ? body : `${body.slice(0, COLLAPSE_OVER)}…`;
  return (
    <View style={{ gap: SPACE.tight }}>
      <Text selectable style={text(theme, "body", tone ? { tone } : {})}>{shown}</Text>
      {long ? (
        <ExpandToggle
          expanded={expanded}
          onPress={() => setExpanded((value) => !value)}
          theme={theme}
          moreLabel={t.notice_expand}
          lessLabel={t.notice_collapse}
        />
      ) : null}
    </View>
  );
}

/** 路径：目录压暗、文件名提亮。⭐ 别把一长条绝对路径原样怼在值的位置上。 */
function PathText({ dir, base, theme }: { dir: string; base: string; theme: PluginTheme }) {
  return (
    <Text selectable numberOfLines={2} style={text(theme, "meta", { mono: true, muted: true })}>
      {dir}
      <Text style={text(theme, "meta", { mono: true })}>{base}</Text>
    </Text>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 这个值适合摆在标签右边（短），还是得另起一段（长 / 有结构）。 */
function isInline(value: ViewValue): boolean {
  switch (value.kind) {
    case "bool":
    case "number":
    case "status":
    case "id":
    case "url":
    case "time":
    case "empty":
      return true;
    case "text":
      return !value.multiline && value.text.length <= 32;
    default:
      return false;
  }
}

function ValueView({ value, theme, t, depth }: {
  value: ViewValue;
  theme: PluginTheme;
  t: Translator;
  depth: number;
}) {
  switch (value.kind) {
    case "empty":
      // ⭐ 不画 `null`，不画 `{}`，不画 `[]`
      return <Text style={text(theme, "body", { muted: true })}>—</Text>;
    case "bool":
      return <BoolMark value={value.value} label={value.value ? t.struct_yes : t.struct_no} theme={theme} />;
    case "number":
      return <Text style={text(theme, "body")}>{value.text}</Text>;
    case "percent":
      return (
        <View style={{ gap: SPACE.tight }}>
          <Text style={text(theme, "body")}>{value.text}</Text>
          <ProgressBar percent={value.percent} theme={theme} />
        </View>
      );
    case "status":
      return <Chip text={value.text} theme={theme} tone={value.tone} />;
    case "id":
      return <Mono label={value.short} theme={theme} />;
    case "url":
      return (
        <Text selectable numberOfLines={2} style={text(theme, "meta", { mono: true, accent: true })}>
          {value.full}
        </Text>
      );
    case "time":
      return <Text style={text(theme, "body")}>{formatTime(value.iso)}</Text>;
    case "text":
      return <Paragraph body={value.text} theme={theme} t={t} />;
    case "chips":
      return (
        <MetaRow>
          {value.items.map((item, index) => <Chip key={`${item}-${index}`} text={item} theme={theme} />)}
        </MetaRow>
      );
    case "group":
      return (
        <Rail theme={theme} tone={value.node.tone}>
          <NodeView node={value.node} theme={theme} t={t} depth={depth + 1} />
        </Rail>
      );
    case "list":
      return <NodeList nodes={value.nodes} theme={theme} t={t} depth={depth + 1} />;
  }
}

/** 数组。⭐ 序号从 1 开始，不是 `[0]`。 */
function NodeList({ nodes, theme, t, depth }: {
  nodes: ViewNode[];
  theme: PluginTheme;
  t: Translator;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = nodes.length > LIST_PREVIEW;
  const shown = expanded || !long ? nodes : nodes.slice(0, LIST_PREVIEW);
  return (
    <View style={{ gap: SPACE.gap }}>
      {shown.map((node, index) => (
        <RowShell key={index} theme={theme} tone={node.tone}>
          <NodeView node={node} theme={theme} t={t} depth={depth} fallbackTitle={`${index + 1}`} />
        </RowShell>
      ))}
      {long ? (
        <ExpandToggle
          expanded={expanded}
          onPress={() => setExpanded((value) => !value)}
          theme={theme}
          moreLabel={t.struct_show_all(nodes.length)}
          lessLabel={t.notice_collapse}
        />
      ) : null}
    </View>
  );
}

/** 一个字段。短值摆在标签右边，长值和嵌套结构另起一段。 */
function FieldView({ field, theme, t, depth }: {
  field: ViewField;
  theme: PluginTheme;
  t: Translator;
  depth: number;
}) {
  if (field.label === "") {
    return <ValueView value={field.value} theme={theme} t={t} depth={depth} />;
  }
  // 深处的嵌套默认收起 —— 一屏铺不完的东西不该默认铺开
  const nested = field.value.kind === "group" || field.value.kind === "list";
  const count = field.value.kind === "list" ? String(field.value.nodes.length) : undefined;
  if (nested && depth >= AUTO_COLLAPSE_DEPTH) {
    return <CollapsedField field={field} theme={theme} t={t} depth={depth} count={count} />;
  }
  if (field.value.kind === "path") {
    return (
      <KeyValue label={field.label} theme={theme} stacked>
        <PathText dir={field.value.dir} base={field.value.base} theme={theme} />
      </KeyValue>
    );
  }
  return (
    <KeyValue label={field.label} theme={theme} stacked={!isInline(field.value)}>
      <ValueView value={field.value} theme={theme} t={t} depth={depth} />
    </KeyValue>
  );
}

function CollapsedField({ field, theme, t, depth, count }: {
  field: ViewField;
  theme: PluginTheme;
  t: Translator;
  depth: number;
  count?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: SPACE.tight }}>
      <DisclosureHeader
        open={open}
        onPress={() => setOpen((value) => !value)}
        label={field.label}
        theme={theme}
        {...(count ? { count } : {})}
      />
      {open ? <ValueView value={field.value} theme={theme} t={t} depth={depth} /> : null}
    </View>
  );
}

/**
 * 一「行」。
 *
 * 头部 = ✓/✗ + 标题 + 状态角标 + 短标识。这四样都是从字段里**提上来的** ——
 * 它们不会再出现在下面的字段表里。
 */
export function NodeView({ node, theme, t, depth, fallbackTitle }: {
  node: ViewNode;
  theme: PluginTheme;
  t: Translator;
  depth: number;
  fallbackTitle?: string;
}) {
  const title = node.title ?? fallbackTitle;
  const hasHeader = title !== undefined || node.badge !== undefined || node.ok !== undefined || node.ident !== undefined;
  return (
    <View style={{ gap: SPACE.gap }}>
      {hasHeader ? (
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACE.gap }}>
          {node.ok === undefined ? null : (
            <Icon
              name={node.ok ? "CircleCheck" : "CircleX"}
              size={ICON.row}
              color={toneColor(theme, node.ok ? "ok" : "danger")}
            />
          )}
          {node.titleLabel ? (
            <Text style={text(theme, "chip", { muted: true })}>{node.titleLabel}</Text>
          ) : null}
          {title ? <Text style={text(theme, "rowTitle", { flex: 1 })}>{title}</Text> : null}
          {node.badge ? <Chip text={node.badge} theme={theme} tone={node.tone} /> : null}
          {node.ident ? <Mono label={node.ident.short} theme={theme} /> : null}
        </View>
      ) : null}

      {node.lead ? (
        <Paragraph body={node.lead.text} theme={theme} t={t} {...(node.lead.tone ? { tone: node.lead.tone } : {})} />
      ) : null}

      {node.fields.map((field, index) => (
        <FieldView key={`${field.key}-${index}`} field={field} theme={theme} t={t} depth={depth} />
      ))}

      {/* 空字段折成一行 —— 逐条画 `—` 只会把真正有内容的那几条淹掉 */}
      {node.emptyLabels.length ? (
        <Text style={text(theme, "meta", { muted: true })}>
          {t.struct_empty_fields(node.emptyLabels.join("、"))}
        </Text>
      ) : null}
    </View>
  );
}

/** 结构化数据整块。顶上一句自动概览，下面是行。 */
export function StructuredBlock({ view, theme, t }: {
  view: StructuredView;
  theme: PluginTheme;
  t: Translator;
}) {
  const { ok, failed, other } = view.counts;
  const total = ok + failed + other;
  return (
    <View style={{ gap: SPACE.gap }}>
      {total > 1 ? (
        <MetaRow>
          {ok ? <Chip text={t.struct_count_ok(ok)} theme={theme} tone="ok" /> : null}
          {failed ? <Chip text={t.struct_count_failed(failed)} theme={theme} tone="danger" /> : null}
          {other ? <Chip text={t.struct_count_other(other)} theme={theme} /> : null}
        </MetaRow>
      ) : null}
      {view.nodes.length === 1 ? (
        <NodeView node={view.nodes[0]!} theme={theme} t={t} depth={0} />
      ) : (
        <NodeList nodes={view.nodes} theme={theme} t={t} depth={0} />
      )}
    </View>
  );
}
