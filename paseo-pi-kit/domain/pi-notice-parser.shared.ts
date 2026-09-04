/**
 * Pi 的通知类消息解析。
 *
 * ═══════════════════════════════════════════════════════════════════
 * COMPAT(pi-custom-message): 上游修好就整个删掉这个文件。
 *
 * 加于 2026-09-04，针对 @getpaseo/server 0.7.2 + pi 0.84.4。
 *
 * **判断能不能删**（一条命令，实测可跑）：
 *
 * ```bash
 * grep -rn --include='*.js' 'mapCustomMessage:' \
 *   "$(npm root -g)/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/server/agent/providers/pi/" | wc -l
 * ```
 *
 * 找的是**对象字面量属性**（带冒号）—— 那才代表 provider 真的提供了这个钩子。
 * 光找 `mapCustomMessage` 这个名字没用：它作为钩子的*声明*一直都在。
 *
 * - `0` = 仍未提供，这一层还需要（0.7.2 时是 0）
 * - `≥1` = 上游接上了，可以删
 *
 * 一旦上游把 Pi 的 `custom_message` 映射成结构化时间线条目（带 details），
 * 这里连同 `ui/pi-notice.client.tsx`、`PiNoticeSchema`、
 * `tests/pi-notice.test.ts`、`docs/pi-message-formats.md` 和 index.ts 里那个
 * transformer 一起删。
 *
 * ⚠️ 上游修好时这一层是**静默失效**的：时间线条目不再是 assistant_message，
 * transformer 就不再触发，卡片安静地消失，没有任何报错。所以别指望它自己提醒你 ——
 * 靠上面那条命令定期看一眼。
 * ═══════════════════════════════════════════════════════════════════
 *
 * ## 这些规则从哪来
 *
 * ⭐ **不是从渲染结果反推的，是从 Pi 插件源码里逐条抄的。**
 * 完整对照表在 `docs/pi-message-formats.md`，每种消息都标了构造它的那个
 * `format*()` 函数在哪个文件。改这里之前先读那张表。
 *
 * Pi 发的是带结构的 `custom_message`：`details` 里字段齐全，而且 Pi 自己用
 * `pi.registerMessageRenderer(customType, …)` 在 TUI 里结构化渲染。
 *
 * 但 Paseo 的 Pi provider（`pi/history-mapper.js` 的 `mapCustomMessage`）：
 *
 * ```js
 * const mappedEvent = text ? this.hooks.mapCustomMessage?.(text, this.provider) : null;
 * if (mappedEvent) return [mappedEvent];
 * return [{ type: "timeline", item: { type: "assistant_message", text } }];
 * ```
 *
 * `hooks.mapCustomMessage` **没有任何 provider 提供**，所以永远走默认分支 ——
 * `details` 整个被丢掉，只剩 `content` 那段给人看的文本。
 *
 * 同一个 mapper 里也**没有 `display` 处理**，所以 Pi 标了 `display: false`
 * （只喂模型、TUI 从不显示）的消息也照样进时间线 → 见 `parseModelOnly`。
 *
 * ⚠️ 文本格式是 Pi 的内部约定，不是契约。所以每条规则都写得尽量宽松：
 * 取不到的字段留空而不是整条判失败 —— 少一个耗时不该让整张卡片退回裸文本。
 */

import {
  PiNoticeSchema,
  type PiChildOutput,
  type PiCompletionEntry,
  type PiNotice,
} from "./contracts.shared";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `<tag>值</tag>`。不依赖换行 —— 这段文本在有些渲染路径上会被压成一行。 */
function tag(text: string, name: string): string | undefined {
  const match = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match?.[1]?.trim() || undefined;
}

/** 行首 `Label: 值`。 */
function field(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`^${label}:[ \\t]*(.+)$`, "m"));
  return match?.[1]?.trim() || undefined;
}

/** Pi 拿不到值时统一写 `unavailable`，别把它当成真值。 */
function real(value: string | undefined): string | undefined {
  return value && value !== "unavailable" ? value : undefined;
}

