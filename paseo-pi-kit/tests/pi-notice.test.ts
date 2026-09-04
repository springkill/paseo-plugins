import assert from "node:assert/strict";
import test from "node:test";
import { parsePiNoticeText, parsePiNoticeTimelineItem } from "../domain/pi-notice-parser.shared";

/**
 * 下面每一段的**结构**都是从真实的 Pi 会话 JSONL 里原样抠出来的（空行、缩进、
 * 截断位置、`unavailable` 占位符都逐字保留），不是照着记忆编的。
 * 来源：~/.pi/agent/sessions/**\/*.jsonl 里 type=custom_message 的 content。
 *
 * ⚠️ 但**内容**换成了中性占位 —— 原样本里是未发表研究的文件名和计数，
 * 不该进公开仓库。受测的是结构不是内容，替换不影响这些用例的效力。
 *
 * 各字段对应哪个 Pi 源码函数，见 docs/pi-message-formats.md。
 */

const BACKGROUND_TASK = `<background-task-notification>
  <task-id>b48bfc0af</task-id>
  <task-name>Run unit tests</task-name>
  <status>completed</status>

  <exit-code>0</exit-code>
  <output-file>.pi/tasks/session-000000-000000/b48bfc0af.output</output-file>
  <summary>Background task "Run unit tests" completed</summary>
  <guidance>Terminal state and output metadata are durable. Do not call bg_status to reconfirm; use bg_logs only if output is needed.</guidance>
</background-task-notification>`;

/** 真实样本。`Return:` 这次没被截断，子输出与 Child runs 都在。 */
const WORKFLOW = `Background task completed: **workflow**

Workflow completed with 2 child run(s). Return: [
  {
    "artifactPaths": []
  },
  {
    "artifactPaths": []
  }
] Trace: 4 event(s).

Child outputs:
- key=r008-security run=unavailable status=failed
  Saved output: unavailable
  Preview:
    | No usable subagent models remain after registry, scope, and cached-exclusion filtering.
- key=r008-contracts run=unavailable status=failed
  Saved output: unavailable
  Preview:
    | No usable subagent models remain after registry, scope, and cached-exclusion filtering.

Workflow run: 80601aab-388b-43a5-86ad-0a13d7b26122
Child runs: r008-security=unavailable (failed), r008-contracts=unavailable (failed)`;

/**
 * 真实样本，`Return:` 被 Pi 硬截断在字符串中间（`{l.symbol for l in` 后面直接接了
 * ` Trace:`）。这正是不能 JSON.parse 的证据。
 */
const WORKFLOW_TRUNCATED = `Background task completed: **workflow**

Workflow completed with 1 child run(s). Return: [
  "## Files Retrieved\\n1. \`src/registry.ts\` (lines 1-6) — entry points.\\n\\n## Key Code\\n\`\`\`python\\nseen = {r.id for r in Trace: 6 event(s).

Child outputs:
- key=probe-a run=6707590d-4e8e-40ab-ad41-87039bc3af69 status=completed
  Saved output: unavailable
  Preview:
    | ## Files Retrieved
    | 1. \`src/registry.ts\` (lines 1-6) — entry points, 42 handlers.

Workflow run: 66d40cc4-439c-46cb-9e59-7faed50e75aa`;

const WORKFLOW_STOPPED = `Background task stopped: **workflow**

Workflow stopped. Preflight advisory: declared lane 'lane-2' was not launched.

Workflow run: 52731380-c921-4d77-a3b5-db8a9f254415`;

const NEED_DECISION = `Subagent needs a supervisor decision.
Run: 0941988d-a4c5-46ad-beb7-7ff58e9497eb
Agent: delegate
Child index: 0
Child intercom target: subagent-delegate-0941988d-a4c5-46ad-beb7-7ff58e9497eb-1

Loaded the shard. Need a policy call on how to classify these.

Reply with: subagent_supervisor({ action: "reply", replyTo: "2e7e8345-61fc-4ac8-9fe9-4f938ca92e6e", message: "..." })`;

