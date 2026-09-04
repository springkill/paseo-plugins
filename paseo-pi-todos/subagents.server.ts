import type { PluginHandlerContext } from "@getpaseo/plugin";
import { open, readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, sep } from "node:path";
import type { output as ZodOutput } from "zod";
import { subagentCallsRpc, type SubagentCall, type SubagentChild } from "./contracts.shared";
import { parseSubagentTimelineItem } from "./subagent-parser.shared";

const MAX_SESSION_TAIL = 16 * 1024 * 1024;
const MAX_STATUS_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 24_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.length <= max ? value : `${value.slice(0, max)}\n…内容已截断…`;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function status(value: unknown): SubagentChild["status"] {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (["complete", "completed", "success", "succeeded"].includes(normalized)) return "completed";
  if (["failed", "error", "errored"].includes(normalized)) return "failed";
  if (["canceled", "cancelled", "stopped", "interrupted", "killed"].includes(normalized)) return "canceled";
  return "running";
}

function residualRisks(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const risks = value.map((item) => text(item, 1_000)).filter((item): item is string => Boolean(item));
  return risks.length ? risks : undefined;
}

function childFromResult(value: unknown, fallbackIndex: number): SubagentChild | null {
  const result = record(value);
  if (!result) return null;
  const acceptance = record(result.acceptance);
  const childReport = record(acceptance?.childReport);
  const usage = record(result.usage);
  const progress = record(result.progressSummary);
  const exitCode = typeof result.exitCode === "number" ? result.exitCode : undefined;
  const inputTokens = number(usage?.input);
  const outputTokens = number(usage?.output);
  const tokens = number(progress?.tokens)
    ?? (inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined);
  return {
    index: typeof result.index === "number" && Number.isInteger(result.index) ? result.index : fallbackIndex,
    agent: text(result.agent, 200) ?? `child-${fallbackIndex + 1}`,
    model: text(result.model, 300),
    status: exitCode === 0 ? "completed" : result.isError === true || (exitCode !== undefined && exitCode !== 0) ? "failed" : status(result.status),
    context: text(result.context, 100),
    finalOutput: text(result.finalOutput),
    toolCount: number(progress?.toolCount),
    tokens,
    durationMs: number(progress?.durationMs),
    costUsd: number(usage?.cost),
    turns: number(usage?.turns),
    acceptance: text(acceptance?.status, 100),
    residualRisks: residualRisks(childReport?.residualRisks),
  };
}

export function childFromLiveStep(value: unknown, index: number, now = Date.now()): SubagentChild | null {
  const step = record(value);
  if (!step) return null;
  const tokensValue = record(step.tokens);
  const totalCost = record(step.totalCost);
  const toolBudget = record(step.toolBudget);
  const acceptance = record(step.acceptance);
  const childReport = record(acceptance?.childReport);
  const startedAt = number(step.startedAt);
  const endedAt = number(step.endedAt);
  const durationMs = number(step.durationMs)
    ?? (startedAt === undefined ? undefined : Math.max(0, (endedAt ?? now) - startedAt));
  const recentOutput = Array.isArray(step.recentOutput)
    ? step.recentOutput.map((line) => text(line, 2_000)).filter((line): line is string => Boolean(line)).join("\n")
    : undefined;
  return {
    index,
    agent: text(step.agent, 200) ?? text(step.label, 200) ?? `child-${index + 1}`,
    model: text(step.model, 300),
    status: status(step.status),
    context: text(step.context, 100),
    finalOutput: status(step.status) === "running" ? undefined : text(recentOutput),
    toolCount: number(step.toolCount) ?? number(toolBudget?.toolCount),
    tokens: number(step.totalTokens) ?? number(tokensValue?.total),
    durationMs,
    costUsd: number(totalCost?.costUsd),
    turns: number(step.turnCount),
    acceptance: text(acceptance?.status, 100),
    residualRisks: residualRisks(childReport?.residualRisks),
  };
}

interface SessionSubagentRecord {
  callId: string;
  timestamp?: string;
  arguments?: Record<string, unknown>;
  details?: Record<string, unknown>;
  resultText?: string;
}

