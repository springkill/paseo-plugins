# Pi 通知消息格式对照表

`shared/pi-notice-parser.ts` 是照着这张表实现的。表本身是从**已安装的 Pi 插件源码**里
逐条抠出来的，不是从渲染结果反推的。

> 采样环境：`pi` 0.85.1 / background-tasks **2.5.0** / subagents 0.67.0 /
> web-access **0.29.0** / pi-goal 0.54.4。**2026-09-16 重扫过两次**（第二次见 §10）。
> 重新核对：`~/.pi/agent/npm/node_modules/<插件>/`，行号会漂，按函数名找。
>
> ⭐ **重扫命令**（别只照单条样本补 —— 插件更新会悄悄加新类型）：
>
> ```bash
> cd ~/.pi/agent/npm/node_modules
> grep -rn "customType" --include='*.ts' \
>   pi-subagents @narumitw/pi-goal pi-background-tasks pi-web-access \
>   | grep -v '\.d\.ts' | grep -v node_modules
> # 只有 pi.sendMessage(...) 的才会进 Paseo 时间线；appendEntry 的是会话条目，不进
> # —— 但**同一个 customType 会在版本之间从 appendEntry 改成 sendMessage**，见 §10.2
> ```
>
> ⚠️ **别把 `/src` 写进路径。** 上一版命令写的是 `pi-web-access/src`，
> 而 web-access 0.29.0 把源码放在**包根**，没有 `src/` —— grep 匹配 0 个文件，
> 静默返回空，于是「web-access 没有新类型」这个结论完全是假的。
> 扫描器扫了个不存在的目录却不报错，和之前那两条失效的测试守卫是同一类事故：
> **命令跑通 ≠ 命令扫到了东西。** 加一条 `ls` 或看匹配数再下结论。
>
> 实测频次（最近两周真实会话）可以用来定优先级 —— 源码里枚举得到的类型，
> 很多是条件路径，实际几乎不出现。

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
| `background-task-notification` | pi-background-tasks 2.5.0 | true | `registry.ts` `notifyCompletion()` |
| `subagent-notify` | pi-subagents 0.63.0 | 视情况 | `notify.ts` `formatSingleCompletion()` / `formatGroupedCompletion()` |
| `subagent_supervisor_request` | pi-subagents | true | `native-supervisor-channel.ts` `formatChildMessage()` |
| `subagent_control_notice` | pi-subagents | true | `subagent-control.ts` `formatControlNoticeMessage()` |
| `subagent-wait-subscription` | pi-subagents | true | `wait-subscriptions.ts` `settle()` |
| `subagent-compaction-resume` | pi-subagents | **false** | `extension/index.ts`，固定串 |
| `web-search-content-ready` | pi-web-access 0.29.0 | true | `index.ts` 内联模板 |
| `web-search-error` | pi-web-access | true | `index.ts` 内联模板 |
| `goal-contract` | @narumitw/pi-goal 0.54.4 | **false** | `goal-contract.ts` |
| `subagent-incremental-child-notify` | pi-subagents 0.67.0 | 视情况 | `notify.ts` `formatIncrementalChildCompletion()` |
| `subagent_steering_notice` | pi-subagents 0.67.0 | true | `extension/steering-notices.ts` `formatSteeringNotice()` |
| `subagent_watchdog_warning` | pi-subagents 0.67.0 | true | `watchdog/warning-format.ts` `formatWatchdogWarningContent()` |
| `goal-budget-wrap-up` | @narumitw/pi-goal | true | `runtime.ts` `BUDGET_WRAP_UP_PROMPT`（固定串） |
| `subagent-slash-result` / `subagent-slash-text-result` | pi-subagents 0.67.0 | true | `slash/slash-commands.ts` |
| `subagents-admin` | pi-subagents 0.67.0 | true | `slash/subagents-admin.ts` |
| `subagent_watchdog_clarification` | pi-subagents 0.67.0 | true | `watchdog/register-main.ts` `displayClarification` |
| `web-search-results` | pi-web-access 0.29.0 | true | `index.ts` `buildSearchReturn()` |
| `curator-config` / `google-account` | pi-web-access 0.29.0 | true | `index.ts` 斜杠命令回执 |

