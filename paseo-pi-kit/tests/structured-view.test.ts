import assert from "node:assert/strict";
import test from "node:test";
import { buildStructuredView, humanizeKey, type ViewNode } from "../domain/structured-view.shared";

/**
 * 结构化数据的形状识别。
 *
 * ⭐ 这里的用例形状**照真实数据抄**（内容中性化过）。取样方式：把
 * `~/.pi/agent/sessions/**\/*.jsonl` 里的 `custom_message` 全捞出来，
 * 解析 `Structured output:` / `Return:` 的载荷，统计键频次：
 *
 * ```
 * runId:string 11 │ ok:boolean 9 │ output:string 9 │ error:string 3
 * ```
 *
 * 主形状两种：并行子运行的结果表 `[{ok, output, runId}, …]`，
 * 和分步 workflow `{ seed: {…}, parallel: [ … ] }`。审计类载荷是第三种
 * （`{ verdict, findings: [{ id, severity, finding, evidence }] }`）。
 *
 * ⚠️ 别把这些用例改成手写的漂亮 JSON —— 真实数据的丑处（重复的
 * error/output、空字符串、被截断的对象）才是这一层要处理的东西。
 */

function only(view: { nodes: ViewNode[] }): ViewNode {
  assert.equal(view.nodes.length, 1, "期望只有一个顶层节点");
  return view.nodes[0]!;
}

function fieldKeys(node: ViewNode): string[] {
  return node.fields.map((field) => field.key);
}

// ── 运行结果表：主力形状 ────────────────────────────────────────────

test("运行结果：ok / key / output 都被吃进行头和正文，不再是字段", () => {
  const view = buildStructuredView([
    { key: "planner", ok: true, runId: "28fa76b5-1e18-4f1d-a956-96c43ee185b6", output: "PLANNER_OK\n\n1. 读取配置\n2. 确认无写入" },
    { key: "worker", ok: false, runId: "b3947507-476f-4088-8965-5535d70504a9", output: "", error: "工具白名单里没有可写工具" },
  ]);

  const [planner, worker] = view.nodes as [ViewNode, ViewNode];
  assert.equal(planner.title, "planner");
  assert.equal(planner.ok, true);
  assert.equal(planner.tone, "ok");
  assert.match(planner.lead!.text, /^PLANNER_OK/);
  assert.equal(planner.ident!.short, "28fa76b5");
  // ⭐ 关键断言：这三个键不许再作为字段出现，否则就退回 JSON 树了
  assert.deepEqual(fieldKeys(planner), []);

  assert.equal(worker.ok, false);
  assert.equal(worker.tone, "danger");
  assert.equal(worker.lead!.text, "工具白名单里没有可写工具");
  assert.equal(worker.lead!.tone, "danger");
  // output 是空串 → 归到「空字段」那一行，不占一条
  assert.deepEqual(fieldKeys(worker), []);
  assert.deepEqual(worker.emptyLabels, ["Output"]);
});

test("error 是 output 的超集时不双份显示", () => {
  // 实测形状：error = output 再接一段 `Run fan-out: …`
  const output = "External CLI binary 'cursor-agent' was not found on PATH.";
  const view = buildStructuredView([
    { ok: false, output, error: `${output}\n\nRun fan-out: 3/3 used, 0 remaining` },
  ]);
  const node = only(view);
  assert.match(node.lead!.text, /Run fan-out/, "失败时应当以 error 作正文");
  assert.deepEqual(fieldKeys(node), [], "output 被 error 包含，不该再画一遍");
});

test("概览计数只数真正的成败位", () => {
  const view = buildStructuredView([
    { key: "a", ok: true, output: "OK" },
    { key: "b", ok: true, output: "OK" },
    { key: "c", ok: false, error: "boom" },
  ]);
  assert.deepEqual(view.counts, { ok: 2, failed: 1, other: 0 });
});

test("severity 不算进成败计数", () => {
  // 「3 个 blocking 发现」不该被概览说成「3 个失败」
  const view = buildStructuredView({
    verdict: "FAIL_PRECONDITIONS",
    findings: [
      { id: "F-001", severity: "blocking", finding: "契约自相矛盾" },
      { id: "F-002", severity: "blocking", finding: "绑定不可验证" },
    ],
  });
  assert.deepEqual(view.counts, { ok: 0, failed: 1, other: 0 }, "只有顶层那个 verdict 算数");
});

// ── 状态词 ──────────────────────────────────────────────────────────

test("verdict 认前缀，不靠全词表", () => {
  // 真实取值：PASS_RQ3_CROSS_DOCUMENT_CONTROL_SUCCESSOR / FAIL_ACTIVATION_PRECONDITIONS
  const pass = only(buildStructuredView({ verdict: "PASS_RQ3_CROSS_DOCUMENT_CONTROL_SUCCESSOR", subjectSha256: "edbf15b9c2" }));
  assert.equal(pass.badge, "PASS_RQ3_CROSS_DOCUMENT_CONTROL_SUCCESSOR");
  assert.equal(pass.tone, "ok");

  const fail = only(buildStructuredView({ verdict: "FAIL_ACTIVATION_PRECONDITIONS", subjectSha256: "c3d40441aa" }));
  assert.equal(fail.tone, "danger");

  const unknown = only(buildStructuredView({ status: "quiescent", runId: "x1" }));
  assert.equal(unknown.tone, "default", "认不出的词退回 default，不许猜成红色");
});

test("severity 走同一套色调", () => {
  const node = only(buildStructuredView({ id: "F-001", severity: "blocking", finding: "契约自相矛盾" }));
  assert.equal(node.badge, "blocking");
  assert.equal(node.tone, "danger");
  assert.equal(node.title, "F-001");
  assert.equal(node.ident, undefined, "标题已经是这个 id，右边不该再画一遍");
});

