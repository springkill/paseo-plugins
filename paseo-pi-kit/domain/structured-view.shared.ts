/**
 * 把任意结构化数据变成「人能读的东西」的视图模型。
 *
 * ## 为什么需要这一层
 *
 * Pi 的 workflow / subagent 完成通知里会带一坨 JSON。第一版直接画成 JSON 树 ——
 * 键名原样、`true` 原样、空对象画成 `{}`、数组画成 `[0] [1]`。信息全在，语义全丢。
 *
 * ⭐ **因为那坨 JSON 根本不是配置对象，是「一串子任务的运行结果」。**
 * 实测（36 条真实通知里能解析出来的载荷）键频次：
 *
 * ```
 * runId:string 11 │ ok:boolean 9 │ output:string 9 │ error:string 3
 * ```
 *
 * 主形状就两种：
 *
 * - `[{ ok, output, runId, error?, key?, agent? }, …]`  —— 并行子运行的结果表
 * - `{ seed: {…}, parallel: [ … ] }`                    —— 分步 workflow
 *
 * 所以这里做的是**形状识别**：认出「这是个运行结果」之后，`ok` 就该变成行首的
 * ✓/✗ 和行的色调，`key` 该变成行标题，`output` 该变成正文段落 —— 而不是三个并列的键值对。
 *
 * ## 分层
 *
 * 这个文件**只产出视图模型，不碰 React、不碰主题、不碰文案**。
 * 画出来是 `ui/structured.client.tsx` 的事。这样形状识别能脱离渲染单测
 * （见 `tests/structured-view.test.ts`，用例是从真实会话里抠的）。
 *
 * ⚠️ 标签用英文单词化（`artifactPaths` → `Artifact paths`）**不是没做 i18n**：
 * 键名本身就是生产方写死的英文标识符，翻译它只会让人对不上原始数据。
 * 界面自己的文案（「空字段」「展开」）才走 i18n，在渲染层。
 */

export type ViewTone = "default" | "ok" | "warning" | "danger";

/** 一个值该怎么画。判定逻辑集中在 classify()。 */
export type ViewValue =
  /** null / "" / [] / {} —— 画成 `—`，不画 `null` 也不画花括号 */
  | { kind: "empty" }
  | { kind: "bool"; value: boolean }
  | { kind: "number"; text: string }
  | { kind: "percent"; percent: number; text: string }
  /** 状态词（completed / failed / …），带色调 */
  | { kind: "status"; text: string; tone: ViewTone }
  /** UUID / 长 hex —— 只画前 8 位，全文可选中 */
  | { kind: "id"; short: string; full: string }
  | { kind: "path"; dir: string; base: string; full: string }
  | { kind: "url"; full: string }
  | { kind: "time"; iso: string }
  | { kind: "text"; text: string; multiline: boolean }
  /** 全是短标量的数组 —— 画成一排角标 */
  | { kind: "chips"; items: string[] }
  | { kind: "group"; node: ViewNode }
  | { kind: "list"; nodes: ViewNode[] };

export type ViewField = { key: string; label: string; value: ViewValue };

/**
 * 一「行」。运行结果、嵌套对象、数组元素都归一成这个形状。
 *
 * 认出是运行结果时，`ok` / `status` / `key` / `output` 这些键会被**吃进**
 * tone / badge / title / lead，不再出现在 `fields` 里 —— 这就是去掉 JSON 味的关键。
 */
export type ViewNode = {
  title?: string;
  /** 标题是从某个字段提上来的时候，它原来的标签。渲染成标题前面的小灰字。 */
  titleLabel?: string;
  tone?: ViewTone;
  /** 数据里原样的状态词。⚠️ 不翻译，它是数据不是文案。 */
  badge?: string;
  /** badge 取自哪个键 —— 概览计数只认真正的成败位，不认 severity。 */
  badgeKey?: string;
  /** `ok` 布尔量，渲染层画成 ✓/✗ 并配本地化的词 */
  ok?: boolean;
  /** 标题右边的短标识（runId 前 8 位之类） */
  ident?: { short: string; full: string };
  /** 提升到字段表上方的正文（output / error / message） */
  lead?: { text: string; tone?: ViewTone };
  fields: ViewField[];
  /** 值为空、已被略去的字段标签。渲染成一行灰字，不逐条占地方。 */
  emptyLabels: string[];
};

