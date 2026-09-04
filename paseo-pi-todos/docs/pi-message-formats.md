# Pi 通知消息格式对照表

`domain/pi-notice-parser.shared.ts` 是照着这张表实现的。表本身是从**已安装的 Pi 插件源码**里
逐条抠出来的，不是从渲染结果反推的。

> 采样环境：`pi` 0.84.4，插件见下表版本。
> 重新核对：`~/.pi/agent/npm/node_modules/<插件>/src/...`，行号会漂，按函数名找。

## 为什么需要这张表

Pi 用 `custom_message` 发通知，`details` 里带完整结构化数据，并且用
`pi.registerMessageRenderer(customType, …)` 在自己的 TUI 里结构化渲染。

Paseo 的 Pi provider（`pi/history-mapper.js` 的 `mapCustomMessage`）会先试
`this.hooks.mapCustomMessage?.(text, this.provider)`，**没有任何 provider 提供这个钩子**，
于是一律落到默认分支，`details` 整个丢掉，只剩 `content` 那段文本当普通助手消息渲染。

所以只能从文本反解。这张表就是 Pi 那些 `format*()` 函数的**逆向对照**。

`history-mapper.js` 里也**没有 `display` 处理** —— Pi 标记 `display: false`
（只给模型看、TUI 从不显示）的消息，在 Paseo 里照样进时间线。见下面 §8。

## 消息清单

| customType | 来源插件 | display | 构造函数 |
|---|---|---|---|
| `background-task-notification` | pi-background-tasks 2.4.2 | true | `registry.ts` `notifyCompletion()` |
| `subagent-notify` | pi-subagents 0.63.0 | 视情况 | `notify.ts` `formatSingleCompletion()` / `formatGroupedCompletion()` |
| `subagent_supervisor_request` | pi-subagents | true | `native-supervisor-channel.ts` `formatChildMessage()` |
| `subagent_control_notice` | pi-subagents | true | `subagent-control.ts` `formatControlNoticeMessage()` |
| `subagent-wait-subscription` | pi-subagents | true | `wait-subscriptions.ts` `settle()` |
| `subagent-compaction-resume` | pi-subagents | **false** | `extension/index.ts`，固定串 |
| `web-search-content-ready` | pi-web-access 0.27.0 | true | `index.ts` 内联模板 |
| `web-search-error` | pi-web-access | true | `index.ts` 内联模板 |
| `goal-contract` | @narumitw/pi-goal 0.54.4 | **false** | `goal-contract.ts` |

`web-search-results` / `curator-config` / `google-account` 走的是 `pi.appendEntry()`，
是**会话条目不是消息**，不会进时间线。不用管。

`@juicesharp/rpiv-todo` 与 `@juicesharp/rpiv-ask-user-question` 不发 `custom_message`
（它们走 Pi 的 overlay/view 机制），也不用管。

---

## 1. `background-task-notification`

```
<background-task-notification>
  <task-id>{id}</task-id>
  <task-name>{name}</task-name>
  <status>{completed|failed|stopped|…}</status>
  <exit-code>{n}</exit-code>        ← task.exitCode === undefined 时整行不出现
  <error>{msg}</error>              ← 无错误时整行不出现
  <output-file>{path}</output-file>
  <summary>Background task "{name}" {status}</summary>
  <guidance>…</guidance>
</background-task-notification>
```

`guidance` 是给模型的操作指令（"不要 poll"），对人没有信息量 → 丢。
`summary` 是 `task-name` + `status` 的复述 → 也可以丢，卡片自己就有这两项。

## 2. `subagent-notify` —— 单条（`formatSingleCompletion`）

```
{Background task|Detached foreground task} {completed|failed|paused|stopped}: **{agent}**{taskInfo}

[Scheduled run from **{name}** (schedule {id}).]
[空行]
{resultPreview}
[空行]
[Child outputs:  ← 见 §2.1]
[空行]
[Parallel handoff: {path}]
[Workflow run: {uuid}]
[Child runs: {key|agent}={runId} ({status}), …]
[Reconciled detached child: {runId}]
[空行]
[Session: {v} | Session file: {v} | Session share error: {v}]
```

