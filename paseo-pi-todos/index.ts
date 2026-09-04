import type { PluginContext, PluginTimelineData } from "@getpaseo/plugin";
import { latestTodoRpc, localeRpc, PiNoticeSchema, setLocaleRpc, SubagentCallSchema, subagentCallsRpc, TodoBoardSchema } from "./domain/contracts.shared";
import { contributeSubagentPills, PiSubagentsPanel, SubagentTimelineCard } from "./ui/subagents.client";
import { parseSubagentTimelineItem } from "./domain/subagent-parser.shared";
import { parsePiNoticeTimelineItem } from "./domain/pi-notice-parser.shared";
import { PiNoticeTimelineCard } from "./ui/pi-notice.client";
import { listSubagentCalls } from "./server/subagents.server";
import { contributeTodoPills, TodoTimelineCard } from "./ui/todo.client";
import { parseTodoTimelineItem } from "./domain/todo-parser.shared";
import { getLatestTodo } from "./server/todo.server";
import { getLocale, setLocale } from "./server/locale.server";
import { resolveLocale } from "./domain/locale.shared";
import { translator } from "./domain/i18n.shared";

function timelineData(value: unknown): PluginTimelineData {
  return JSON.parse(JSON.stringify(value)) as PluginTimelineData;
}

export default function contribute(plugin: PluginContext) {
  // 注册时刻只有宿主机环境可判 —— 没有客户端可问。面板内部走完整判定链
  const t = translator(resolveLocale({ env: process.env, envKey: "PI_TODOS_LANG" }));

  plugin.handle(latestTodoRpc, getLatestTodo);
  plugin.handle(subagentCallsRpc, listSubagentCalls);
  plugin.handle(localeRpc, getLocale);
  plugin.handle(setLocaleRpc, setLocale);

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

  // ⚠️ Pi 的 custom_message 被 Paseo 的 pi/history-mapper 拍平成了普通助手消息
  // （details 丢掉，只剩 content 文本），所以只能从 assistant_message 里反解。
  // 详见 domain/pi-notice-parser.shared.ts 的模块注释。
  plugin.addTimelineTransformer({
    id: "pi-notice-card",
    query: { itemType: "assistant_message" },
    transform({ item }) {
      const notice = parsePiNoticeTimelineItem(item);
      if (!notice) return;
      return {
        items: [{ type: "plugin", kind: "pi-notice", version: 1, data: timelineData(notice) }],
      };
    },
  });

  plugin.addTimelineRenderer({
    kind: "pi-notice",
    version: 1,
    schema: PiNoticeSchema,
    Component: PiNoticeTimelineCard,
  });

  plugin.addWorkspacePanel({
    id: "pi-subagents",
    title: t.panel_subagents,
    icon: "Network",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: PiSubagentsPanel,
  });
  plugin.addCommandCenterItem({
    id: "open-pi-subagents",
    title: t.nav_open_subagents,
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