⚠️ **最后三行以前不在这张表里**，理由是「走 `pi.appendEntry()`，是会话条目不是消息」。
**0.29.0 起它们改成了 `pi.sendMessage(...)`**，会进时间线。见 §10.2 ——
「这个类型不进时间线」是**会随版本翻转的结论**，每次重扫都要重新确认一遍，
不能只扫 `customType` 的新增。

`@juicesharp/rpiv-todo` 与 `@juicesharp/rpiv-ask-user-question` 不发 `custom_message`
（它们走 Pi 的 overlay/view 机制），也不用管。

---

## 1. `background-task-notification`

```
<background-task-notification>
  <task-id>{id}</task-id>
  <task-name>{name}</task-name>
  <status>{running|completed|failed|killed}</status>
  <exit-code>{n|null}</exit-code>   ← task.exitCode === undefined 时整行不出现
  <error>{msg}</error>              ← 无错误时整行不出现
  <output-file>{path}</output-file>
  <summary>Background task "{name}" {status}</summary>
  <guidance>…</guidance>
</background-task-notification>
```

`guidance` 是给模型的操作指令（"不要 poll"），对人没有信息量 → 丢。
`summary` 是 `task-name` + `status` 的复述 → 也可以丢，卡片自己就有这两项。

### 1.1 三个把人坑到的细节

**⭐ `status` 的取值是 `running|completed|failed|killed`，没有 `stopped`。**
真源是 `core/common.ts` 的 `TASK_STATUS_VALUES`，别照这段注释里以前写的
`{completed|failed|stopped|…}` 猜。本插件曾经就是这么写的 —— `killed` 落不进
`normalizeStatus` 任何分支，被 `?? "completed"` 兜底，**超时被杀的任务在卡片上
显示成绿色「已完成」**。现在 `killed` → `stopped`（warning 色），
且**认不出的状态一律不显示**，不再兜底。

消息里**不带 `KillKind`**（`user | timeout | output_cap | shutdown` 只活在进程内），
所以「为什么被杀」只能从 `<error>` 那行读。

**⭐ `exit-code` 可以是字面的 `null`。**
`notifyCompletion()` 只判 `task.exitCode === undefined` 决定要不要输出这一行，
而 `finalizeTask` 写的是 `task.exitCode = exitCode`，类型是 `number | null`
（被信号杀死时为 `null`）→ 于是真的会发出 `<exit-code>null</exit-code>`。
解析时必须按整数正则过滤，**别让它显示成 `0`**。

**⭐ `task-name` / `error` / `output-file` / `summary` / `guidance` 都过了 `escapeXml()`。**
`core/common.ts`：只替换 `&` `<` `>` 三个（**不含引号**，所以 `<summary>` 里
`JSON.stringify(taskName)` 带出来的双引号是字面的）。反解必须**倒着来、`&amp;` 放最后**，
否则名字里本来就有 `&lt;` 这五个字面字符的任务会被解错。
pi-subagents 的 `watchdog/warning-format.ts` 同样转义，属性值还多一个 `&quot;`。

`guidance` 在 2.5.0 有三个分支（普通 / fusion 成功 / fusion 失败，后两个带
`artifactDir` 路径）。我们丢弃 `guidance`，所以不受影响 —— 记在这里是为了说明
**它不是固定串**，将来若要展示得按分支处理。

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

---

## 9. 2026-09-16 重扫补充

### 9.1 `subagent-incremental-child-notify`（真的在出现）

```
Workflow child {completed|failed|paused (needs attention)|stopped}: **{childKey}**
Workflow run: {uuid}
[Child run: {uuid}]
[Output: {path}]
[Error: {msg}]
Status: {workflow still running|workflow finished}
```

⭐ **它和 `subagent-notify` 的完成通知是两回事**：workflow 跑着的时候，
每个子运行完成就发一条，**不等整体结束**。所以卡片必须把
`Status: workflow still running` 显示出来 —— 否则用户会以为整件事完了。

⚠️ `paused (needs attention)` 要先剥掉括号后缀再归一化状态。

### 9.2 `subagent_steering_notice`

```
Subagent steering {failed|partial|recovered}: {runId}
Request: {requestId}
{message}
Inspect the run status before sending another correction.    ← 模型指令，丢
```