function toInt(value: string | undefined): number | undefined {
  return value !== undefined && /^-?\d+$/.test(value) ? Number(value) : undefined;
}

/**
 * `JSON.stringify` 出来的字符串里，换行是字面的两个字符 `\` + `n`。
 * 只在退回展示 `Return:` 预览时用 —— 那段是被硬截断的，还原不了结构，
 * 至少把换行还回去，别让人看一堵 `\n1.` `\n2.` 的墙。
 */
function unescapeJsonish(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function normalizeStatus(value: string | undefined): PiNotice["status"] {
  switch ((value ?? "").toLowerCase()) {
    case "completed":
    case "complete":
    case "success":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    // ⭐ Pi 的第四种终态，别漏（notify.ts 的 status 联合类型里有）
    case "paused":
      return "paused";
    case "stopped":
    case "canceled":
    case "cancelled":
      return "stopped";
    case "running":
      return "running";
    case "attention":
    case "needs attention":
      return "attention";
    case "timed out":
      return "timed_out";
    case "could not be reconciled":
      return "unresolved";
    default:
      return undefined;
  }
}

// ── 1. background-task-notification ─────────────────────────────────
// pi-background-tasks/src/core/registry.ts `notifyCompletion()`

function parseBackgroundTask(text: string): Partial<PiNotice> | null {
  if (!text.includes("<background-task-notification>")) return null;
  return {
    kind: "background_task",
    taskId: tag(text, "task-id"),
    taskName: tag(text, "task-name"),
    status: normalizeStatus(tag(text, "status")) ?? "completed",
    exitCode: toInt(tag(text, "exit-code")),
    error: tag(text, "error"),
    outputFile: tag(text, "output-file"),
    // summary 只是 task-name + status 的复述，卡片自己就有这两项
    // guidance 是给模型的操作指令（"不要 poll"），对人零信息量
    body: "",
  };
}

// ── 2/3. subagent-notify ────────────────────────────────────────────
// pi-subagents/src/runs/background/notify.ts
//   formatSingleCompletion() / formatGroupedCompletion()
// Pi 自己带官方逆函数 parseSubagentNotifyContent()，下面的切分照它来。

const SINGLE_HEADER =
  /^(Background task|Detached foreground task) (completed|failed|paused|stopped): \*\*(.+?)\*\*(?:\s+(\([^)]*\)))?$/;
const GROUP_HEADER = /^Background tasks completed \((\d+)\):/;
const SCHEDULE_LINE = /^Scheduled run from \*\*(.+?)\*\* \(schedule (.+?)\)\.$/;
const SESSION_LINE = /^(Session|Session file|Session share error):\s+/;

/** `Child outputs:` 区块 → 结构化子项。见 formatChildOutputBlock。 */
function parseChildOutputs(block: string[]): {
  childOutputs: PiChildOutput[];
  omittedPreviews?: number;
} {
  const childOutputs: PiChildOutput[] = [];
  let omittedPreviews: number | undefined;
  let current: PiChildOutput | null = null;
  let preview: string[] | null = null;

  const flush = () => {
    if (current) {
      if (preview) {
        const joined = preview.join("\n").trim();
        if (joined) current.preview = joined;
      }
      childOutputs.push(current);
    }
    current = null;
    preview = null;
  };

  for (const line of block) {
    const head = line.match(/^- key=(\S*) run=(\S*) status=(\S*)$/);
    if (head) {
      flush();
      current = {
        key: real(head[1]),
        runId: real(head[2]),
        status: real(head[3]),
      };
      continue;
    }
    const omitted = line.match(/^- (\d+) additional child preview\(s\) omitted/);
    if (omitted) {
      flush();
      omittedPreviews = Number(omitted[1]);
      continue;
    }
    if (!current) continue;

    const saved = line.match(/^ {2}Saved output: (.*)$/);
    if (saved) {
      current.savedOutputPath = real(saved[1]?.trim());
      continue;
    }
    const unavailable = line.match(/^ {2}Preview: unavailable \((.+)\)$/);
    if (unavailable) {
      current.previewUnavailable = unavailable[1];
      continue;
    }
    if (line === "  Preview:") {
      preview = [];
      continue;
    }
    // 预览行是 `    | ${line}`，空行会留下尾随空格
    const previewLine = line.match(/^ {4}\| ?(.*)$/);
    if (previewLine && preview) preview.push(previewLine[1] ?? "");
  }
  flush();
  return { childOutputs, ...(omittedPreviews !== undefined ? { omittedPreviews } : {}) };
}

