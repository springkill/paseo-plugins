import type { PluginHandlerContext } from "@getpaseo/plugin";
import type { output as ZodOutput } from "zod";
import { latestTodoRpc } from "./contracts.shared";
import { parseTodoTimelineItem } from "./todo-parser.shared";

export async function getLatestTodo(
  { agentId }: ZodOutput<typeof latestTodoRpc.input>,
  { paseo }: PluginHandlerContext,
): Promise<ZodOutput<typeof latestTodoRpc.output>> {
  const page = await paseo.agents.ref(agentId).timeline.refetch({
    direction: "tail",
    limit: 500,
    projection: "canonical",
  });
  for (let index = page.entries.length - 1; index >= 0; index -= 1) {
    const board = parseTodoTimelineItem(page.entries[index]?.item);
    if (board) return { board };
  }
  return { board: null };
}
