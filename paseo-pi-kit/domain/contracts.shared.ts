import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";
import { LOCALES } from "./locale.shared";

export const LocaleSchema = z.enum(LOCALES);
export const LocalePreferenceSchema = z.enum(["auto", ...LOCALES]);

/**
 * 界面语言。**本插件与 paseo-rumen 共用同一个设置**，所以这个 RPC 读写的是
 * `$PASEO_HOME/plugin-locale.json`，不是本插件私有的状态。
 */
export const localeRpc = defineRpc({
  name: "pi-kit.locale",
  input: z.object({ clientLocale: z.string().max(35).optional() }),
  output: z.object({
    preference: LocalePreferenceSchema,
    resolved: LocaleSchema,
    lockedByEnv: z.boolean(),
  }),
});

export const setLocaleRpc = defineRpc({
  name: "pi-kit.set-locale",
  input: z.object({
    preference: LocalePreferenceSchema,
    clientLocale: z.string().max(35).optional(),
  }),
  output: z.object({
    preference: LocalePreferenceSchema,
    resolved: LocaleSchema,
    lockedByEnv: z.boolean(),
  }),
});

/**
 * Pi 的通知类消息。
 *
 * 字段按 `docs/pi-message-formats.md` 那张对照表来 —— 那是从已装 Pi 插件的源码里
 * 逐条抠出来的，每个字段都能对上某个 `format*()` 函数的某个输出位。
 *
 * ⚠️ 这些消息在 Paseo 里被拍平成了普通助手消息（`details` 被丢掉），所以只能从文本反解。
 * 取不到的留空 —— 少一个字段不该让整张卡片退回裸文本。
 */
export const NoticeStatusSchema = z.enum([
  "completed", "failed", "paused", "stopped", "running", "attention", "timed_out", "unresolved",
]);

/** `Child outputs:` 区块里的一项。 */
export const ChildOutputSchema = z.object({
  key: z.string().max(200).optional(),
  runId: z.string().max(200).optional(),
  status: z.string().max(60).optional(),
  savedOutputPath: z.string().max(1000).optional(),
  preview: z.string().max(8000).optional(),
  /** 没有预览时 Pi 给的原因，如 `saved output is file-only`。 */
  previewUnavailable: z.string().max(300).optional(),
});

/** `Child runs:` 那一行里的一项（只有相关性元信息，没有输出）。 */
export const ChildRunSchema = z.object({
  key: z.string().max(200).optional(),
  /** Pi 拿不到时会写字面量 `unavailable`，那种情况这里留空。 */
  runId: z.string().max(200).optional(),
  status: z.string().max(60).optional(),
});

/** workflow 摘要行拆出来的东西。 */
export const WorkflowSummarySchema = z.object({
  childCount: z.number().int().nonnegative().optional(),
  traceEvents: z.number().int().nonnegative().optional(),
  /** `Output path mappings:` 与 preflight 告警。 */
  notes: z.array(z.string().max(600)).max(20).default([]),
  /** true = 丢掉了 `Return:` 那段被 Pi 截断到 1000 字符的预览。 */
  returnTruncated: z.boolean().optional(),
});

/**
 * 一次子任务完成。单条通知有一项，合批通知有多项 —— 两者共用这个形状，
 * 因为 `formatGroupedCompletion` 每一节复用的就是 `formatSingleCompletion` 的零件。
 */
export const CompletionEntrySchema = z.object({
  agent: z.string().max(200),
  /** 头部 `**agent**` 后面那个 `(…)`。 */
  taskInfo: z.string().max(400).optional(),
  status: NoticeStatusSchema.optional(),
  /** 正文，已剥掉 `Child outputs:` 区块和各元信息行。 */
  summary: z.string().max(20000).default(""),
  workflow: WorkflowSummarySchema.optional(),
  childOutputs: z.array(ChildOutputSchema).max(50).default([]),
  /** 超出 notice 预算、被 Pi 省掉预览的子任务数。 */
  omittedPreviews: z.number().int().nonnegative().optional(),
  childRuns: z.array(ChildRunSchema).max(100).default([]),
  workflowRunId: z.string().max(200).optional(),
  handoffPath: z.string().max(1000).optional(),
  reconciled: z.string().max(200).optional(),
  schedule: z.object({
    id: z.string().max(200),
    name: z.string().max(200).optional(),
  }).optional(),
  session: z.object({
    label: z.string().max(80),
    value: z.string().max(1000),
  }).optional(),
});