/**
 * workflow 的摘要行。
 *
 * ⚠️ `Return:` 后面那坨是 `formatWorkflowValue(v).slice(0, 1_000)` ——
 * **硬截断的预览，不是完整 JSON**，截断点经常落在字符串中间。
 * 所以不 JSON.parse：有 `Child outputs:` 时整段丢（那边有结构化版本），
 * 没有时才留作正文并还原转义。
 */
function parseWorkflowSummary(summary: string): {
  workflow?: PiCompletionEntry["workflow"];
  summary: string;
} {
  const started = summary.match(/^Workflow completed with (\d+) child run\(s\)\. Return: /);
  const terminal = summary.match(
    /^(Workflow failed\.|Workflow paused\.|Workflow stopped\.|Workflow completed after detached child finished\.)/,
  );
  if (!started && !terminal) return { summary };

  const notes: string[] = [];
  let rest = summary;
  let traceEvents: number | undefined;
  let returnValue: string | undefined;

  if (started) {
    // Return 预览可能自己就含 " Trace: " 字样，取最后一处作为真正的边界
    const marker = / Trace: (\d+) event\(s\)\./g;
    let last: RegExpExecArray | null = null;
    for (let m = marker.exec(summary); m; m = marker.exec(summary)) last = m;
    if (last) {
      traceEvents = Number(last[1]);
      returnValue = summary.slice(started[0].length, last.index);
      rest = summary.slice(last.index + last[0].length).trim();
    } else {
      returnValue = summary.slice(started[0].length);
      rest = "";
    }
  } else {
    rest = summary.slice(terminal![0].length).trim();
    notes.push(terminal![1]!.replace(/\.$/, ""));
  }

  // 尾巴上的输出路径映射与 preflight 告警都是对人有用的
  if (rest) notes.push(rest);

  return {
    workflow: {
      ...(started ? { childCount: Number(started[1]) } : {}),
      ...(traceEvents !== undefined ? { traceEvents } : {}),
      notes,
      ...(returnValue !== undefined ? { returnTruncated: true } : {}),
    },
    // 正文留空，调用方在没有 childOutputs 时会拿 returnValue 兜底
    summary: returnValue !== undefined ? unescapeJsonish(returnValue).trim() : "",
  };
}

/**
 * 从正文里把 JSON 块抠出来并解析。
 *
 * Pi 有两处会往正文里塞 JSON，而且**都是硬截断的**：
 *
 * - `Structured output:\n${JSON.stringify(v, null, 2).slice(0, 4_000)}`
 *   （result-watcher.ts / notify.ts）
 * - `Return: ${formatWorkflowValue(v).slice(0, 1_000)}`
 *   （subagent-executor.ts）
 *
 * 截断点经常落在结构中间，所以 `JSON.parse` 会失败 —— 那时退回原文，
 * 至少别把「解析失败」变成「什么都不显示」。
 */
function extractJson(text: string): { value?: unknown; raw?: string; repaired?: boolean } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return {};
  try {
    const value: unknown = JSON.parse(trimmed);
    // 只接受 JSON 兼容的结果 —— 宿主会校验，见 index.ts 的 timelineData
    if (value !== undefined) return { value };
  } catch {
    // 往下走修复
  }
  const repaired = repairTruncatedJson(trimmed);
  return repaired !== undefined ? { value: repaired, repaired: true } : { raw: trimmed };
}

/**
 * 把被截断的 JSON 修回能解析的形状。
 *
 * ⭐ Pi 的截断是**常态不是意外**：`Structured output:` 砍在 4000 字符、
 * workflow `Return:` 砍在 1000 字符，断点几乎总是落在结构中间。
 * 不修的话这两处永远只能当文本墙倒出来 —— 而那正是这个插件要解决的问题。
 *
 * 做法：从后往前找「安全切点」（字符串外的 `,` 或闭合括号），在那里截断，
 * 再按扫描出来的栈补齐闭合符号。试几次就放弃 —— 修不出来时退回原文，
 * 显示不全好过什么都不显示。
 */