⭐ **`paused` 是第四种终态**，别只认 completed/failed/stopped。

Pi 自己带一个逆函数 `parseSubagentNotifyContent(content)`，就在 `notify.ts` 里，
是 `formatSingleCompletion` 的官方逆运算。本插件的切分方式照它来。

### 2.1 `Child outputs:` 区块（`formatChildOutputBlock`）

```
Child outputs:
- key={workflowKey|unavailable} run={runId|unavailable} status={status|unavailable}
  Saved output: {path|unavailable}
  Preview:
    | {输出第 1 行}
    | {输出第 2 行}
- key=… run=… status=…
  Saved output: …
  Preview: unavailable ({reason})
  Preview: unavailable (notice preview budget exceeded)   ← 第 9 个及以后
- {N} additional child preview(s) omitted by notice budget; child run metadata is retained below.
```

常量：`CHILD_OUTPUT_PREVIEW_COUNT = 8`，`CHILD_OUTPUT_PREVIEW_MAX_BYTES = 4 * 1024`。

**每个 child 的 agent 名字在这里取不到** —— `formatChildOutputBlock` 不输出它，
尽管 `SubagentNotifyChildOutput.agent` 这个字段是存在的。只有 `Child runs:` 那行
在 `workflowKey` 缺失时才会退回用 agent 名当 label。别指望能稳定拿到。

### 2.2 workflow 的 resultPreview

`subagent-executor.ts`：

```ts
const returnPreview = formatWorkflowValue(workflow.value).slice(0, 1_000);
const summary = `Workflow completed with ${n} child run(s). Return: ${returnPreview}${emitPreview} Trace: ${m} event(s).${mappings}${warnings}`;
```

⚠️ **`Return:` 后面那坨是硬截断到 1000 字符的预览，不是完整 JSON。**
`formatWorkflowValue` = `JSON.stringify(value, null, 2)`，所以里面嵌套字符串的换行
是**字面的 `\n` 两个字符**。截断点经常落在字符串中间，`JSON.parse` 在真实数据上必然失败。

→ 有 `Child outputs:` 时**整段丢掉**（同样的内容那边有结构化版本）；
   没有时才留作正文，并把 `\n` `\t` `\"` `\\` 还原。

失败/暂停时 summary 换成：
`Workflow failed.` / `Workflow paused.` / `Workflow completed after detached child finished.` / `status.error`

尾巴可能追加：
`Output path mappings: '{key}': requested {a} -> saved {b}; ….`

## 3. `subagent-notify` —— 批量（`formatGroupedCompletion`）

同一 session 的多条完成通知会被合批：

```
Background tasks completed ({n}): **{agent}**{taskInfo}, **{agent}**{taskInfo}

1. {agent}{taskInfo}[ — scheduled run from {name} (schedule {id})]
{resultPreview 含 Child outputs 区块}
[Parallel handoff: …]
[Workflow run: …]
[Child runs: …]
[Reconciled detached child: …]
[{sessionLine}]

2. {agent}…
```

注意批量形态**没有** `Background task completed: **x**` 那个头，别用单条的正则去套。

## 4. `subagent_supervisor_request`（`formatChildMessage`）

> ⚠️ **这不是在问用户。别做成问答卡片。**
>
> 正文结尾是 `Reply with: subagent_supervisor({ action: "reply", … })` —— 那是**工具调用**，
> 只有模型能发。`native-supervisor-channel.ts` 也是把它投给 `orchestratorSessionId`
> （父 agent）。整条链路是 subagent → 父 agent，人不参与。
>
> **Paseo 真正需要用户回答的提问走另一条通路**：
> `@getpaseo/server` 的 `pi/agent.js` 里 `mapExtensionUiRequestToPermission()`
> 把 Pi 的 extension UI 请求（`select` 等，来自 `@juicesharp/rpiv-ask-user-question`）
> 映射成 Paseo 的**权限对话框**，那里才有真正可点的选项。
>
> 本插件把这一类**折叠成一行**，不给强调色、不说「等你回话」。
> 曾经做成过「等你裁决」的样子，结果卡片给不出任何可选项 ——
> 没有选项不是漏做了选项，是它本来就不该问你。


