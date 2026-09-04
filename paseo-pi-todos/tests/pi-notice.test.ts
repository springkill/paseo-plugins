import assert from "node:assert/strict";
import test from "node:test";
import { parsePiNoticeText, parsePiNoticeTimelineItem } from "../domain/pi-notice-parser.shared";

/**
 * 下面每一段都是从真实的 Pi 会话 JSONL 里原样抠出来的，不是照着记忆编的。
 * 来源：~/.pi/agent/sessions/**\/*.jsonl 里 type=custom_message 且 display!=false 的 content。
 */

const BACKGROUND_TASK = `<background-task-notification>
  <task-id>b48bfc0af</task-id>
  <task-name>Run unit tests</task-name>
  <status>completed</status>

  <exit-code>0</exit-code>
  <output-file>.pi/tasks/session-404896-404896/b48bfc0af.output</output-file>
  <summary>Background task "Run unit tests" completed</summary>
  <guidance>Terminal state and output metadata are durable. Do not call bg_status to reconfirm; use bg_logs only if output is needed.</guidance>
</background-task-notification>`;

const WORKFLOW_STOPPED = `Background task stopped: **workflow**

Workflow stopped. Preflight advisory: declared lane 'lane-2' was not launched.

Workflow run: 52731380-c921-4d77-a3b5-db8a9f254415`;

const WORKFLOW_COMPLETED = `Background task completed: **workflow**

Workflow completed with 3 child run(s). Trace: 6 event(s).
Child outputs:
• key=lane-a1 run=50b631d7-a766-4396-bb8b-1022b107688b status=completed
• key=lane-b1 run=3af2ebe8-076c-41a7-b7dd-7d28faae32e9 status=completed
• key=lane-integrate run=8d65cbde-287f-4197-9d78-4220af97cf6f status=completed

Workflow run: 66d40cc4-439c-46cb-9e59-7faed50e75aa`;

const NEED_DECISION = `Subagent needs a supervisor decision.
Run: 0941988d-a4c5-46ad-beb7-7ff58e9497eb
Agent: delegate
Child index: 0
Child intercom target: subagent-delegate-0941988d-a4c5-46ad-beb7-7ff58e9497eb-1

I have the shard loaded. Need a policy call on how to classify these.

Reply with: subagent_supervisor({ action: "reply", replyTo: "2e7e8345-61fc-4ac8-9fe9-4f938ca92e6e", message: "..." })`;

const PROGRESS_UPDATE = `Subagent progress update.
Run: 4d775935-015b-47e5-bdec-b2f6394cc7bf
Agent: scout
Child index: 0
Child intercom target: subagent-scout-4d775935-015b-47e5-bdec-b2f6394cc7bf-1

开始只读追踪 调用路径；不会修改文件，也不会跑 LLM。`;

const ATTENTION = `Subagent needs attention: claude-code-writer
Run: 845eb986-4795-459b-8610-9ca0662ddcdf step 1
Signal: claude-code-writer needs attention (no observed activity for 60s)
Facts: elapsed 60s
Hint: Inspect status first unless the run is clearly blocked.`;

const WEB_SEARCH = `Content fetched for 19/19 URLs [mtmml4p0kjj4g4]. Full page content now available.`;

// ── 后台任务 ────────────────────────────────────────────────────────

test("后台任务：XML 里的字段全部取出", () => {
  const notice = parsePiNoticeText(BACKGROUND_TASK);
  assert.ok(notice, "应当认出来");
  assert.equal(notice.kind, "background_task");
  assert.equal(notice.taskId, "b48bfc0af");
  assert.equal(notice.taskName, "Run unit tests");
  assert.equal(notice.status, "completed");
  assert.equal(notice.exitCode, 0);
  assert.equal(notice.outputFile, ".pi/tasks/session-404896-404896/b48bfc0af.output");
  assert.ok(!notice.body.includes("bg_status"), "guidance 是给模型看的，不该进卡片");
});

test("后台任务：被压成一行也要认得", () => {
  // 实机上用户看到的就是这种 —— 渲染路径把换行压掉了
  const inline = BACKGROUND_TASK.replace(/\s*\n\s*/g, " ");
  const notice = parsePiNoticeText(inline);
  assert.ok(notice, "压成一行仍应认出");
  assert.equal(notice.taskId, "b48bfc0af");
  assert.equal(notice.exitCode, 0);
});

test("后台任务：非零退出码要如实带出", () => {
  const failed = BACKGROUND_TASK
    .replace("<status>completed</status>", "<status>failed</status>")
    .replace("<exit-code>0</exit-code>", "<exit-code>2</exit-code>");
  const notice = parsePiNoticeText(failed)!;
  assert.equal(notice.status, "failed");
  assert.equal(notice.exitCode, 2);
});