function repairTruncatedJson(text: string): unknown {
  const cuts: number[] = [];
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
    } else if (char === "}" || char === "]") {
      stack.pop();
      cuts.push(index + 1);
    } else if (char === ",") {
      cuts.push(index);
    }
  }

  // 从最靠后的切点开始试，最多五次
  for (const cut of cuts.slice(-5).reverse()) {
    const head = text.slice(0, cut);
    const depth: string[] = [];
    let quoted = false;
    let skip = false;
    for (let index = 0; index < head.length; index++) {
      const char = head[index]!;
      if (skip) { skip = false; continue; }
      if (char === "\\") { if (quoted) skip = true; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      if (char === "{" || char === "[") depth.push(char === "{" ? "}" : "]");
      else if (char === "}" || char === "]") depth.pop();
    }
    if (quoted) continue; // 切在字符串里，换下一个切点
    try {
      const value: unknown = JSON.parse(head + depth.reverse().join(""));
      if (value !== undefined) return value;
    } catch {
      // 换下一个切点
    }
  }
  return undefined;
}

/** `Child runs: k=id (status), k2=id2` → 结构化。 */
function parseChildRunsLine(value: string): PiCompletionEntry["childRuns"] {
  return value
    .split(", ")
    .map((part): PiCompletionEntry["childRuns"][number] => {
      const trimmed = part.trim();
      const match = trimmed.match(/^(.*?)(?: \(([^)]*)\))?$/);
      const raw = match?.[1] ?? trimmed;
      const separator = raw.indexOf("=");
      const status = match?.[2];
      return separator >= 0
        ? { key: raw.slice(0, separator), runId: real(raw.slice(separator + 1)), ...(status ? { status } : {}) }
        : { runId: real(raw), ...(status ? { status } : {}) };
    })
    // 子任务还没拿到 runId 就失败时，key + status 仍然有价值，别丢
    .filter((child) => child.key || child.runId);
}

/**
 * 一节完成通知（单条的正文，或合批里的一项）→ 结构化。
 *
 * `body` 是头部之后的所有行；切分方式抄自 Pi 的 parseSubagentNotifyContent。
 */
