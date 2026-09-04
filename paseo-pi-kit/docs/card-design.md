# 卡片设计

这份文档记两件事：**结构化数据怎么变成人能读的东西**，以及**四张卡片凭什么长得一样**。
改 UI 之前先读这里 —— 下面每条规矩背后都有一次返工。

---

## 一、结构化数据：先认形状，再画

### 问题

Pi 的 workflow / subagent 完成通知里会带一坨 JSON（`Structured output:` 和
workflow `Return:`）。Paseo 当普通文本渲染，用户看到一堵墙。

第一版把它画成 **JSON 树** —— 结果只是把墙换成了树：

```
▾ evidence  9
    ▾ [0]  2
        check    exact subject and repository identity
        outcome  Independently recomputed AUDIT-REQUEST.json SHA-256 aeed…
    ▾ [1]  2
        …
  ok       true
  runId    28fa76b5-1e18-4f1d-a956-96c43ee185b6
  output   PLANNER_OK\n\n1. …
  error
```

键名原样、`true` 原样、花括号还在、数组画成 `[0] [1]`、空值画成 `{}`。
**信息全在，语义全丢。** 用户的原话：「很明显是个半成品」。

### 根因

那坨 JSON **不是配置对象**。把真实会话捞出来数一遍就清楚了：

```bash
# ~/.pi/agent/sessions/**/*.jsonl 里 type=custom_message 的载荷
runId:string 11 │ ok:boolean 9 │ output:string 9 │ error:string 3
```

主形状只有三种：

| 形状 | 例子 |
|---|---|
| 并行子运行结果表 | `[{ key, ok, runId, output, error }, …]` |
| 分步 workflow | `{ seed: {…}, parallel: [ … ] }` |
| 审计 / 检查报告 | `{ verdict, findings: [{ id, severity, finding, evidence }] }` |

这些都是**一串带判定的记录**，不是键值配置。所以 `ok` 该是行首的 ✓/✗，
`key` 该是行标题，`output` 该是正文段落 —— 而不是三个并列的键值对。

### 分层

```
domain/structured-view.shared.ts   认形状 → 视图模型（纯函数，无 React / 无主题 / 无文案）
ui/structured.client.tsx           画视图模型（无判定逻辑）
```

这么分是为了**形状识别能脱离渲染单测**。用例在 `tests/structured-view.test.ts`，
形状照真实数据抄，内容中性化。

### 转换规则

| 数据 | 画成 |
|---|---|
| `ok: true / false` | 行首 ✓/✗ + 整行色调；**不再是字段** |
| `status` / `verdict` / `severity` | 状态角标，带色调 |
| `key` / `name` / `agent` / `title` | 行标题 |
| `runId` / `id` / `sha` | 标题右侧灰色 mono，只留前 8 位 |
| `output` / `error` / `message` | 提升为正文段落；`error` 走危险色 |
| `null` / `""` / `{}` / `[]` | 折成一行 `空字段：Output、Meta` |
| 数组 | `1.` `2.` `3.`，**不是 `[0] [1]`** |
| 全是短标量的数组 | 一排角标 |
| 嵌套对象 | 小节 + 左侧竖线，**不出现任何括号** |
| 绝对路径 | 目录压暗 + 文件名提亮，mono |
| ISO 时间串 | 本地化时间 |
| `*_pct` 数字 | 百分比 + 进度条 |

顶部还有一句自动概览：`3 通过 · 1 失败`。

### 几条容易踩的边

**状态词认前缀，不靠全词表。** 真实取值是
`PASS_RQ3_CROSS_DOCUMENT_CONTROL_SUCCESSOR` / `FAIL_ACTIVATION_PRECONDITIONS`
这种，全词表永远追不上。认不出就 `default`，**不许猜成红色**。

**角标只收短单行的值。** 状态键上挂一整段话时留作正文字段 ——
否则一段话会被塞进角标。

**`error` 常常是 `output` 的超集。** 实测形状是 `error = output + "\n\nRun fan-out: …"`。
只比字符串全等的话，同一条错误会显示两遍。判据用**包含**。