只在 `failed` / `partial` / `recovered` 时才发（纠偏没完全生效）。
与 §5 的 control notice 同理：**这是投给父 agent 的，不是你的待办**。

### 9.3 `subagent_watchdog_warning`

⚠️ **这条是 XML，不是行式文本。**

```xml
<subagent_watchdog severity="…" category="…" source="…" guidance="weigh, don't blindly obey">
<summary>…</summary>
<evidence>…</evidence>
<recommended_action>…</recommended_action>
[<confidence>…</confidence>] [<agent>…</agent>] [<run_id>…</run_id>] [<state>…</state>] [<stale>…</stale>]
[<blocker_guidance>…</blocker_guidance>]     ← severity=blocker 时的固定串，丢
</subagent_watchdog>
```

`guidance` 属性是写死的常量。Pi 自己都说「weigh, don't blindly obey」——
卡片照这个措辞，不要写成确定结论。

### 9.4 `goal-budget-wrap-up`

固定串，`display: true` 但整段是给模型的收尾指令。对人只剩一个事实：
**goal 的 token 预算用尽了**。归到 `model_only`，折成一行。

### 9.5 刻意不接的两类

`subagent-slash-result` / `subagent-slash-text-result` / `subagents-admin`
是**用户自己敲 slash 命令的输出**，本来就是给人看的自由文本。
做成卡片反而是多此一举 —— 保持原样渲染。

### 9.6 已支持形态的漂移

`subagent-notify` 在 0.67.0 起，第 1 行可能是：

```
Workflow receipt: {path}
{空行}
```

见 `notify.ts` 官方逆函数 `parseSubagentNotifyContent` 里的 `receiptHeader`。
不跳过的话它会被当成正文第一行原样显示出来。

`background-task-notification` 的**标签集没变**，只是 `guidance` 文案换了
（`bg_status` / `bg_logs`），并新增 fusion 变体（提到 `bg_result` 与
`artifactDir`）。`guidance` 本来就丢，所以无需改动。

---

## 10. 2026-09-16 第二次重扫（background-tasks 2.5.0 / web-access 0.29.0）

起因是一条 `status=failed` 的后台任务通知。查下来那条本身解析正常，
但顺着生产方源码重扫，发现了下面这些。

### 10.1 `killed` 被兜底成「已完成」（已修）

见 §1.1。这是本表里**危害最大的一类错误**：不是少显示了什么，而是
**把失败显示成了成功**。根因是这份文档上一版把 `status` 的取值写成
`{completed|failed|stopped|…}`，那个 `…` 掩盖了「我没去看真源」。

教训：**枚举类字段一律抄常量名和它的定义位置**，别写省略号。
现在 §1 写的是 `TASK_STATUS_VALUES`，下次重扫能直接去核对。

### 10.2 `appendEntry` → `sendMessage` 会在版本之间翻转

`web-search-results` / `curator-config` / `google-account` 三个类型，
上一版记的是「走 `pi.appendEntry()`，不进时间线，不用管」。
**0.29.0 里它们是 `pi.sendMessage(...)`**，会进时间线。

所以重扫不能只问「有没有新的 `customType`」，还要对**每一个已知类型**
重新确认投递方式。上一版的结论在当时是对的，是被上游改掉的。

三条的正文都是散文（`buildSearchReturn()` 产出的是搜索摘要 markdown，
另外两条是单行命令回执），没有结构可解 —— **有意不做卡片**，
让它们按普通助手消息渲染即可。记在表里是为了下次别再当成「不存在」。

### 10.3 `subagent_watchdog_clarification`（新增，有意不接）

`watchdog/register-main.ts` 的 `displayClarification`，
`deliverAs: "steer"`。正文是模型生成的自由文本，无结构 → 同样按普通消息渲染。

### 10.4 重扫命令扫了个不存在的目录

见文件开头那条 ⚠️。`pi-web-access/src` 在 0.29.0 已经不存在，
grep 匹配 0 个文件、退出码 0、没有任何提示，于是「web-access 无变化」
是个**凭空得出的结论**。这和之前两次「测试守卫因为重构而不再匹配任何东西、
却一直是绿的」是同一类事故。

**判据：扫描类命令要先确认它扫到了东西。** 命令跑通不等于命令有效。