function parseCompletionBody(body: string[], agent: string, taskInfo?: string): PiCompletionEntry {
  let rows = body;

  let schedule: PiCompletionEntry["schedule"];
  const scheduleMatch = (rows[0] ?? "").match(SCHEDULE_LINE);
  if (scheduleMatch) {
    const label = scheduleMatch[1]!;
    const id = scheduleMatch[2]!;
    schedule = { id, ...(label === id ? {} : { name: label }) };
    rows = rows.slice(rows[1]?.trim() === "" ? 2 : 1);
  }

  // session 行认的是「空行 + Session…」这个组合，避免把正文里的冒号行误当元信息
  let sessionIndex = -1;
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i - 1]?.trim() === "" && SESSION_LINE.test(rows[i]!)) {
      sessionIndex = i;
      break;
    }
  }
  const handoffIndex = rows.findIndex((line) => line.startsWith("Parallel handoff: "));
  const workflowRunIndex = rows.findIndex((line) => line.startsWith("Workflow run: "));
  const childRunsIndex = rows.findIndex((line) => line.startsWith("Child runs: "));
  const reconciledIndex = rows.findIndex((line) => line.startsWith("Reconciled detached child: "));
  const metadata = [sessionIndex, handoffIndex, workflowRunIndex, childRunsIndex, reconciledIndex]
    .filter((index) => index >= 0);
  const firstMetadata = metadata.length ? Math.min(...metadata) : rows.length;
  const resultEnd = firstMetadata > 0 && rows[firstMetadata - 1]?.trim() === ""
    ? firstMetadata - 1
    : firstMetadata;

  const resultRows = rows.slice(0, resultEnd);
  const childOutputsIndex = resultRows.findIndex((line) => line === "Child outputs:");
  const summaryRows = childOutputsIndex >= 0 ? resultRows.slice(0, childOutputsIndex) : resultRows;
  const { childOutputs, omittedPreviews } = childOutputsIndex >= 0
    ? parseChildOutputs(resultRows.slice(childOutputsIndex + 1))
    : { childOutputs: [], omittedPreviews: undefined };

  const rawSummary = summaryRows.join("\n").trim();
  const { workflow, summary: workflowSummary } = parseWorkflowSummary(rawSummary);

  // workflow 的 Return 预览只在没有结构化子输出时才值得展示
  const plainSummary = workflow
    ? (childOutputs.length ? "" : workflowSummary)
    : rawSummary === "(no output)" ? "" : rawSummary;

  // ⭐ `Structured output:` 后面那坨 JSON 是本插件最初要解决的问题本身 ——
  // 拆成结构化数据交给卡片渲染，别再当一堵文本墙倒出来。
  let structured: unknown;
  let structuredTruncated: boolean | undefined;
  let summary = plainSummary;
  const structuredAt = plainSummary.indexOf("Structured output:");
  const blob = structuredAt >= 0
    ? plainSummary.slice(structuredAt + "Structured output:".length)
    : workflow ? plainSummary : "";
  if (blob.trim()) {
    const extracted = extractJson(blob);
    if (extracted.value !== undefined) {
      structured = extracted.value;
      structuredTruncated = extracted.repaired;
      summary = structuredAt >= 0 ? plainSummary.slice(0, structuredAt).trim() : "";
    } else if (extracted.raw && structuredAt >= 0) {
      // 连修都修不出来 —— 标记出来，正文保留原文
      structuredTruncated = true;
    }
  }

  const sessionLine = sessionIndex >= 0 ? rows[sessionIndex]! : undefined;
  const separator = sessionLine?.indexOf(":") ?? -1;

  return {
    agent,
    ...(taskInfo ? { taskInfo } : {}),
    summary,
    ...(structured !== undefined ? { structured } : {}),
    ...(structuredTruncated ? { structuredTruncated } : {}),
    ...(workflow ? { workflow } : {}),
    childOutputs,
    ...(omittedPreviews !== undefined ? { omittedPreviews } : {}),
    childRuns: childRunsIndex >= 0
      ? parseChildRunsLine(rows[childRunsIndex]!.slice("Child runs: ".length))
      : [],
    ...(workflowRunIndex >= 0
      ? { workflowRunId: rows[workflowRunIndex]!.slice("Workflow run: ".length).trim() }
      : {}),
    ...(handoffIndex >= 0
      ? { handoffPath: rows[handoffIndex]!.slice("Parallel handoff: ".length).trim() }
      : {}),
    ...(reconciledIndex >= 0
      ? { reconciled: rows[reconciledIndex]!.slice("Reconciled detached child: ".length).trim() }
      : {}),
    ...(schedule ? { schedule } : {}),
    ...(sessionLine && separator > 0
      ? {
        session: {
          label: sessionLine.slice(0, separator).toLowerCase(),
          value: sessionLine.slice(separator + 1).trim(),
        },
      }
      : {}),
  };
}

/** 单条完成通知。 */
function parseSingleCompletion(text: string): Partial<PiNotice> | null {
  const rows = text.split("\n");
  const header = (rows[0] ?? "").match(SINGLE_HEADER);
  if (!header) return null;
  const status = normalizeStatus(header[2]);
  const entry = parseCompletionBody(rows.slice(2), header[3]!, header[4]);
  return {
    kind: "completion",
    variant: header[1] === "Background task" ? "background" : "foreground",
    status,
    entries: [{ ...entry, ...(status ? { status } : {}) }],
    body: "",
  };
}

/**
 * 合批完成通知。
 *
 * ⭐ 它**没有** `Background task completed: **x**` 那个头，用单条的正则套不上 ——
 * 同一 session 的多条完成会被 completion-batcher 合并成这一种。
 */