// ── workflow ────────────────────────────────────────────────────────

test("workflow：取出 run id 与各子运行", () => {
  const notice = parsePiNoticeText(WORKFLOW_COMPLETED);
  assert.ok(notice);
  assert.equal(notice.kind, "workflow");
  assert.equal(notice.status, "completed");
  assert.equal(notice.runId, "66d40cc4-439c-46cb-9e59-7faed50e75aa");
  assert.equal(notice.childRuns.length, 3);
  assert.deepEqual(notice.childRuns[0], {
    key: "lane-a1",
    runId: "50b631d7-a766-4396-bb8b-1022b107688b",
    status: "completed",
  });
  assert.ok(!notice.body.includes("Workflow run:"), "元信息不该重复出现在正文里");
});

test("workflow：stopped 是终态，不是失败", () => {
  const notice = parsePiNoticeText(WORKFLOW_STOPPED)!;
  assert.equal(notice.status, "stopped");
  assert.equal(notice.runId, "52731380-c921-4d77-a3b5-db8a9f254415");
  assert.equal(notice.childRuns.length, 0);
  assert.ok(notice.body.includes("Preflight advisory"), "正文要留住，那是唯一说明原因的地方");
});

test("workflow：退回 `Child runs: a=b (status)` 形态", () => {
  const alt = `Background task completed: **workflow**

Workflow run: 66d40cc4-439c-46cb-9e59-7faed50e75aa
Child runs: a1=50b631d7 (completed), b1=3af2ebe8 (failed)`;
  const notice = parsePiNoticeText(alt)!;
  assert.equal(notice.childRuns.length, 2);
  assert.equal(notice.childRuns[1]?.status, "failed");
});

// ── subagent 督导 ───────────────────────────────────────────────────

test("需要裁决：认出它在等你回话", () => {
  const notice = parsePiNoticeText(NEED_DECISION);
  assert.ok(notice);
  assert.equal(notice.kind, "supervisor");
  assert.equal(notice.variant, "need_decision");
  assert.equal(notice.runId, "0941988d-a4c5-46ad-beb7-7ff58e9497eb");
  assert.equal(notice.agent, "delegate");
  assert.equal(notice.childIndex, 0);
  assert.equal(notice.replyTo, "2e7e8345-61fc-4ac8-9fe9-4f938ca92e6e", "有 replyTo 才知道它在等回话");
  assert.ok(notice.body.startsWith("I have the shard"), "正文要去掉头部元信息");
  assert.ok(!notice.body.includes("Reply with:"), "调用样板不该进正文");
  assert.ok(!notice.body.includes("Child intercom target"), "内部路由地址对人没有信息量");
});

test("进度更新：不等回话，没有 replyTo", () => {
  const notice = parsePiNoticeText(PROGRESS_UPDATE)!;
  assert.equal(notice.variant, "progress_update");
  assert.equal(notice.agent, "scout");
  assert.equal(notice.replyTo, undefined);
  assert.ok(notice.body.startsWith("开始只读追踪"));
});

// ── 需要关注 ────────────────────────────────────────────────────────

test("需要关注：取出 agent、run、信号与建议", () => {
  const notice = parsePiNoticeText(ATTENTION);
  assert.ok(notice);
  assert.equal(notice.kind, "attention");
  assert.equal(notice.status, "attention");
  assert.equal(notice.agent, "claude-code-writer");
  assert.equal(notice.runId, "845eb986-4795-459b-8610-9ca0662ddcdf", "`Run: <id> step 1` 只取 id");
  assert.ok(notice.signal?.includes("no observed activity"));
  assert.ok(notice.hint?.startsWith("Inspect status"));
});

// ── 网页抓取 ────────────────────────────────────────────────────────

test("网页抓取：取出进度", () => {
  const notice = parsePiNoticeText(WEB_SEARCH)!;
  assert.equal(notice.kind, "web_search");
  assert.deepEqual(notice.fetched, { done: 19, total: 19 });
});

// ── 不该误伤 ────────────────────────────────────────────────────────

test("⭐ 普通助手消息一律放过", () => {
  for (const text of [
    "我已经把扫描器的边界护栏加上了，家目录不再被扫。",
    "Here is the summary of what changed:\n\n- fixed the race\n- added tests",
    "Run: 这不是通知，只是我在正文里写了个冒号",
    "```\n<background-task-notification> 出现在代码块里，是在讨论它\n```",
    "",
    "   ",
  ]) {
    // 最后一条代码块的确会被认出来 —— 见下面那条单独的用例
    if (text.includes("<background-task-notification>")) continue;
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
