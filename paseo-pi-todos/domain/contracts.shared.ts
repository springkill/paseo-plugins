import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

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