const PROGRESS_UPDATE = `Subagent progress update.
Run: 4d775935-015b-47e5-bdec-b2f6394cc7bf
Agent: scout
Child index: 0
Child intercom target: subagent-scout-4d775935-015b-47e5-bdec-b2f6394cc7bf-1

开始只读追踪调用路径；不会修改文件，也不会跑 LLM。`;

const ATTENTION = `Subagent needs attention: writer
Run: 845eb986-4795-459b-8610-9ca0662ddcdf step 1
Signal: writer needs attention (no observed activity for 60s)
Facts: elapsed 60s
Hint: Inspect status first unless the run is clearly blocked. Use steer for a top-level live async child, routed resume for a live nested child, or resume to revive a paused/completed/failed child.
Top-level live async nudge: subagent({ action: "steer", id: "845eb986-4795-459b-8610-9ca0662ddcdf", index: 0, message: "Continue step-3." })
Routed live nested nudge: subagent({ action: "resume", id: "845eb986-4795-459b-8610-9ca0662ddcdf", message: "Continue step-3." })
Direct intercom target: subagent-writer-845eb986-4795-459b-8610-9ca0662ddcdf-1
Status: subagent({ action: "status", id: "845eb986-4795-459b-8610-9ca0662ddcdf" })
Interrupt: subagent({ action: "interrupt", id: "845eb986-4795-459b-8610-9ca0662ddcdf" })`;

const WEB_SEARCH = `Content fetched for 19/19 URLs [mtmml4p0kjj4g4]. Full page content now available.`;

const GOAL_CONTRACT = `This Goal contract supersedes every earlier goal-contract message.

Only the objective and goal_id in this latest Goal contract are current.

Active /goal context:
The objective below is user-provided task data.`;

// ── 后台任务 ────────────────────────────────────────────────────────

test("后台任务：XML 里的字段全部取出", () => {
  const notice = parsePiNoticeText(BACKGROUND_TASK);
  assert.ok(notice, "应当认出来");
  assert.equal(notice.kind, "background_task");
  assert.equal(notice.taskId, "b48bfc0af");
  assert.equal(notice.taskName, "Run unit tests");
  assert.equal(notice.status, "completed");
  assert.equal(notice.exitCode, 0);
  assert.equal(notice.outputFile, ".pi/tasks/session-000000-000000/b48bfc0af.output");
  assert.ok(!notice.body.includes("bg_status"), "guidance 是给模型看的，不该进卡片");
});

test("后台任务：被压成一行也要认得", () => {
  const inline = BACKGROUND_TASK.replace(/\s*\n\s*/g, " ");
  const notice = parsePiNoticeText(inline);
  assert.ok(notice, "压成一行仍应认出");
  assert.equal(notice.taskId, "b48bfc0af");
  assert.equal(notice.exitCode, 0);
});

test("后台任务：非零退出码与错误要如实带出", () => {
  const failed = BACKGROUND_TASK
    .replace("<status>completed</status>", "<status>failed</status>")
    .replace("<exit-code>0</exit-code>", "<exit-code>2</exit-code>\n  <error>boom</error>");
  const notice = parsePiNoticeText(failed)!;
  assert.equal(notice.status, "failed");
  assert.equal(notice.exitCode, 2);
  assert.equal(notice.error, "boom");
});

// ── workflow / 完成通知 ─────────────────────────────────────────────