test("状态键上挂着一整段话时不塞进角标", () => {
  const long = "运行已结束，但输出制品没有落盘，需要人工确认后再决定是否重跑该子任务。".repeat(3);
  const node = only(buildStructuredView({ status: long, runId: "abc" }));
  assert.equal(node.badge, undefined);
  assert.ok(fieldKeys(node).includes("status"), "留作正常字段");
});

// ── 空值与花括号 ────────────────────────────────────────────────────

test("空值折成一行，不画 null / {} / []", () => {
  const node = only(buildStructuredView({
    name: "step-1",
    output: "done",
    notes: [],
    meta: {},
    error: null,
    trailer: "",
  }));
  assert.deepEqual(fieldKeys(node), []);
  assert.deepEqual(node.emptyLabels.sort(), ["Error", "Meta", "Notes", "Trailer"]);
});

// ── 标签与标量 ──────────────────────────────────────────────────────

test("键名单词化，缩写词大写", () => {
  assert.equal(humanizeKey("artifactPaths"), "Artifact paths");
  assert.equal(humanizeKey("artifact_paths"), "Artifact paths");
  assert.equal(humanizeKey("runId"), "Run ID");
  assert.equal(humanizeKey("subject_sha256"), "Subject sha256");
  assert.equal(humanizeKey("ok"), "OK");
  assert.equal(humanizeKey("apiUrl"), "API URL");
});

test("标量按语义分类，不一律当字符串", () => {
  const node = only(buildStructuredView({
    savedOutput: "/home/test/.pi/agent/sessions/out/research.md",
    docs: "https://example.invalid/spec",
    startedAt: "2026-09-04T16:56:31.665Z",
    digest: "0c13cb7644d0b7398f004228f904631a",
    attempts: 12000,
    coveragePct: 87,
    dryRun: false,
    tags: ["fast", "read-only"],
  }));
  const kinds = Object.fromEntries(node.fields.map((field) => [field.key, field.value.kind]));
  assert.equal(kinds.savedOutput, "path");
  assert.equal(kinds.docs, "url");
  assert.equal(kinds.startedAt, "time");
  assert.equal(kinds.digest, "id");
  assert.equal(kinds.attempts, "number");
  assert.equal(kinds.coveragePct, "percent");
  assert.equal(kinds.dryRun, "bool");
  assert.equal(kinds.tags, "chips");
});

test("长 hex / uuid 只留前 8 位", () => {
  const node = only(buildStructuredView({ digest: "0c13cb7644d0b7398f004228f904631a" }));
  const value = node.fields[0]!.value;
  assert.equal(value.kind, "id");
  assert.equal(value.kind === "id" ? value.short : "", "0c13cb76");
});

// ── 表格形状 ────────────────────────────────────────────────────────

test("第一个短字段提成行标题，原标签留在 titleLabel", () => {
  // 真实形状：{ check: "…", outcome: "很长的一段" }
  const view = buildStructuredView([
    { check: "独立复算主题哈希", outcome: "重新计算 AUDIT-REQUEST.json 的 SHA-256，与请求书一致。".repeat(4) },
  ]);
  const node = only(view);
  assert.equal(node.title, "独立复算主题哈希");
  assert.equal(node.titleLabel, "Check");
  assert.deepEqual(fieldKeys(node), ["outcome"], "被提走的那条不该重复出现");
});

test("单字段对象不把标签提成标题", () => {
  // ⚠️ 回归用例：曾经 `{ runId: "…" }` 画成标题 `Run ID` 底下再挂
  // 一条 `Run ID: 0c13cb76`，同一个东西写两遍
  const view = buildStructuredView({ stages: [{ runId: "0c13cb76-44d0-4b73-8f00-4228f904631a" }] });
  const stages = only(view).fields[0]!.value;
  assert.equal(stages.kind, "list");
  const first = stages.kind === "list" ? stages.nodes[0]! : ({} as ViewNode);
  assert.equal(first.title, undefined);
  assert.deepEqual(fieldKeys(first), ["runId"]);
});

test("分步 workflow：每一步是一个字段，不是一堆花括号", () => {
  const view = buildStructuredView({
    seed: { ok: true, runId: "01506884-6556-4864-8b57-04f410dc378d", structuredOutput: { marker: "SEED_OK" } },
    parallel: [
      { ok: true, runId: "28fa76b5-1e18-4f1d-a956-96c43ee185b6", output: "PLANNER_OK" },
      { ok: true, runId: "d3e91f5a-d946-437a-affb-c36d8502d52c", output: "REVIEWER_OK" },
    ],
  });
  const root = only(view);
  assert.deepEqual(fieldKeys(root), ["seed", "parallel"]);
  assert.equal(root.fields[0]!.value.kind, "group");
  assert.equal(root.fields[1]!.value.kind, "list");
  assert.deepEqual(view.counts, { ok: 3, failed: 0, other: 0 });
});

test("数组里的匿名运行结果拿到序号", () => {
  const view = buildStructuredView([{ ok: true, output: "CODEX_CLI_OK" }, { ok: true, output: "CLAUDE_CLI_OK" }]);
  assert.deepEqual(view.nodes.map((node) => node.title), ["#1", "#2"]);
});

test("嵌套过深时兜底，不会无限递归", () => {
  let deep: unknown = { leaf: "底" };
  for (let index = 0; index < 20; index++) deep = { nested: deep };
  const view = buildStructuredView(deep);
  assert.equal(view.nodes.length, 1);
});

test("顶层是标量时也有得画", () => {
  const node = only(buildStructuredView("SEED_OK"));
  assert.equal(node.fields.length, 1);
  assert.equal(node.fields[0]!.value.kind, "text");
});