```
{heading}
Run: {runId}
Agent: {agent}
Child index: {n}
[Child intercom target: {t}]

{message}

[Structured response requested. Reply with JSON, optionally fenced in ```json, matching the requested interview shape.]
Reply with: subagent_supervisor({ action: "reply", replyTo: "{uuid}", message: "…" })
```

`heading` 三种（`reasonHeading`）：

| reason | heading |
|---|---|
| `interview_request` | `Subagent requests a structured supervisor interview.` |
| `progress_update` | `Subagent progress update.` |
| 其他 | `Subagent needs a supervisor decision.` |

有 `replyTo` 才说明它**真的停住在等回话**。`progress_update` 不等。

## 5. `subagent_control_notice`（`formatControlNoticeMessage`）

> ⚠️ **和 §4 一样，这也不是给人的待办。**
>
> `control-notices.ts` 里是
> `pi.sendMessage(…, { triggerTurn: source === "async" })` ——
> 注入**父 agent 的 LLM 上下文并唤醒它**去处理。`display: true` 只是让 Pi 的 TUI
> 顺带展示一下。
>
> `Hint:` 和 `Next:` 是 `subagent-control.ts` 里的**硬编码常量**，逐条零信息量，
> 内容是让模型去调 `subagent({ action: "steer" / "resume" / "status" })` ——
> 只有模型能做。**不要解析进卡片**，否则用户会以为自己该动手。
>
> 本插件保留警示色（子任务长跑/卡住值得一眼看到）但不给强调边框、不挂状态角标，
> 并明说「已投给父 agent 处理」。


**三种**，靠首行区分：

### 5a `Subagent failed: {agent}` — `reason === "completion_guard"`
```
Subagent failed: {agent}
Run: {runId}[ step {n}]
Signal: {message}
Next: read the output artifact or session from the subagent result, then retry …
[Run intercom target (may be inactive): {t}]
```

### 5b `Subagent active but long-running: {agent}` — `type === "active_long_running"`
### 5c `Subagent needs attention: {agent}` — 其余

5b/5c 共同结构：
```
{首行}
Run: {runId}[ step {n}]
Signal: {message}
[Facts: {facts}]
[Recent failures: {summary}]          ← 仅 5c
[Supervisor request: reply to the pending request. …]  ← 仅 5c 且 reason=supervisor_request
Hint: …
Top-level live async nudge: subagent({…})
Routed live nested nudge: subagent({…})
[Direct intercom target: {t}]
Status: subagent({ action: "status", id: "…" })
Interrupt: subagent({ action: "interrupt", id: "…" })
```

`Facts` 格式（`formatLongRunningFacts`，` | ` 分隔）：
`elapsed {n}s | {n} turns | {n} tokens | {n} tools | tool {name} {n}s | path {p}`

最后那五行（nudge / intercom target / Status / Interrupt）是**给模型抄的工具调用**，
对人零信息量 → 全丢。

## 6. `subagent-wait-subscription`

```
Wait subscription {token} fired for run {runId}: {outcome}. {detail}
```

`outcome` ∈ `timed out` / `could not be reconciled` / `needs attention` / `failed` / `completed`

## 7. `web-search-content-ready` / `web-search-error`

```
Content fetched for {ok}/{total} URLs [{fetchId}]. {availability}
Content fetch failed [{fetchId}]: {message}
```

`availability` 三种：`Full page content now available.` /
`Partial page content now available.` /
`No page content was fetched. Stored fetch diagnostics are available.`

## 8. `display: false` —— Pi 从不给人看的两条

```
goal-contract:              This Goal contract supersedes every earlier goal-contract message. …
                            （或 "Goal mode is inactive." 开头的失活版）
subagent-compaction-resume: Compaction is complete. Resume the parent task now; background
                            subagent results will arrive separately when ready.
```

这两条是**纯 LLM 上下文管道**，Pi 的 TUI 从不显示。Paseo 不看 `display` 所以照样渲染成
一段莫名其妙的助手消息。归到 `model_only`，折叠成一行灰字。
