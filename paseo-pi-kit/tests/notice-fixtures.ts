/**
 * 时间线渲染用的通知样本。
 *
 * **结构**照真实 Pi 会话原样抠出来（空行、缩进、`unavailable` 占位、截断位置
 * 都保留），内容中性化。取样：`~/.pi/agent/sessions/**\/*.jsonl` 里
 * `type=custom_message` 的 `content`。
 *
 * ⚠️ 别把这些改成手写的漂亮样本 —— 真实数据的丑处才是渲染层要扛的东西。
 * 尤其 §3 那条**必须**同时含数字和 ISO 时间：Hermes 上把它们格式化出来
 * 正是 0.7.0 在安卓上炸掉的地方。
 */

export const NOTICE_FIXTURES: Array<{ name: string; content: string }> = [
  {
    name: "background-task",
    content: `<background-task-notification>
  <task-id>bt_01a06d18</task-id>
  <task-name>build docs</task-name>
  <status>failed</status>
  <exit-code>2</exit-code>
  <error>docs build exited non-zero</error>
  <output-file>/srv/out/build.log</output-file>
  <summary>Background task "build docs" failed</summary>
  <guidance>Do not poll; the result is already here.</guidance>
</background-task-notification>`,
  },
  {
    name: "completion-with-child-outputs",
    content: `Background task completed: **workflow**

Workflow completed with 3 child run(s). Return: [
  {
    "key": "planner",
    "ok": true,
    "runId": "28fa76b5-1e18-4f1d-a956-96c43ee185b6",
    "output": "PLANNER_OK\\n\\n1. 读取配置\\n2. 确认无写入",
    "resolvedContext": "fresh",
    "resumability": {
      "state": "not-resumable",
      "reason": "no persisted session file to resume from"
    },
    "continuation": {
 Trace: 6 event(s).

Child outputs:
- key=planner run=28fa76b5-1e18-4f1d-a956-96c43ee185b6 status=completed
  Saved output: unavailable
  Preview:
    | PLANNER_OK
    |
    | 1. 读取配置
- key=worker run=unavailable status=failed
  Saved output: unavailable
  Preview: unavailable (no safe inline output)

Child runs: planner=28fa76b5-1e18-4f1d-a956-96c43ee185b6 (completed), worker=unavailable (failed)`,
  },
  {
    // ⭐ 数字 + ISO 时间 + 布尔 + 路径 + 百分比：全都要经过格式化。
    // Hermes（安卓）没有 Intl，0.7.0 就是在这条上炸的。
    name: "structured-with-number-and-time",
    content: `Background task completed: **delegate**

Structured output:
{
  "verdict": "PASS_ROUND_04",
  "startedAt": "2026-09-04T16:56:31.665Z",
  "attempts": 12000,
  "coveragePct": 87,
  "dryRun": false,
  "savedOutput": "/home/test/.pi/agent/sessions/out/research.md",
  "digest": "0c13cb7644d0b7398f004228f904631a",
  "tags": ["fast", "read-only"],
  "notes": [],
  "findings": [
    { "id": "F-001", "severity": "blocking", "finding": "契约自相矛盾", "line": 207 },
    { "id": "F-002", "severity": "low", "finding": "命名不一致", "line": 12 }
  ]
}`,
  },
  {
    name: "grouped-completion",
    content: `Background tasks completed (2): **reviewer**, **planner**

1. reviewer
REVIEWER_OK

2. planner
PLANNER_OK`,
  },
  {
    name: "supervisor-request",
    content: `Subagent needs a supervisor decision.
Run: 01506884-6556-4864-8b57-04f410dc378d
Agent: reviewer
Child index: 2

需要确认是否继续第三轮。

Reply with: subagent_supervisor({ action: "reply", replyTo: "8f004228-f904-631a-3466-f1dd845eb986", message: "…" })`,
  },
  {
    name: "control-long-running",
    content: `Subagent active but long-running: worker
Run: 579bf958-0941-4988-8780-77734380 37e2 step 4
Signal: no tool activity for a while
Facts: elapsed 930s | 14 turns | 82000 tokens | 31 tools | tool bash 120s | path /srv/scratch
Hint: consider steering the subagent.
Status: subagent({ action: "status", id: "579bf958" })
Interrupt: subagent({ action: "interrupt", id: "579bf958" })`,
  },
  {
    name: "wait-subscription",
    content: `Wait subscription wt_01 fired for run 47855cae-1e44-4c26-8abc-000000000001: timed out. No result within the window.`,
  },
  {
    name: "web-fetch",
    content: `Content fetched for 3/5 URLs [fetch_9931]. Partial page content now available.`,
  },
  {
    name: "model-only",
    content: `Compaction is complete. Resume the parent task now; background subagent results will arrive separately when ready.`,
  },
];