export type StructuredView = {
  /** 「3 完成 · 1 失败」这类概览的原料。全是 0 时渲染层不画。 */
  counts: { ok: number; failed: number; other: number };
  nodes: ViewNode[];
};

const MAX_DEPTH = 6;

/** 概览计数只认这几个键 —— 它们才是「这次跑成没跑成」。 */
const VERDICT_KEYS = ["status", "state", "outcome", "verdict"];

// ── 键名语义 ────────────────────────────────────────────────────────
// 都是生产方（pi-subagents 的 workflow executor）实际会写出来的键。
// 认不出也不会坏，只是退回成普通字段。

const TITLE_KEYS = ["key", "name", "title", "label", "agent", "subAgentType", "step"];
const OK_KEYS = ["ok", "success", "succeeded", "passed", "valid"];
const STATUS_KEYS = ["status", "state", "outcome", "verdict", "severity", "level"];
const IDENT_KEYS = ["runId", "callId", "id", "uuid", "sha", "hash"];
/** 会被提升成正文的键。⚠️ 只在值是非空字符串时才吃。 */
const BODY_KEYS = ["output", "error", "message", "text", "summary", "reason", "detail", "content", "stdout"];

const STATUS_TONES: Record<string, ViewTone> = {
  completed: "ok", complete: "ok", success: "ok", succeeded: "ok", ok: "ok",
  passed: "ok", pass: "ok", done: "ok", available: "ok", resolved: "ok",
  failed: "danger", failure: "danger", error: "danger", rejected: "danger",
  invalid: "danger", unavailable: "danger", crashed: "danger",
  running: "default", pending: "default", queued: "default", idle: "default",
  skipped: "warning", stopped: "warning", canceled: "warning", cancelled: "warning",
  paused: "warning", partial: "warning", degraded: "warning", warning: "warning",
  "timed-out": "warning", "not-resumable": "warning", unresolved: "warning",
  // 严重度也走这套 —— 审计类结构化输出里 severity 是最该一眼看到的位
  blocking: "danger", critical: "danger", high: "danger", major: "danger",
  medium: "warning", moderate: "warning", minor: "warning",
  low: "default", info: "default", none: "default",
};

/**
 * 状态位上的词不在上表里时的兜底。
 *
 * ⭐ 真实数据里 `verdict` 长这样：`PASS_RQ3_CROSS_DOCUMENT_CONTROL_SUCCESSOR`、
 * `FAIL_ACTIVATION_PRECONDITIONS` —— 全词表永远追不上，但前缀是稳的。
 * 认不出就 default，不会误报成红色。
 */
function toneOfStatusWord(text: string): ViewTone {
  const known = STATUS_TONES[text.toLowerCase()];
  if (known) return known;
  if (/^(pass|ok|success|succeed|approve|accept|green)/i.test(text)) return "ok";
  if (/^(fail|error|reject|block|deny|abort|crash|red)/i.test(text)) return "danger";
  if (/^(warn|partial|skip|pause|stale|degrad|amber)/i.test(text)) return "warning";
  return "default";
}

/** 首字母大写后放进标签的缩写词 —— 不这么做会得到 `Run id` / `Ok`。 */
const ACRONYMS = new Set(["id", "ids", "url", "urls", "uri", "api", "json", "yaml", "sha", "uuid", "ok", "cpu", "io", "ms", "pct", "http", "https", "cli", "sql", "html", "css", "npm", "pid"]);

/** `artifactPaths` / `artifact_paths` / `artifact-paths` → `Artifact paths`。 */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return key;
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return lower;
    })
    .join(" ");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