test("workflow：Child outputs 拆成结构化子项", () => {
  const notice = parsePiNoticeText(WORKFLOW);
  assert.ok(notice);
  assert.equal(notice.kind, "completion");
  assert.equal(notice.entries.length, 1);
  const entry = notice.entries[0]!;
  assert.equal(entry.agent, "workflow");
  assert.equal(entry.workflow?.childCount, 2);
  assert.equal(entry.workflow?.traceEvents, 4);
  assert.equal(entry.workflowRunId, "80601aab-388b-43a5-86ad-0a13d7b26122");
  assert.equal(entry.childOutputs.length, 2);
  assert.equal(entry.childOutputs[0]?.key, "r008-security");
  assert.equal(entry.childOutputs[0]?.status, "failed");
  assert.ok(entry.childOutputs[0]?.preview?.startsWith("No usable subagent models"));
});

test("⭐ workflow：`unavailable` 是占位符，不是值", () => {
  const entry = parsePiNoticeText(WORKFLOW)!.entries[0]!;
  assert.equal(entry.childOutputs[0]?.runId, undefined, "run=unavailable 不该变成 runId");
  assert.equal(entry.childOutputs[0]?.savedOutputPath, undefined);
  assert.equal(entry.childRuns[0]?.runId, undefined, "Child runs 那行同理");
  assert.equal(entry.childRuns[0]?.key, "r008-security", "但 key 与 status 仍要留住");
  assert.equal(entry.childRuns[0]?.status, "failed");
});

test("⭐ workflow：有结构化子输出时，截断的 Return 预览整段丢掉", () => {
  const entry = parsePiNoticeText(WORKFLOW)!.entries[0]!;
  assert.equal(entry.summary, "", "同样的内容 Child outputs 里有结构化版本");
  assert.equal(entry.workflow?.returnTruncated, true, "但要记下确实丢过东西");
  assert.ok(!JSON.stringify(entry).includes("artifactPaths"), "JSON 原文不该泄进卡片");
});

test("⭐ workflow：Return 被截在字符串中间也不能崩", () => {
  // 这是真实数据 —— Pi 硬截断到 1000 字符，JSON.parse 必然失败
  const notice = parsePiNoticeText(WORKFLOW_TRUNCATED);
  assert.ok(notice, "截断的 JSON 不该让整条解析失败");
  const entry = notice.entries[0]!;
  assert.equal(entry.workflow?.childCount, 1);
  assert.equal(entry.workflow?.traceEvents, 6, "取最后一处 Trace 标记");
  assert.equal(entry.childOutputs.length, 1);
  assert.ok(entry.childOutputs[0]?.preview?.includes("Files Retrieved"));
});

test("workflow：没有子输出时，Return 预览留作正文并还原转义", () => {
  const noChildren = WORKFLOW_TRUNCATED.split("\n\nChild outputs:")[0]!;
  const entry = parsePiNoticeText(noChildren)!.entries[0]!;
  assert.ok(entry.summary.includes("## Files Retrieved"), "否则卡片会整个空掉");
  assert.ok(!entry.summary.includes("\\n"), "字面 \\n 必须还原成真换行");
  assert.ok(entry.summary.includes("\n1. "));
});

test("workflow：stopped 是终态，不是失败", () => {
  const notice = parsePiNoticeText(WORKFLOW_STOPPED)!;
  assert.equal(notice.status, "stopped");
  const entry = notice.entries[0]!;
  assert.equal(entry.workflowRunId, "52731380-c921-4d77-a3b5-db8a9f254415");
  assert.ok(
    entry.workflow?.notes.some((note) => note.includes("Preflight advisory")),
    "告警是唯一说明原因的地方，必须留住",
  );
});

test("⭐ paused 是 Pi 的第四种终态", () => {
  const paused = WORKFLOW.replace("Background task completed:", "Background task paused:");
  assert.equal(parsePiNoticeText(paused)?.status, "paused");
});

test("Detached foreground task 与后台任务是两种来源", () => {
  const foreground = WORKFLOW.replace("Background task completed:", "Detached foreground task completed:");
  assert.equal(parsePiNoticeText(foreground)?.variant, "foreground");
  assert.equal(parsePiNoticeText(WORKFLOW)?.variant, "background");
});