function resultText(message: Record<string, unknown>): string | undefined {
  if (!Array.isArray(message.content)) return undefined;
  return message.content.map((item) => text(record(item)?.text, 8_000)).filter((item): item is string => Boolean(item)).join("\n") || undefined;
}

async function readSessionSubagents(nativeHandle: string): Promise<Map<string, SessionSubagentRecord>> {
  const home = process.env.HOME;
  if (!home || !isAbsolute(nativeHandle)) return new Map();
  let canonical: string;
  try {
    canonical = await realpath(nativeHandle);
  } catch {
    return new Map();
  }
  const allowed = `${home}/.pi/agent/sessions/`;
  if (!canonical.startsWith(allowed)) throw new Error("Pi session path is outside the allowed sessions directory");
  const info = await stat(canonical);
  const size = Math.min(info.size, MAX_SESSION_TAIL);
  const start = Math.max(0, info.size - size);
  const handle = await open(canonical, "r");
  try {
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, start);
    let content = buffer.toString("utf8");
    if (start > 0) content = content.slice(content.indexOf("\n") + 1);
    const calls = new Map<string, SessionSubagentRecord>();
    for (const line of content.split("\n")) {
      if (!line.includes('"subagent"')) continue;
      try {
        const event = record(JSON.parse(line));
        const message = record(event?.message);
        if (!message) continue;
        const timestamp = text(event?.timestamp, 100);
        if (message.role === "assistant" && Array.isArray(message.content)) {
          for (const raw of message.content) {
            const call = record(raw);
            if (call?.type !== "toolCall" || call.name !== "subagent") continue;
            const callId = text(call.id, 512);
            if (!callId) continue;
            calls.set(callId, {
              ...(calls.get(callId) ?? { callId }),
              timestamp,
              arguments: record(call.arguments) ?? undefined,
            });
          }
        }
        if (message.role === "toolResult" && message.toolName === "subagent") {
          const callId = text(message.toolCallId, 512);
          if (!callId) continue;
          calls.set(callId, {
            ...(calls.get(callId) ?? { callId }),
            timestamp: calls.get(callId)?.timestamp ?? timestamp,
            details: record(message.details) ?? undefined,
            resultText: resultText(message),
          });
        }
      } catch {
        // Ignore a truncated leading line or malformed historical record.
      }
    }
    return calls;
  } finally {
    await handle.close();
  }
}

function asyncRoot(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  return join(tmpdir(), `pi-subagents-uid-${uid ?? "unknown"}`, "async-subagent-runs");
}