// ── 标量识别 ────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]{32,}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/;
const URL_RE = /^https?:\/\/\S+$/i;
const PATH_RE = /^(?:\/|~\/|\.{1,2}\/)[^\s]*\/[^\s]*$/;
/** 单行且不长 —— 超过就当段落，另起一行画。 */
const INLINE_MAX = 88;

function splitPath(full: string): { dir: string; base: string } {
  const index = full.lastIndexOf("/");
  return index < 0 ? { dir: "", base: full } : { dir: full.slice(0, index + 1), base: full.slice(index + 1) };
}

function classifyString(key: string, raw: string): ViewValue {
  const text = raw.trim();
  if (text === "") return { kind: "empty" };
  if (UUID_RE.test(text) || HEX_RE.test(text)) {
    return { kind: "id", short: text.slice(0, 8), full: text };
  }
  if (URL_RE.test(text)) return { kind: "url", full: text };
  if (ISO_RE.test(text) && !Number.isNaN(Date.parse(text))) return { kind: "time", iso: text };
  if (PATH_RE.test(text)) return { kind: "path", full: text, ...splitPath(text) };
  // ⚠️ 状态角标只给**状态位**上的短词。任何字符串都配色的话，
  // 一段正文里恰好只写了 "error" 就会被画成角标。
  if ((STATUS_KEYS.includes(key) || OK_KEYS.includes(key)) && text.length <= 60 && !text.includes("\n")) {
    return { kind: "status", text, tone: toneOfStatusWord(text) };
  }
  return { kind: "text", text: raw, multiline: raw.includes("\n") || text.length > INLINE_MAX };
}

function classifyNumber(key: string, value: number): ViewValue {
  if (!Number.isFinite(value)) return { kind: "text", text: String(value), multiline: false };
  if (/(pct|percent|percentage)$/i.test(key) && value >= 0 && value <= 100) {
    return { kind: "percent", percent: value, text: `${Math.round(value)}%` };
  }
  if (/(ratio|progress)$/i.test(key) && value >= 0 && value <= 1) {
    return { kind: "percent", percent: value * 100, text: `${Math.round(value * 100)}%` };
  }
  return { kind: "number", text: value.toLocaleString() };
}

/** 全是短标量 → 一排角标；否则退回逐条画。 */
function asChips(items: unknown[]): string[] | null {
  if (items.length === 0 || items.length > 12) return null;
  const chips: string[] = [];
  for (const item of items) {
    if (typeof item === "string" && !item.includes("\n") && item.trim().length > 0 && item.length <= 40) {
      chips.push(item.trim());
    } else if (typeof item === "number" || typeof item === "boolean") {
      chips.push(String(item));
    } else {
      return null;
    }
  }
  return chips;
}

function classify(key: string, value: unknown, depth: number): ViewValue {
  if (isEmptyValue(value)) return { kind: "empty" };
  if (typeof value === "boolean") return { kind: "bool", value };
  if (typeof value === "number") return classifyNumber(key, value);
  if (typeof value === "string") return classifyString(key, value);
  if (depth >= MAX_DEPTH) return { kind: "text", text: JSON.stringify(value) ?? "", multiline: true };
  if (Array.isArray(value)) {
    const chips = asChips(value);
    if (chips) return { kind: "chips", items: chips };
    return { kind: "list", nodes: value.map((item, index) => toNode(item, depth + 1, index)) };
  }
  if (isPlainObject(value)) return { kind: "group", node: toNode(value, depth + 1) };
  return { kind: "text", text: String(value), multiline: false };
}

// ── 运行结果识别 ────────────────────────────────────────────────────

/**
 * 这个对象是不是「一次运行的结果」。
 *
 * 判据要两边都占：既有成败位（`ok` 布尔 / `status` 字符串），
 * 又有身份或产物（`runId` / `output` / `error` …）。
 * 只占一边的话，一个恰好带 `id` 字段的普通配置对象也会被误判。
 */
function isRunResult(object: Record<string, unknown>): boolean {
  const hasVerdict =
    OK_KEYS.some((key) => typeof object[key] === "boolean") ||
    STATUS_KEYS.some((key) => typeof object[key] === "string" && (object[key] as string).trim().length > 0);
  if (!hasVerdict) return false;
  return (
    IDENT_KEYS.some((key) => typeof object[key] === "string") ||
    BODY_KEYS.some((key) => typeof object[key] === "string")
  );
}