test("⭐ 合批完成通知：没有单条那个头，得单独认", () => {
  const grouped = `Background tasks completed (2): **scout** (probe), **delegate**

1. scout (probe)
找到了三处调用点。

Workflow run: 11111111-2222-3333-4444-555555555555

2. delegate
补了守卫。

Session: /tmp/s.jsonl`;
  const notice = parsePiNoticeText(grouped);
  assert.ok(notice, "合批形态必须认出来");
  assert.equal(notice.variant, "grouped");
  assert.equal(notice.entries.length, 2);
  assert.equal(notice.entries[0]?.agent, "scout");
  assert.equal(notice.entries[0]?.taskInfo, "(probe)");
  assert.ok(notice.entries[0]?.summary.includes("三处调用点"));
  assert.equal(notice.entries[0]?.workflowRunId, "11111111-2222-3333-4444-555555555555");
  assert.equal(notice.entries[1]?.agent, "delegate");
  assert.equal(notice.entries[1]?.session?.value, "/tmp/s.jsonl");
});

test("完成通知：Scheduled run 归到 schedule，不混进正文", () => {
  const scheduled = `Background task completed: **scout**

Scheduled run from **nightly** (schedule sch-7).

跑完了。`;
  const entry = parsePiNoticeText(scheduled)!.entries[0]!;
  assert.deepEqual(entry.schedule, { id: "sch-7", name: "nightly" });
  assert.equal(entry.summary, "跑完了。");
});

// ── subagent 督导 ───────────────────────────────────────────────────

/**
 * ⚠️ supervisor 这三种**不是在问你**。
 *
 * 正文结尾是 `Reply with: subagent_supervisor({ … })` —— 那是个工具调用，
 * 只有模型能发；native-supervisor-channel.ts 也是把它投给 orchestratorSessionId
 * （父 agent）。Paseo 真正要你回答的提问走另一条路：pi provider 的
 * `mapExtensionUiRequestToPermission`，渲染成带选项的权限对话框。
 *
 * 所以卡片必须折叠、不给强调色、不说「等你回话」——
 * 没有选项不是漏做了选项，是它本来就不该问你。
 */
test("需要裁决：认出它在等父 agent 回话", () => {
  const notice = parsePiNoticeText(NEED_DECISION);
  assert.ok(notice);
  assert.equal(notice.kind, "supervisor");
  assert.equal(notice.variant, "need_decision");
  assert.equal(notice.runId, "0941988d-a4c5-46ad-beb7-7ff58e9497eb");
  assert.equal(notice.agent, "delegate");
  assert.equal(notice.childIndex, 0);
  assert.equal(notice.replyTo, "2e7e8345-61fc-4ac8-9fe9-4f938ca92e6e", "replyTo 是给模型调工具用的，不是给人的");
  assert.ok(notice.body.startsWith("Loaded the shard"), "正文要去掉头部元信息");
  assert.ok(!notice.body.includes("Reply with:"), "调用样板不该进正文");
  assert.ok(!notice.body.includes("Child intercom target"), "内部路由地址对人没有信息量");
});

test("进度更新：没有 replyTo", () => {
  const notice = parsePiNoticeText(PROGRESS_UPDATE)!;
  assert.equal(notice.variant, "progress_update");
  assert.equal(notice.agent, "scout");
  assert.equal(notice.replyTo, undefined);
  assert.ok(notice.body.startsWith("开始只读追踪"));
});

test("⭐ 第三种督导形态：结构化访谈请求", () => {
  const interview = NEED_DECISION
    .replace("Subagent needs a supervisor decision.", "Subagent requests a structured supervisor interview.")
    .replace("Reply with:", "Structured response requested. Reply with JSON, optionally fenced in ```json, matching the requested interview shape.\n\nReply with:");
  const notice = parsePiNoticeText(interview)!;
  assert.equal(notice.variant, "interview_request");
  assert.ok(!notice.body.includes("Structured response requested"), "JSON 格式要求是给模型的");
});

