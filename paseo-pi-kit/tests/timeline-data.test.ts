import assert from "node:assert/strict";
import test from "node:test";
import { parsePiNoticeText } from "../domain/pi-notice-parser.shared";
import { parseSubagentTimelineItem } from "../domain/subagent-parser.shared";
import { parseTodoTimelineItem } from "../domain/todo-parser.shared";

/**
 * 复刻宿主对 transform 返回值的 JSON 兼容性校验。
 *
 * ## 为什么必须有这条
 *
 * 这是查了很久的那个 bug：通知卡片全部退回裸文本，而
 * 解析器、客户端 bundle、transformer 注册、`transform()` 返回值**全是对的** ——
 * 探针实测 `matched=true`，服务端 `Loaded plugin` 一切正常，没有任何报错。
 *
 * 真凶在宿主的 `transformTimelineItem`：它校验返回的 `data`，
 * 不兼容就 `throw`，而调用处是 `try { … } catch`，异常被吞掉，
 * 条目原样落回默认渲染。
 *
 * 校验器（照抄自 @getpaseo/server 的 web-ui bundle）：
 *
 * ```js
 * if (n === null || typeof n === "string" || typeof n === "boolean") return true;
 * if (typeof n === "number") return Number.isFinite(n);
 * if (typeof n !== "object") return false;          // ← undefined 落这里
 * if (seen.has(n)) return false;                    // 循环引用
 * if (!Array.isArray(n)) {
 *   const proto = Object.getPrototypeOf(n);
 *   if (proto !== Object.prototype && proto !== null) return false;   // class 实例
 *   if (Reflect.ownKeys(n).some(k => typeof k !== "string")) return false;  // symbol 键
 * }
 * return (Array.isArray(n) ? n : Object.values(n)).every(…)
 * ```
 *
 * ⭐ `Object.values()` **包含值为 undefined 的键**，而 `typeof undefined` 不是
 * `"object"` —— 所以「存在但为 undefined」的键会让整条数据判不兼容。
 * zod 的 `.optional()` 恰好会保留这种键。
 */
function isJsonCompatible(value: unknown, seen: Set<object> = new Set()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  const object = value as object;
  if (seen.has(object)) return false;
  if (!Array.isArray(object)) {
    const proto = Object.getPrototypeOf(object);
    if (proto !== Object.prototype && proto !== null) return false;
    if (Reflect.ownKeys(object).some((key) => typeof key !== "string")) return false;
  }
  seen.add(object);
  const values = Array.isArray(object) ? object : Object.values(object);
  const ok = values.every((entry) => isJsonCompatible(entry, seen));
  seen.delete(object);
  return ok;
}