function firstString(object: Record<string, unknown>, keys: string[], accept: (value: string) => boolean): { key: string; value: string } | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim() !== "" && accept(value.trim())) return { key, value: value.trim() };
  }
  return null;
}

/**
 * 一个值 → 一「行」。
 *
 * ⭐ **身份 / 状态 / 正文的提取是无条件的**，不只对运行结果做。
 * 第一版只在认出「运行结果」时才提取，于是审计类载荷
 * （`{ verdict, findings: [{ id, severity, finding, evidence }] }`）
 * 整个退回成键值对堆 —— 那正是「看着像个 JSON 格式化器」的来源。
 * 提取本身是保守的：拿不到就留在 `fields` 里，不会丢数据。
 */
function toNode(value: unknown, depth: number, index?: number): ViewNode {
  if (!isPlainObject(value)) {
    // 数组里的标量：没有标题，只有一个匿名值
    return {
      fields: [{ key: "", label: "", value: classify("", value, depth) }],
      emptyLabels: [],
      ...(index === undefined ? {} : { title: `${index + 1}` }),
    };
  }

  const consumed = new Set<string>();
  const node: ViewNode = { fields: [], emptyLabels: [] };

  // 1. 成败位 → 行的色调，不再当字段
  for (const key of OK_KEYS) {
    if (typeof value[key] === "boolean") {
      node.ok = value[key] as boolean;
      consumed.add(key);
      break;
    }
  }
  // ⚠️ 角标只收**短单行**的状态值。长文本挂在状态键上时留作正文字段，
  // 否则一整段话会被塞进角标里。
  const status = firstString(value, STATUS_KEYS, (v) => v.length <= 60 && !v.includes("\n"));
  if (status) {
    node.badge = status.value;
    node.badgeKey = status.key;
    consumed.add(status.key);
  }
  node.tone =
    node.ok === false ? "danger"
    : node.ok === true ? "ok"
    : node.badge ? toneOfStatusWord(node.badge)
    : "default";

  // 2. 身份 → 行标题。runId 这种纯标识不当标题，它是标题右边的 ident。
  const title = firstString(value, TITLE_KEYS, (v) => v.length <= 80 && !v.includes("\n"));
  if (title) {
    node.title = title.value;
    consumed.add(title.key);
  }
  const ident = firstString(value, IDENT_KEYS, (v) => v.length <= 60 && !v.includes("\n"));
  if (ident && !consumed.has(ident.key)) {
    node.ident = { short: UUID_RE.test(ident.value) || HEX_RE.test(ident.value) ? ident.value.slice(0, 8) : ident.value, full: ident.value };
    consumed.add(ident.key);
    // 没有别的身份可用时标识本身就当标题 —— 但**别两边都画**，
    // 否则 `{ id: "G00A-R04-ROLE-001", … }` 会得到 `G00A-R04-ROLE-001 #G00A-R04-ROLE-001`。
    if (!node.title) {
      node.title = node.ident.short;
      delete node.ident;
    }
  }

  // 3. 正文。失败时优先 error —— 那才是人要看的。
  const bodyOrder = node.tone === "danger"
    ? ["error", ...BODY_KEYS.filter((key) => key !== "error")]
    : BODY_KEYS;
  const body = firstString(value, bodyOrder, () => true);
  if (body) {
    const text = (value[body.key] as string).trim();
    node.lead = { text, ...(body.key === "error" ? { tone: "danger" as const } : {}) };
    consumed.add(body.key);
    // ⭐ 失败的运行常常 error 和 output 装的是同一段话（error 多接一段
    // `Run fan-out: …`）。只比全等的话这两条还是会双份显示。
    for (const key of BODY_KEYS) {
      const other = value[key];
      if (key === body.key || typeof other !== "string") continue;
      const trimmed = other.trim();
      if (trimmed.length >= 16 && (text.includes(trimmed) || trimmed.includes(text))) consumed.add(key);
    }
  }

  // 数组里的行没有 key/agent 时给个序号，方便指认「第 3 个失败了」
  if (!node.title && index !== undefined && (node.ok !== undefined || node.badge || node.lead)) {
    node.title = `#${index + 1}`;
  }

  for (const [key, raw] of Object.entries(value)) {
    if (consumed.has(key)) continue;
    const label = humanizeKey(key);
    if (isEmptyValue(raw)) {
      node.emptyLabels.push(label);
      continue;
    }
    node.fields.push({ key, label, value: classify(key, raw, depth) });
  }

  // ⭐ 还是没标题时，把**第一个短字段**提成标题 —— 表格的第一列就是身份。
  // 这条按**形状**判定不按键名，所以不用去猜生产方会写 `check` 还是 `item`
  // 还是 `rule`。原来的标签留在 titleLabel，不丢信息。
  //
  // ⚠️ 别把它降级成「把唯一字段的标签当标题」—— 第一版那么写，
  // `{ runId: "0c13cb76-…" }` 就画成标题 `Run ID` 底下再挂一条 `Run ID: #0c13cb76`。
  // ⚠️ 退化情形：整个对象只有一个标识（真实数据里 `{ runId: "…" }` 就是这样）。
  // 这时把它提成标题反而把标签弄丢了 —— 画成 `0c13cb76` 谁也不知道那是什么。
  // 退回成普通字段，让渲染层画 `Run ID  0c13cb76`。
  if (
    ident !== null &&
    node.ok === undefined &&
    node.badge === undefined &&
    node.lead === undefined &&
    node.fields.length === 0 &&
    node.emptyLabels.length === 0 &&
    (node.title === ident.value || node.title === ident.value.slice(0, 8))
  ) {
    delete node.title;
    delete node.ident;
    node.fields.push({ key: ident.key, label: humanizeKey(ident.key), value: classify(ident.key, ident.value, depth) });
  }

  const first = node.fields[0];
  if (
    node.title === undefined &&
    node.lead === undefined &&
    node.fields.length >= 2 &&
    first !== undefined &&
    first.value.kind === "text" &&
    !first.value.multiline
  ) {
    node.title = first.value.text.trim();
    node.titleLabel = first.label;
    node.fields.shift();
  }
  return node;
}