// ── control notice ──────────────────────────────────────────────────

test("需要关注：取出 agent、run、step、信号与 facts", () => {
  const notice = parsePiNoticeText(ATTENTION);
  assert.ok(notice);
  assert.equal(notice.kind, "control");
  assert.equal(notice.variant, "attention");
  assert.equal(notice.status, "attention");
  assert.equal(notice.agent, "writer");
  assert.equal(notice.runId, "845eb986-4795-459b-8610-9ca0662ddcdf", "`Run: <id> step 1` 只取 id");
  assert.equal(notice.step, 1);
  assert.ok(notice.signal?.includes("no observed activity"));
  assert.deepEqual(notice.facts, ["elapsed 60s"]);
});

test("⭐ control notice：给模型抄的工具调用一律不进卡片", () => {
  const notice = parsePiNoticeText(ATTENTION)!;
  const dumped = JSON.stringify(notice);
  for (const boilerplate of ["subagent({", "Top-level live async nudge", "Interrupt:", "Direct intercom target"]) {
    assert.ok(!dumped.includes(boilerplate), `${boilerplate} 对人零信息量`);
  }
  // Hint / Next 是 subagent-control.ts 里的硬编码常量，说的是 steer/resume
  // 这类只有模型能做的动作。留在卡片上会让人以为该自己动手。
  assert.ok(!dumped.includes("Use steer for"), "Hint 是给模型的固定话术");
  assert.ok(!dumped.includes("Inspect status first"));
});

test("⭐ control notice 的另外两种形态", () => {
  const failed = parsePiNoticeText(`Subagent failed: writer
Run: aaa step 2
Signal: guard tripped
Next: read the output artifact or session from the subagent result, then retry.`)!;
  assert.equal(failed.variant, "failed");
  assert.equal(failed.status, "failed");
  assert.equal(failed.step, 2);

  const longRunning = parsePiNoticeText(ATTENTION.replace(
    "Subagent needs attention:", "Subagent active but long-running:",
  ))!;
  assert.equal(longRunning.variant, "long_running");
  assert.equal(longRunning.status, "running");
});

test("facts 按 ` | ` 拆开", () => {
  const notice = parsePiNoticeText(
    ATTENTION.replace("Facts: elapsed 60s", "Facts: elapsed 60s | 3 turns | tool bash 12s"),
  )!;
  assert.deepEqual(notice.facts, ["elapsed 60s", "3 turns", "tool bash 12s"]);
});

// ── wait subscription ───────────────────────────────────────────────

test("⭐ wait subscription：五种 outcome", () => {
  const notice = parsePiNoticeText(
    "Wait subscription tok-9 fired for run r-1: needs attention. Reply to the pending supervisor request or inspect the run status.",
  )!;
  assert.equal(notice.kind, "wait");
  assert.equal(notice.token, "tok-9");
  assert.equal(notice.runId, "r-1");
  assert.equal(notice.outcome, "needs attention");
  assert.equal(notice.status, "attention");
  assert.ok(notice.body.startsWith("Reply to the pending"));

  assert.equal(
    parsePiNoticeText("Wait subscription t fired for run r: timed out. The targeted run may still be active.")?.status,
    "timed_out",
  );
  assert.equal(
    parsePiNoticeText("Wait subscription t fired for run r: could not be reconciled. It disappeared.")?.status,
    "unresolved",
  );
});

// ── 网页抓取 ────────────────────────────────────────────────────────

test("网页抓取：取出进度与 fetch id", () => {
  const notice = parsePiNoticeText(WEB_SEARCH)!;
  assert.equal(notice.kind, "web_fetch");
  assert.equal(notice.variant, "ready");
  assert.deepEqual(notice.fetched, { done: 19, total: 19 });
  assert.equal(notice.fetchId, "mtmml4p0kjj4g4");
});