function parseGroupedCompletion(text: string): Partial<PiNotice> | null {
  const rows = text.split("\n");
  const header = (rows[0] ?? "").match(GROUP_HEADER);
  if (!header) return null;

  // 每节以 `N. agent…` 起头
  const starts: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (/^\d+\. \S/.test(rows[i]!)) starts.push(i);
  }
  const entries: PiCompletionEntry[] = [];
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]!;
    const to = i + 1 < starts.length ? starts[i + 1]! : rows.length;
    const head = rows[from]!.replace(/^\d+\.\s*/, "");
    // `agent(taskInfo) — scheduled run from name (schedule id)`
    const scheduled = head.match(/^(.*?) — scheduled run from (.+?) \(schedule (.+?)\)$/);
    const label = (scheduled?.[1] ?? head).trim();
    const info = label.match(/^(.*?)\s*(\([^)]*\))$/);
    const entry = parseCompletionBody(rows.slice(from + 1, to), info?.[1]?.trim() || label, info?.[2]);
    entries.push({
      ...entry,
      status: "completed",
      ...(scheduled
        ? {
          schedule: {
            id: scheduled[3]!,
            ...(scheduled[2] === scheduled[3] ? {} : { name: scheduled[2]! }),
          },
        }
        : {}),
    });
  }
  if (entries.length === 0) return null;
  return { kind: "completion", variant: "grouped", status: "completed", entries, body: "" };
}

// ── 4. subagent_supervisor_request ──────────────────────────────────
// pi-subagents/src/intercom/native-supervisor-channel.ts formatChildMessage()

const SUPERVISOR_HEADINGS: Record<string, string> = {
  "Subagent needs a supervisor decision.": "need_decision",
  "Subagent progress update.": "progress_update",
  "Subagent requests a structured supervisor interview.": "interview_request",
};

/** 头部之后要丢掉的行：内部路由地址、给模型抄的调用样板。 */
const SUPERVISOR_META = /^(Run|Agent|Child index|Child intercom target):/;

function parseSupervisor(text: string): Partial<PiNotice> | null {
  const rows = text.split("\n");
  const variant = SUPERVISOR_HEADINGS[(rows[0] ?? "").trim()];
  if (!variant) return null;

  const body = rows
    .slice(1)
    .filter((line) => !SUPERVISOR_META.test(line))
    .join("\n")
    .replace(/^Structured response requested\. Reply with JSON[\s\S]*$/m, "")
    .replace(/^Reply with:[\s\S]*$/m, "")
    .trim();

  return {
    kind: "supervisor",
    variant,
    runId: field(text, "Run"),
    agent: field(text, "Agent"),
    childIndex: toInt(field(text, "Child index")),
    replyTo: text.match(/replyTo:\s*"([^"]+)"/)?.[1],
    body,
  };
}

// ── 5. subagent_control_notice ──────────────────────────────────────
// pi-subagents/src/runs/shared/subagent-control.ts formatControlNoticeMessage()

const CONTROL_HEADINGS: Array<{ pattern: RegExp; variant: string; status: PiNotice["status"] }> = [
  { pattern: /^Subagent failed: (.+)$/, variant: "failed", status: "failed" },
  { pattern: /^Subagent active but long-running: (.+)$/, variant: "long_running", status: "running" },
  { pattern: /^Subagent needs attention: (.+)$/, variant: "attention", status: "attention" },
];

function parseControlNotice(text: string): Partial<PiNotice> | null {
  const first = (text.split("\n")[0] ?? "").trim();
  for (const { pattern, variant, status } of CONTROL_HEADINGS) {
    const header = first.match(pattern);
    if (!header) continue;
    // `Run: <uuid> step 3`
    const run = field(text, "Run");
    const step = run?.match(/\sstep (\d+)$/);
    const facts = field(text, "Facts");
    return {
      kind: "control",
      variant,
      status,
      agent: header[1]!.trim(),
      runId: run?.split(/\s+/)[0],
      ...(step ? { step: Number(step[1]) } : {}),
      signal: field(text, "Signal"),
      facts: facts ? facts.split(" | ").map((fact) => fact.trim()).filter(Boolean) : [],
      recentFailures: field(text, "Recent failures"),
      // ⭐ Hint / Next 不解析：它们是 subagent-control.ts 里的**硬编码常量**
      // （"Use steer for a top-level live async child…"），逐条零信息量，
      // 而且说的是 subagent({action:"steer"/"status"}) 这类工具动作 ——
      // 只有模型能做。放进卡片只会让人以为自己该动手。
      // 同理丢掉 nudge / intercom target / Status / Interrupt 那几行。
      body: "",
    };
  }
  return null;
}

