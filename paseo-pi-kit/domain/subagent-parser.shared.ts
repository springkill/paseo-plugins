import { SubagentCallSchema, type SubagentCall } from "./contracts.shared";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function cleanSubagentLog(value: string): string {
  return value
    .replace(/```acceptance-report[\s\S]*?```/g, "")
    .replace(/^Run fan-out:[^\n]*\n?/m, "")
    .replace(/^Mission:[^\n]*\n?/m, "")
    .trim();
}

export function parseSubagentTimelineItem(value: unknown): SubagentCall | null {
  const item = record(value);
  if (!item || item.type !== "tool_call" || item.name !== "subagent") return null;
  const detail = record(item.detail);
  if (!detail || detail.type !== "sub_agent") return null;
  const rawStatus = item.status;
  const status = rawStatus === "completed" || rawStatus === "failed" || rawStatus === "canceled"
    ? rawStatus
    : "running";
  // ⚠️ 解析层不产生用户可见文案 —— 它是 .shared.ts，两端共用，没有 locale 可依。
  // 空字符串交给渲染层，由 t 决定说"启动中…"还是"没有输出"
  const log = string(detail.log) ?? "";
  const mission = log.match(/Mission:\s*([A-Za-z0-9-]+)\s*\(([^)]+)\)/);
  const candidate = {
    callId: string(item.callId) ?? "unknown",
    status,
    subAgentType: string(detail.subAgentType),
    description: string(detail.description),
    log: cleanSubagentLog(log),
    missionId: mission?.[1],
    missionStatus: mission?.[2],
    children: [],
  };
  const parsed = SubagentCallSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