test("⭐ 网页抓取失败也是一种通知", () => {
  const notice = parsePiNoticeText("Content fetch failed [abc123]: upstream timed out")!;
  assert.equal(notice.variant, "error");
  assert.equal(notice.status, "failed");
  assert.equal(notice.fetchId, "abc123");
  assert.equal(notice.error, "upstream timed out");
});

// ── Pi 自己都不显示的 ───────────────────────────────────────────────

test("⭐ display:false 的消息归为 model_only", () => {
  // Paseo 的 history-mapper 不看 display，这两条会照样进时间线
  const goal = parsePiNoticeText(GOAL_CONTRACT)!;
  assert.equal(goal.kind, "model_only");
  assert.equal(goal.variant, "goal_contract");

  const resume = parsePiNoticeText(
    "Compaction is complete. Resume the parent task now; background subagent results will arrive separately when ready.",
  )!;
  assert.equal(resume.variant, "compaction_resume");

  assert.equal(parsePiNoticeText("Goal mode is inactive.\nThis Goal contract supersedes …")?.variant, "goal_contract");
});

// ── 不该误伤 ────────────────────────────────────────────────────────

test("⭐ 普通助手消息一律放过", () => {
  for (const text of [
    "我已经把扫描器的边界护栏加上了，家目录不再被扫。",
    "Here is the summary of what changed:\n\n- fixed the race\n- added tests",
    "Run: 这不是通知，只是我在正文里写了个冒号",
    "Background task 这几个字出现在句子里，但不是通知头",
    "Subagent needs a supervisor decision 少了句号，就不是那个 heading",
    "",
    "   ",
  ]) {
    assert.equal(parsePiNoticeText(text), null, `不该认出：${text.slice(0, 30)}`);
  }
});

test("⚠️ 已知局限：正文里引用这段 XML 会被误认", () => {
  // 文本反解就是会有这个问题。代价可接受：讨论这段 XML 的场合极少，
  // 而漏掉真实通知的代价（用户看到裸 XML）天天都在发生。
  const quoted = "看这个：\n```\n" + BACKGROUND_TASK + "\n```";
  assert.ok(parsePiNoticeText(quoted), "如实记录这个已知误伤，不假装没有");
});

// ── 时间线接线 ──────────────────────────────────────────────────────

test("只接管助手消息，别的条目形态放过", () => {
  assert.ok(parsePiNoticeTimelineItem({ type: "assistant_message", text: BACKGROUND_TASK }));
  assert.equal(parsePiNoticeTimelineItem({ type: "user_message", text: BACKGROUND_TASK }), null);
  assert.equal(parsePiNoticeTimelineItem({ type: "tool_call", name: "bash" }), null);
  assert.equal(parsePiNoticeTimelineItem(null), null);
  assert.equal(parsePiNoticeTimelineItem({ type: "assistant_message" }), null);
});

test("⭐ supervisor 三种形态都不许冒充「等你操作」", () => {
  // 回归守卫：曾经把这些标成「等你裁决 / 不回就不会往下走」，
  // 但卡片给不出任何可点的选项 —— 因为它压根不是问人的。
  for (const [text, variant] of [
    [NEED_DECISION, "need_decision"],
    [PROGRESS_UPDATE, "progress_update"],
    [NEED_DECISION.replace(
      "Subagent needs a supervisor decision.",
      "Subagent requests a structured supervisor interview.",
    ), "interview_request"],
  ] as const) {
    const notice = parsePiNoticeText(text)!;
    assert.equal(notice.kind, "supervisor");
    assert.equal(notice.variant, variant);
    // 正文里不许残留那句工具调用样板 —— 人照着它什么也做不了
    assert.ok(!notice.body.includes("subagent_supervisor("), "调用样板不该进卡片");
    assert.ok(!notice.body.includes("Reply with:"));
  }
});