**第一个短字段提成行标题，原标签留在 `titleLabel`。**
这条按**形状**判定不按键名 —— 不用去猜生产方写的是 `check` 还是 `item` 还是 `rule`。
表格的第一列就是身份。

**别把它降级成「唯一字段的标签当标题」。** 第一版那么写，
`{ runId: "0c13cb76-…" }` 画成标题 `Run ID` 底下再挂一条 `Run ID: 0c13cb76`，
同一个东西写两遍。

**退化情形要兜住。** 整个对象只有一个标识时（真实数据里 `{ runId: "…" }` 就是），
把它提成标题反而丢了标签 —— 画成 `0c13cb76` 谁也不知道那是什么。退回成普通字段。

**概览计数只数真正的成败位。** `severity` 也走角标，但「3 个 blocking 发现」
不该被概览说成「3 个失败」。

---

## 二、视觉统一：只有一处定义

### 问题

四张卡片（任务 / subagent / 通知 / provider 用量）原本各写各的。实测残留：

- 字号 10/11/12/13/15/17/18/20，还有 **8 处 `<Text>` 根本没写 `fontSize`**
- 圆角 5/8/9/10/12，内边距 5/7/8/9/10/11/12/14/18/28，图标 14/15/16/17
- 两条进度条轨道色不同（一处误用 `foregroundMuted` —— 那是**前景色**，
  深色主题上亮得像已填满）
- 五份各写各的「展开 / 收起」
- `balances` 的卡片边框用 `foregroundMuted`，比内容还亮
- 面板三种头部；`balances` 面板写死 `height: 500/580`，开在 explorer 侧栏里
  要么留白要么被截
- 硬编码没进 i18n：`残余风险：` `依赖：` `Acceptance:` `Resets` `Fetched`

单看每张都合理，放在同一条时间线上就很杂。

### 规矩

⭐ **`<Text>` 一律 `style={text(theme, "body", { muted: true })}`，不写内联样式对象。**
⭐ **不写字面量字号 / 圆角 / 图标尺寸，从 `FONT` / `RADIUS` / `ICON` 取。**
⭐ **面板一律套 `<PanelShell>`，卡片一律套 `<CardShell>`，条目一律套 `<RowShell>`。**

第一条最重要：`<Text style={{ color, fontWeight }}>` 漏掉 `fontSize`
**tsc 不报错**，只会安静地退回 react-native 默认字号，比邻居小一号。
上一轮「统一」就是被这个打回来的 —— 改完 tokens 之后还有 8 处这种写法活着。

### 套件

`ui/tokens.client.tsx` 是唯一的视觉定义处：

| | |
|---|---|
| 标量 | `FONT`（6 档）· `LINE`（一一对应）· `RADIUS` · `SPACE` · `ICON`（3 档）· `BAR_HEIGHT` |
| 样式 | `text(theme, variant, opts)` · `toneColor(theme, tone)` |
| 原子 | `Chip` · `ProgressBar` · `Mono` · `BoolMark` |
| 容器 | `CardShell` · `CardHeader` · `CardTitle` · `RowShell` · `RowHeader` · `Rail` · `MetaRow` · `KeyValue` · `SectionTitle` |
| 交互 | `ExpandToggle` · `DisclosureHeader` · `ActionButton` |
| 面板 | `PanelShell` · `EmptyState` · `ErrorText` |

缺档位就去那里加，**不要在组件里临时挑一个数**。

### 执行者

`tests/visual-tokens.test.ts` 逐条挡住上面的规矩：字面量字号 / 圆角 / 图标尺寸、
`<Text>` 内联样式、手写进度条、第二份 `toneColor`、没套 `PanelShell` 的面板、
`FONT`↔`LINE` 不成对、`openPanel` 漏 `location: "explorer"`，
以及**结构化渲染里不许再出现花括号 / `JSON.stringify`**。

这些都是**静默失效**的东西 —— 漏了不报错，只是看起来不对。靠肉眼守不住。