/** index.ts 里 `timelineData()` 的同款处理。 */
function timelineData(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** 找出所有「存在但为 undefined」的键，报错信息里好定位。 */
function undefinedKeys(value: unknown, path = "$"): string[] {
  if (value === null || typeof value !== "object") return [];
  const found: string[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const at = `${path}.${key}`;
    if (entry === undefined) found.push(at);
    else found.push(...undefinedKeys(entry, at));
  }
  return found;
}

const NOTICES = [
  ["supervisor 进度", `Subagent progress update.
Run: b543cf87-4c54-4266-9ea1-9d824e1c00ae
Agent: worker
Child index: 0

UPDATE: ready.`],
  ["control 需要关注", `Subagent needs attention: worker
Run: 6b367565-eb3e-4385-9a82-edb428bdc69a step 1
Signal: worker has had tool 'bash' open for 240s
Facts: 20 turns | 61436 tokens`],
  ["后台任务", `<background-task-notification>
  <task-id>bc2691f2a</task-id>
  <task-name>Background smoke test</task-name>
  <status>completed</status>
  <exit-code>0</exit-code>
  <output-file>.pi/tasks/x.output</output-file>
</background-task-notification>`],
  ["workflow 完成", `Background task completed: **workflow**

Workflow completed with 2 child run(s). Return: [] Trace: 4 event(s).

Child outputs:
- key=a run=unavailable status=failed
  Saved output: unavailable
  Preview:
    | nope`],
] as const;

test("⭐ 解析结果直接给宿主会被拒 —— 这正是那个 bug", () => {
  // 如实记录问题存在：zod 的 optional 会留下值为 undefined 的键
  const raw = parsePiNoticeText(NOTICES[0][1]);
  assert.ok(raw);
  const leaks = undefinedKeys(raw);
  assert.ok(leaks.length > 0, "如果 zod 行为变了这条会失效，但那时下面的断言仍然守住契约");
  assert.equal(isJsonCompatible(raw), false, "含 undefined 键 → 宿主判不兼容 → 静默退回裸文本");
});

for (const [name, text] of NOTICES) {
  test(`⭐ ${name}：过 timelineData 之后满足宿主契约`, () => {
    const notice = parsePiNoticeText(text);
    assert.ok(notice, "先得解析得出来");
    const data = timelineData(notice);
    assert.deepEqual(undefinedKeys(data), [], "不能有值为 undefined 的键");
    assert.ok(isJsonCompatible(data), "必须通过宿主的 JSON 兼容性校验");
  });
}

test("⭐ todo 与 subagent 的数据同样要过", () => {
  const todo = parseTodoTimelineItem({
    type: "tool_call",
    name: "todo",
    detail: { arguments: { action: "add", tasks: [{ id: 1, subject: "x", status: "pending" }] } },
  });
  if (todo) {
    const data = timelineData(todo);
    assert.deepEqual(undefinedKeys(data), []);
    assert.ok(isJsonCompatible(data));
  }
  // subagent 解析器拿不到真实调用时返回 null，那也没问题 —— 这里只保证「有值就得合规」
  const call = parseSubagentTimelineItem({ type: "tool_call", name: "subagent", detail: {} });
  if (call) assert.ok(isJsonCompatible(timelineData(call)));
});

// ── 结构化输出 ──────────────────────────────────────────────────────

test("⭐ Structured output 的 JSON 被拆成结构，不再当文本墙", () => {
  const notice = parsePiNoticeText(`Background task completed: **delegate**

Structured output:
{
  "verdict": "PASS",
  "findings": [],
  "evidence": [
    { "check": "identity", "outcome": "recomputed sha256" }
  ]
}`);
  assert.ok(notice);
  const entry = notice.entries[0]!;
  assert.equal(entry.agent, "delegate");
  assert.deepEqual(entry.structured, {
    verdict: "PASS",
    findings: [],
    evidence: [{ check: "identity", outcome: "recomputed sha256" }],
  });
  assert.equal(entry.summary, "", "JSON 抽走后正文就空了，别再重复一遍");
  // 宿主契约仍然要满足
  assert.ok(isJsonCompatible(timelineData(notice)));
});

test("⭐ Pi 截断的 JSON 要能修回来 —— 截断是常态不是意外", () => {
  // Pi 把 Structured output 砍在 4000 字符，断点几乎总在结构中间
  const notice = parsePiNoticeText(`Background task completed: **delegate**

Structured output:
{
  "verdict": "PASS",
  "findings": [],
  "evidence": [
    { "check": "identity", "outcome": "ok" },
    { "check": "tests", "outc`)!;
  const entry = notice.entries[0]!;
  const structured = entry.structured as Record<string, unknown>;
  assert.ok(structured, "修不出来就只能当文本墙倒出来 —— 那正是要解决的问题");
  assert.equal(structured.verdict, "PASS");
  assert.deepEqual(structured.findings, []);
  // 切点取「字符串外最靠后的逗号或闭合括号」，所以断掉那条已完成的字段会保留下来 ——
  // 比整条丢弃更有用，能修多少算多少
  assert.deepEqual(structured.evidence, [
    { check: "identity", outcome: "ok" },
    { check: "tests" },
  ]);
  assert.equal(entry.structuredTruncated, true, "要如实告诉用户是修出来的");
  assert.ok(isJsonCompatible(timelineData(notice)));
});

test("⭐ 修不动时退回原文，不能变成空白", () => {
  const notice = parsePiNoticeText(`Background task completed: **delegate**

Structured output:
{ "verdict": "PA`)!;
  const entry = notice.entries[0]!;
  assert.equal(entry.structured, undefined, "修不出来就别硬塞");
  assert.equal(entry.structuredTruncated, true);
  assert.ok(entry.summary.includes("verdict"), "原文要留住，显示不全好过什么都不显示");
  assert.ok(isJsonCompatible(timelineData(notice)));
});

test("workflow 的 Return 在没有子输出时也拆成结构", () => {
  const notice = parsePiNoticeText(`Background task completed: **workflow**

Workflow completed with 1 child run(s). Return: {"ok":true,"key":"a"} Trace: 2 event(s).`)!;
  const entry = notice.entries[0]!;
  assert.deepEqual(entry.structured, { ok: true, key: "a" });
  assert.equal(entry.workflow?.childCount, 1);
  assert.ok(isJsonCompatible(timelineData(notice)));
});
