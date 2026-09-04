import type { PluginContext, PluginTimelineData } from "@getpaseo/plugin";
import { latestTodoRpc, SubagentCallSchema, subagentCallsRpc, TodoBoardSchema } from "./contracts.shared";
import { contributeSubagentPills, PiSubagentsPanel, SubagentTimelineCard } from "./subagents.client";
import { parseSubagentTimelineItem } from "./subagent-parser.shared";
import { listSubagentCalls } from "./subagents.server";
import { contributeTodoPills, TodoTimelineCard } from "./todo.client";
import { parseTodoTimelineItem } from "./todo-parser.shared";
import { getLatestTodo } from "./todo.server";

function timelineData(value: unknown): PluginTimelineData {
  return JSON.parse(JSON.stringify(value)) as PluginTimelineData;
}

export default function contribute(plugin: PluginContext) {
  plugin.handle(latestTodoRpc, getLatestTodo);
  plugin.handle(subagentCallsRpc, listSubagentCalls);

  plugin.addTimelineTransformer({
    id: "pi-todo-tool-card",
    query: { itemType: "tool_call" },
    transform({ item }) {
      const board = parseTodoTimelineItem(item);
      if (!board) return;
      return {
        items: [{ type: "plugin", kind: "pi-todo-board", version: 1, data: timelineData(board) }],
      };
    },
  });

  plugin.addTimelineTransformer({
    id: "native-todo-card",
    query: { itemType: "todo" },
    transform({ item }) {
      const board = parseTodoTimelineItem(item);
      if (!board) return;
      return {
        items: [{ type: "plugin", kind: "pi-todo-board", version: 1, data: timelineData(board) }],
      };
    },
  });

  plugin.addTimelineRenderer({
    kind: "pi-todo-board",
    version: 1,
    schema: TodoBoardSchema,
    Component: TodoTimelineCard,
  });

  plugin.addTimelineTransformer({
    id: "pi-subagent-card",
    query: { itemType: "tool_call" },
    transform({ item }) {
      const call = parseSubagentTimelineItem(item);
      if (!call) return;
      return {
        items: [{ type: "plugin", kind: "pi-subagent-card", version: 1, data: timelineData(call) }],
      };
    },
  });

  plugin.addTimelineRenderer({
    kind: "pi-subagent-card",
    version: 1,
    schema: SubagentCallSchema,
    Component: SubagentTimelineCard,
  });

  plugin.addWorkspacePanel({
    id: "pi-subagents",
    title: "Pi Subagents",
    icon: "Network",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: PiSubagentsPanel,
  });
  plugin.addCommandCenterItem({
    id: "open-pi-subagents",
    title: "Open Pi Subagents",
    icon: "Network",
    keywords: ["pi", "children", "workflow", "agents"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel("pi-subagents");
    },
  });

  plugin.addClientSide((client) => {
    const cleanupTodos = contributeTodoPills(client);
    const cleanupSubagents = contributeSubagentPills(client);
    return () => {
      cleanupSubagents();
      cleanupTodos();
    };
  });
  return () => {};
}
