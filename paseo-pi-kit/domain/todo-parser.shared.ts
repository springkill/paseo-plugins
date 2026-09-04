import { TodoBoardSchema, type TodoBoard, type TodoTask } from "./contracts.shared";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeStatus(value: unknown, completed?: unknown): TodoTask["status"] {
  if (value === "pending" || value === "in_progress" || value === "completed" || value === "deleted") return value;
  return completed === true ? "completed" : "pending";
}

function normalizeTasks(value: unknown): TodoTask[] | null {
  if (!Array.isArray(value)) return null;
  const tasks: TodoTask[] = [];
  for (let index = 0; index < Math.min(value.length, 200); index += 1) {
    const raw = record(value[index]);
    if (!raw) continue;
    const subject = text(raw.subject) ?? text(raw.text);
    if (!subject) continue;
    const blockedBy = Array.isArray(raw.blockedBy)
      ? raw.blockedBy.filter((id): id is number => Number.isInteger(id))
      : undefined;
    tasks.push({
      id: typeof raw.id === "number" || typeof raw.id === "string" ? raw.id : index + 1,
      subject,
      status: normalizeStatus(raw.status, raw.completed),
      description: text(raw.description),
      activeForm: text(raw.activeForm),
      blockedBy: blockedBy?.length ? blockedBy : undefined,
    });
  }
  return tasks;
}

export function parseTodoTimelineItem(value: unknown): TodoBoard | null {
  const item = record(value);
  if (!item) return null;

  if (item.type === "todo") {
    const tasks = normalizeTasks(item.items);
    return tasks ? { action: "snapshot", tasks } : null;
  }

  if (item.type !== "tool_call" || item.name !== "todo" || item.status !== "completed") return null;
  const detail = record(item.detail);
  const output = record(detail?.output);
  const details = record(output?.details);
  const tasks = normalizeTasks(details?.tasks);
  if (!tasks) return null;
  const input = record(detail?.input);
  const params = record(details?.params);
  const action = text(details?.action) ?? text(input?.action) ?? "update";
  const changed = params?.id ?? input?.id;
  const candidate = {
    action,
    changedId: typeof changed === "number" || typeof changed === "string" ? changed : undefined,
    tasks,
  };
  const parsed = TodoBoardSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