// ── 6. subagent-wait-subscription ───────────────────────────────────
// pi-subagents/src/runs/background/wait-subscriptions.ts settle()

function parseWaitSubscription(text: string): Partial<PiNotice> | null {
  const match = text.match(
    /^Wait subscription (\S+) fired for run (\S+): (.+?)\.(?:\s+([\s\S]*))?$/,
  );
  if (!match) return null;
  const outcome = match[3]!.trim();
  return {
    kind: "wait",
    token: match[1],
    runId: match[2],
    outcome,
    status: normalizeStatus(outcome),
    body: match[4]?.trim() ?? "",
  };
}

// ── 7. web-search-content-ready / web-search-error ──────────────────
// pi-web-access/index.ts

function parseWebFetch(text: string): Partial<PiNotice> | null {
  const ready = text.match(/^Content fetched for (\d+)\/(\d+) URLs \[([^\]]*)\]\.\s*([\s\S]*)$/);
  if (ready) {
    return {
      kind: "web_fetch",
      variant: "ready",
      status: "completed",
      fetched: { done: Number(ready[1]), total: Number(ready[2]) },
      fetchId: ready[3] || undefined,
      body: ready[4]?.trim() ?? "",
    };
  }
  const failed = text.match(/^Content fetch failed \[([^\]]*)\]:\s*([\s\S]*)$/);
  if (failed) {
    return {
      kind: "web_fetch",
      variant: "error",
      status: "failed",
      fetchId: failed[1] || undefined,
      error: failed[2]?.trim(),
      body: "",
    };
  }
  return null;
}

// ── 8. Pi 自己从不显示的两条（display: false）────────────────────────
// Paseo 的 history-mapper 不看 display，所以它们照样进时间线。

const MODEL_ONLY: Array<{ variant: string; match: (text: string) => boolean }> = [
  {
    variant: "goal_contract",
    match: (text) =>
      text.startsWith("This Goal contract supersedes every earlier goal-contract message.") ||
      text.startsWith("Goal mode is inactive."),
  },
  {
    variant: "compaction_resume",
    match: (text) => text.startsWith("Compaction is complete. Resume the parent task now;"),
  },
];

function parseModelOnly(text: string): Partial<PiNotice> | null {
  for (const { variant, match } of MODEL_ONLY) {
    if (match(text)) return { kind: "model_only", variant, body: text };
  }
  return null;
}

// ── 入口 ────────────────────────────────────────────────────────────

const PARSERS = [
  parseBackgroundTask,
  parseSingleCompletion,
  parseGroupedCompletion,
  parseSupervisor,
  parseControlNotice,
  parseWaitSubscription,
  parseWebFetch,
  parseModelOnly,
];

/**
 * 从一条被拍平的助手消息里认出 Pi 的通知。
 *
 * 认不出来返回 `null` —— 那就是一条普通的助手消息，不该被我们接管。
 */
export function parsePiNoticeText(text: string): PiNotice | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const parse of PARSERS) {
    const partial = parse(trimmed);
    if (!partial) continue;
    const parsed = PiNoticeSchema.safeParse({ entries: [], facts: [], body: "", ...partial });
    if (parsed.success) return parsed.data;
  }
  return null;
}

/** 时间线条目 → 通知。只认助手消息，别的形态一律放过。 */
export function parsePiNoticeTimelineItem(value: unknown): PiNotice | null {
  const item = record(value);
  if (!item || item.type !== "assistant_message") return null;
  const text = typeof item.text === "string" ? item.text : null;
  return text ? parsePiNoticeText(text) : null;
}