export const PiNoticeSchema = z.object({
  kind: z.enum([
    "background_task",  // <background-task-notification>
    "completion",       // subagent-notify（单条 + 合批）
    "supervisor",       // subagent_supervisor_request
    "control",          // subagent_control_notice
    "wait",             // subagent-wait-subscription
    "web_fetch",        // web-search-content-ready / web-search-error
    "model_only",       // goal-contract / subagent-compaction-resume（Pi 自己从不显示）
  ]),
  /** 同一 kind 下的子形态，取值见 docs/pi-message-formats.md。 */
  variant: z.string().max(60).optional(),
  status: NoticeStatusSchema.optional(),

  // ── background_task ──
  taskId: z.string().max(200).optional(),
  taskName: z.string().max(300).optional(),
  exitCode: z.number().int().optional(),
  error: z.string().max(4000).optional(),
  outputFile: z.string().max(1000).optional(),

  // ── completion ──
  entries: z.array(CompletionEntrySchema).max(20).default([]),

  // ── supervisor / control ──
  runId: z.string().max(200).optional(),
  agent: z.string().max(200).optional(),
  childIndex: z.number().int().nonnegative().optional(),
  /** 运行内的步序，来自 `Run: <id> step N`。 */
  step: z.number().int().positive().optional(),
  /** 有它就说明这条在等你回话。 */
  replyTo: z.string().max(200).optional(),
  signal: z.string().max(2000).optional(),
  facts: z.array(z.string().max(200)).max(12).default([]),
  recentFailures: z.string().max(2000).optional(),

  // ── wait ──
  token: z.string().max(200).optional(),
  outcome: z.string().max(120).optional(),

  // ── web_fetch ──
  fetched: z.object({ done: z.number().int(), total: z.number().int() }).optional(),
  fetchId: z.string().max(200).optional(),

  body: z.string().max(20000).default(""),
});

export type PiNotice = z.output<typeof PiNoticeSchema>;
export type PiCompletionEntry = z.output<typeof CompletionEntrySchema>;
export type PiChildOutput = z.output<typeof ChildOutputSchema>;

export const TaskStatusSchema = z.enum(["pending", "in_progress", "completed", "deleted"]);

export const TodoTaskSchema = z.object({
  id: z.union([z.number(), z.string()]),
  subject: z.string(),
  status: TaskStatusSchema,
  description: z.string().optional(),
  activeForm: z.string().optional(),
  blockedBy: z.array(z.number()).optional(),
});

export const TodoBoardSchema = z.object({
  action: z.string(),
  changedId: z.union([z.number(), z.string()]).optional(),
  tasks: z.array(TodoTaskSchema).max(200),
});

export const latestTodoRpc = defineRpc({
  name: "pi-kit.latest",
  input: z.object({ agentId: z.string().min(1).max(256) }),
  output: z.object({ board: TodoBoardSchema.nullable() }),
});

export const SubagentStatusSchema = z.enum(["running", "completed", "failed", "canceled"]);

export const SubagentChildSchema = z.object({
  index: z.number().int().nonnegative(),
  agent: z.string(),
  model: z.string().optional(),
  status: SubagentStatusSchema,
  context: z.string().optional(),
  finalOutput: z.string().optional(),
  toolCount: z.number().int().nonnegative().optional(),
  tokens: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  turns: z.number().int().nonnegative().optional(),
  acceptance: z.string().optional(),
  residualRisks: z.array(z.string()).optional(),
});

export const SubagentCallSchema = z.object({
  callId: z.string(),
  status: SubagentStatusSchema,
  subAgentType: z.string().optional(),
  description: z.string().optional(),
  log: z.string(),
  timestamp: z.string().optional(),
  mode: z.string().optional(),
  runId: z.string().optional(),
  missionId: z.string().optional(),
  missionStatus: z.string().optional(),
  children: z.array(SubagentChildSchema),
});

export const subagentCallsRpc = defineRpc({
  name: "pi-kit.subagents",
  input: z.object({ agentId: z.string().min(1).max(256) }),
  output: z.object({ calls: z.array(SubagentCallSchema).max(40) }),
});

export type TodoTask = z.output<typeof TodoTaskSchema>;
export type TodoBoard = z.output<typeof TodoBoardSchema>;
export type SubagentCall = z.output<typeof SubagentCallSchema>;
export type SubagentChild = z.output<typeof SubagentChildSchema>;

// ── provider 用量 / 余额 ──────────────────────────────────────────

const ToneSchema = z.enum(["default", "ok", "warning", "danger"]);

const UsageWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  usedPct: z.number().nullable().optional(),
  remainingPct: z.number().nullable().optional(),
  resetsAt: z.string().nullable().optional(),
  runsOutAt: z.string().nullable().optional(),
  shortfallPct: z.number().nullable().optional(),
  tone: ToneSchema.optional(),
});

const BalanceSchema = z.object({
  id: z.string(),
  label: z.string(),
  used: z.number().nullable().optional(),
  remaining: z.number().nullable().optional(),
  limit: z.number().nullable().optional(),
  unit: z.enum(["tokens", "usd", "credits", "requests"]),
  resetsAt: z.string().nullable().optional(),
  tone: ToneSchema.optional(),
});

const DetailSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  tone: ToneSchema.optional(),
});

export const providerUsageRpc = defineRpc({
  name: "pi-kit.provider-usage",
  input: z.object({}),
  output: z.object({
    fetchedAt: z.string(),
    providers: z.array(
      z.object({
        providerId: z.string(),
        displayName: z.string(),
        status: z.enum(["available", "unavailable", "error"]),
        planLabel: z.string().nullable(),
        sourceLabel: z.string().nullable().optional(),
        fetchedAt: z.string().nullable().optional(),
        nextRefreshAt: z.string().nullable().optional(),
        windows: z.array(UsageWindowSchema),
        balances: z.array(BalanceSchema).optional(),
        details: z.array(DetailSchema).optional(),
        error: z.string().nullable().optional(),
      }),
    ),
  }),
});