async function readLiveStatus(details: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const runId = text(details.runId, 256) ?? text(details.asyncId, 256);
  const directory = text(details.asyncDir, 4_096);
  if (!runId || !directory || !isAbsolute(directory) || basename(directory) !== runId) return null;
  try {
    const [canonicalRoot, canonicalDir] = await Promise.all([realpath(asyncRoot()), realpath(directory)]);
    if (canonicalDir !== join(canonicalRoot, runId) || !canonicalDir.startsWith(`${canonicalRoot}${sep}`)) return null;
    const path = join(canonicalDir, "status.json");
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_STATUS_BYTES) return null;
    return record(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

function placeholderChildren(invocation: SessionSubagentRecord): SubagentChild[] {
  const args = invocation.arguments;
  if (!args) return [];
  const directAgent = text(args.agent, 200);
  if (directAgent) return [{ index: 0, agent: directAgent, status: "running", context: text(args.context, 100) }];
  const preflight = record(args.preflight);
  if (!Array.isArray(preflight?.lanes)) return [];
  return preflight.lanes.slice(0, 64).map((raw, index) => {
    const lane = record(raw);
    return { index, agent: text(lane?.key, 200) ?? `lane-${index + 1}`, status: "running" as const };
  });
}

function callDescription(invocation: SessionSubagentRecord): string | undefined {
  const args = invocation.arguments;
  if (!args) return undefined;
  return text(args.task, 500)
    ?? text(args.name, 500)
    ?? (record(args.preflight) && Array.isArray(record(args.preflight)?.lanes)
      ? `${(record(args.preflight)?.lanes as unknown[]).length} planned lanes`
      : undefined);
}

function isManagement(invocation: SessionSubagentRecord): boolean {
  return Boolean(text(invocation.arguments?.action, 100)) || invocation.details?.mode === "management";
}

async function enrichCall(base: SubagentCall | undefined, invocation: SessionSubagentRecord): Promise<SubagentCall | null> {
  if (isManagement(invocation)) return null;
  const details = invocation.details;
  const rawResults = Array.isArray(details?.results) ? details.results : [];
  const resultChildren = rawResults.map((value, index) => childFromResult(value, index)).filter((child): child is SubagentChild => child !== null);
  const live = details ? await readLiveStatus(details) : null;
  const liveSteps = Array.isArray(live?.steps) ? live.steps : [];
  const liveChildren = liveSteps.map((value, index) => childFromLiveStep(value, index)).filter((child): child is SubagentChild => child !== null);
  const workflowChildren = record(details?.workflowChildren);
  const inventory = Array.isArray(workflowChildren?.children) ? workflowChildren.children : [];
  const inventoryChildren = inventory.map((raw, index): SubagentChild | null => {
    const child = record(raw);
    if (!child) return null;
    return {
      index,
      agent: text(child.agent, 200) ?? text(child.childId, 200) ?? `child-${index + 1}`,
      model: text(child.model, 300),
      status: status(child.state),
    };
  }).filter((child): child is SubagentChild => child !== null);
  const children = resultChildren.length ? resultChildren : liveChildren.length ? liveChildren : inventoryChildren.length ? inventoryChildren : placeholderChildren(invocation);
  const runState = live?.state ?? workflowChildren?.workflowState;
  const hasDetachedRun = Boolean(text(details?.asyncDir, 4_096) && (text(details?.runId, 256) || text(details?.asyncId, 256)));
  const derivedStatus = runState === undefined
    ? (hasDetachedRun && resultChildren.length === 0
      ? "running"
      : details
        ? (resultChildren.some((child) => child.status === "failed") ? "failed" : "completed")
        : "running")
    : status(runState);
  const mission = record(details?.mission);
  return {
    callId: invocation.callId,
    status: derivedStatus,
    subAgentType: base?.subAgentType ?? text(invocation.arguments?.agent, 200),
    description: base?.description ?? callDescription(invocation),
    log: base?.log ?? text(invocation.resultText) ?? (derivedStatus === "running" ? "正在运行…" : "没有输出"),
    timestamp: base?.timestamp ?? invocation.timestamp,
    mode: text(details?.mode, 100) ?? (text(invocation.arguments?.agent, 200) ? "single" : invocation.arguments?.workflowScript ? "workflow" : undefined),
    runId: text(details?.runId, 256) ?? text(details?.asyncId, 256),
    missionId: text(details?.missionId, 256) ?? text(mission?.id, 256) ?? base?.missionId,
    missionStatus: text(mission?.status, 100) ?? base?.missionStatus,
    children,
  };
}

export async function listSubagentCalls(
  { agentId }: ZodOutput<typeof subagentCallsRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<ZodOutput<typeof subagentCallsRpc.output>> {
  const page = await paseo.agents.ref(agentId).timeline.refetch({
    direction: "tail",
    limit: 500,
    projection: "canonical",
  });
  if (page.agent?.id !== agentId || page.agent.provider !== "pi") return { calls: [] };

  const calls = new Map<string, SubagentCall>();
  for (const entry of page.entries) {
    const call = parseSubagentTimelineItem(entry.item);
    if (!call) continue;
    calls.set(call.callId, { ...call, timestamp: new Date(entry.timestamp).toISOString() });
  }

  const nativeHandle = page.agent.persistence?.nativeHandle;
  const sessionCalls = nativeHandle ? await readSessionSubagents(nativeHandle) : new Map<string, SessionSubagentRecord>();
  for (const [callId, invocation] of sessionCalls) {
    const enriched = await enrichCall(calls.get(callId), invocation);
    if (enriched) calls.set(callId, enriched);
    else calls.delete(callId);
  }

  return {
    calls: [...calls.values()]
      .sort((left, right) => (right.timestamp ?? "").localeCompare(left.timestamp ?? ""))
      .slice(0, 40),
  };
}
