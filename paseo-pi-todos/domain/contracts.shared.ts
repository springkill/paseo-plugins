import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";
import { LOCALES } from "./locale.shared";

export const LocaleSchema = z.enum(LOCALES);
export const LocalePreferenceSchema = z.enum(["auto", ...LOCALES]);

/**
 * 界面语言。**三个 Paseo 插件共用同一个设置**，所以这个 RPC 读写的是
 * `$PASEO_HOME/plugin-locale.json`，不是本插件私有的状态。
 */
export const localeRpc = defineRpc({
  name: "pi-todos.locale",
  input: z.object({ clientLocale: z.string().max(35).optional() }),
  output: z.object({
    preference: LocalePreferenceSchema,
    resolved: LocaleSchema,
    lockedByEnv: z.boolean(),
  }),
});

export const setLocaleRpc = defineRpc({
  name: "pi-todos.set-locale",
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
 * Pi 的通知类消息（后台任务 / workflow / subagent 督导 / 需要关注 / 网页抓取）。
 *
 * ⚠️ 这些在 Paseo 里被拍平成了普通助手消息（`details` 被丢掉），所以字段是
 * 从文本反解出来的。取不到的留空 —— 少一个字段不该让整张卡片退回裸文本。
 */
export const PiNoticeSchema = z.object({
  kind: z.enum(["background_task", "workflow", "supervisor", "attention", "web_search"]),
  /** `need_decision` / `progress_update` 之类的子形态。 */
  variant: z.string().optional(),
  status: z.enum(["completed", "failed", "stopped", "running", "attention"]).optional(),
  taskId: z.string().max(200).optional(),
  taskName: z.string().max(300).optional(),
  exitCode: z.number().int().optional(),
  outputFile: z.string().max(1000).optional(),
  runId: z.string().max(200).optional(),
  agent: z.string().max(200).optional(),
  childIndex: z.number().int().nonnegative().optional(),
  /** 有它就说明这条在等你回话。 */
  replyTo: z.string().max(200).optional(),
  signal: z.string().max(1000).optional(),
  hint: z.string().max(2000).optional(),
  fetched: z.object({ done: z.number().int(), total: z.number().int() }).optional(),
  childRuns: z.array(z.object({
    key: z.string().max(200),
    runId: z.string().max(200).optional(),
    status: z.string().max(60).optional(),
  })).max(50).default([]),
  body: z.string().max(20000).default(""),
});

export type PiNotice = z.output<typeof PiNoticeSchema>;

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
  name: "pi-todos.latest",
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
  name: "pi-subagents.list",
  input: z.object({ agentId: z.string().min(1).max(256) }),
  output: z.object({ calls: z.array(SubagentCallSchema).max(40) }),
});

export type TodoTask = z.output<typeof TodoTaskSchema>;
export type TodoBoard = z.output<typeof TodoBoardSchema>;
export type SubagentCall = z.output<typeof SubagentCallSchema>;
export type SubagentChild = z.output<typeof SubagentChildSchema>;
