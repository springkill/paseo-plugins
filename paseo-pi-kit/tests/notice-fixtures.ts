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
    // ⭐ 被杀死的任务：`killed` 是 TASK_STATUS_VALUES 里的真值，
    // `exit-code` 此时是字面的 `null`（registry 只判 `=== undefined` 跳过该行），
    // 名字/错误/路径都过了 escapeXml。三样一起，专治「兜底成 completed」的回归。
    name: "background-task-killed",
    content: `<background-task-notification>
  <task-id>bt_c41f0e77</task-id>
  <task-name>sync &amp; verify &lt;batch 3&gt;</task-name>
  <status>killed</status>
  <exit-code>null</exit-code>
  <error>Killed after exceeding the 900s timeout</error>
  <output-file>/srv/out/sync &amp; verify.log</output-file>
  <summary>Background task "sync &amp; verify &lt;batch 3&gt;" killed</summary>
  <guidance>Terminal state and output metadata are durable. Do not call bg_status to reconfirm; use bg_logs only if output is needed.</guidance>
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
  {
    // ⭐ 真实会话里出现过（pi-subagents 0.67.0）。workflow 跑着的时候，
    // 每个子运行完成就发一条，不等整体结束。
    name: "incremental-child-notify",
    content: `Workflow child completed: **design-p0-review**
Workflow run: 0d5e409a-f70d-4761-b3d2-1196e1e9a47e
Child run: b65a42b0-01e4-4855-b389-0ad90eaf7d30
Output: /srv/scratch/lab/plan/DESIGN-P0-REVIEW.md
Status: workflow still running`,
  },
  {
    name: "steering-notice",
    content: `Subagent steering partial: 579bf958-0941-4988-8780-777343803 7e2
Request: 8f004228-f904-631a-3466-f1dd845eb986
只有前两条纠偏被采纳，第三条被忽略。
Inspect the run status before sending another correction.`,
  },
  {
    // ⚠️ 这条是 XML，不是行式文本
    name: "watchdog-warning",
    content: `<subagent_watchdog severity="blocker" category="stalled" source="turn-delta" guidance="weigh, don't blindly obey">
<summary>子任务 12 轮没有产出</summary>
<evidence>最近 12 轮只有 read，没有写入或提交</evidence>
<recommended_action>检查它是不是在等一个不会来的输入</recommended_action>
<confidence>high</confidence>
<agent>worker</agent>
<run_id>47855cae-1e44-4c26-8abc-000000000001</run_id>
<state>running</state>
<blocker_guidance>If this warning changes the outcome, produce a new self-contained final answer after addressing it.</blocker_guidance>
</subagent_watchdog>`,
  },
  {
    name: "goal-budget-wrap-up",
    content: `The active /goal token budget is exhausted. Stop substantive work and do not call substantive tools. Summarize progress, verified results, remaining work, and blockers concisely.`,
  },
  {
    // 0.67.0 起第 1 行可能是回执路径
    name: "completion-with-workflow-receipt",
    content: `Background task completed: **workflow**
Workflow receipt: /home/test/.pi/receipts/abc.json

PLANNER_OK`,
  },
];