function tally(nodes: ViewNode[], counts: StructuredView["counts"], depth = 0): void {
  if (depth > MAX_DEPTH) return;
  for (const node of nodes) {
    // ⚠️ 只数真正的成败位。severity/level 也走 badge，但「3 个 blocking 发现」
    // 不该被概览说成「3 个失败」。
    const decided = node.ok !== undefined || (node.badgeKey !== undefined && VERDICT_KEYS.includes(node.badgeKey));
    if (decided) {
      if (node.tone === "ok") counts.ok += 1;
      else if (node.tone === "danger") counts.failed += 1;
      else counts.other += 1;
    }
    for (const field of node.fields) {
      if (field.value.kind === "list") tally(field.value.nodes, counts, depth + 1);
      else if (field.value.kind === "group") tally([field.value.node], counts, depth + 1);
    }
  }
}

/**
 * 入口。任意 JSON 兼容值 → 视图模型。
 *
 * 顶层是数组时每项一行；是对象时整体一行（嵌套的数组/对象在字段里继续展开）。
 */
export function buildStructuredView(value: unknown): StructuredView {
  const nodes = Array.isArray(value)
    ? value.map((item, index) => toNode(item, 1, index))
    : [toNode(value, 0)];
  const counts = { ok: 0, failed: 0, other: 0 };
  tally(nodes, counts);
  return { counts, nodes };
}

/** 节点里到底有没有东西可画 —— 全空时渲染层直接不画这一块。 */
export function nodeIsEmpty(node: ViewNode): boolean {
  return (
    node.fields.length === 0 &&
    node.lead === undefined &&
    node.title === undefined &&
    node.badge === undefined &&
    node.ok === undefined
  );
}
