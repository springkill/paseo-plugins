/**
 * Pi Kit —— 四个功能装在一个插件里，各自可开关。
 *
 * ## 门控分两层，因为 SDK 只允许这样
 *
 * `addWorkspacePanel` / `addCommandCenterItem` / `addTimelineTransformer` 全都
 * 返回 `void`，**没有注销句柄**（只有 client 侧 `addComposerPill` 有）。
 * 而插件**不能自己重载自己**（实测会停在 failed，见 server/features.server.ts）。
 *
 * 所以：
 *
 * 1. **调用期门控 —— 立即生效。** transformer 永远注册，但在 `transform()` 里
 *    读开关，关掉就返回 `undefined`，条目原样落回默认渲染。时间线卡片是用户
 *    最常看的一层，这层必须即时。
 * 2. **加载期门控 —— 下次重载生效。** 面板、命令面板项、composer pill、RPC
 *    handler 只能在注册时决定，关掉的就不注册。
 *
 * 设置相关的 RPC 与面板**永远注册** —— 否则全关之后就再也打不开设置了。
 */

import type { PluginContext } from "@getpaseo/plugin";
import {
  featuresRpc,
  latestTodoRpc,
  localeRpc,
  PiNoticeSchema,
  providerUsageRpc,
  setFeatureRpc,
  setLocaleRpc,
  SubagentCallSchema,
  subagentCallsRpc,
  TodoBoardSchema,
} from "./domain/contracts.shared";
import { translator } from "./domain/i18n.shared";
import { resolveLocale } from "./domain/locale.shared";
import { parsePiNoticeTimelineItem } from "./domain/pi-notice-parser.shared";
import { parseSubagentTimelineItem } from "./domain/subagent-parser.shared";
import { parseTodoTimelineItem } from "./domain/todo-parser.shared";
import { getFeatures, readFlags, setFeature } from "./server/features.server";
import { getLocale, setLocale } from "./server/locale.server";
import { closeProviderUsageClient, listProviderUsage } from "./server/provider-usage.server";
import { listSubagentCalls } from "./server/subagents.server";
import { getLatestTodo } from "./server/todo.server";
import { PiNoticeTimelineCard } from "./ui/pi-notice.client";
import { contributeProviderUsagePills } from "./ui/usage-pill.client";
import { PiKitSettingsPanel } from "./ui/settings.client";
import { contributeSubagentPills, PiSubagentsPanel, SubagentTimelineCard } from "./ui/subagents.client";
import { contributeTodoPills, TodoTimelineCard } from "./ui/todo.client";
import type { PluginTimelineData } from "@getpaseo/plugin";

function timelineData(value: unknown): PluginTimelineData {
  return value as PluginTimelineData;
}

export default function contribute(plugin: PluginContext) {
  const flags = readFlags();
  // 注册时刻只有宿主机环境可判 —— 没有客户端可问。面板内部走完整判定链
  const t = translator(resolveLocale({ env: process.env, envKey: "PI_KIT_LANG" }));

  // ── 永远可用：语言与功能开关本身 ──────────────────────────────
  plugin.handle(localeRpc, getLocale);
  plugin.handle(setLocaleRpc, setLocale);
  plugin.handle(featuresRpc, () => getFeatures());
  plugin.handle(setFeatureRpc, (input) => setFeature(input));

  plugin.addWorkspacePanel({
    id: "pi-kit-settings",
    title: t.settings_panel,
    icon: "SlidersHorizontal",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: PiKitSettingsPanel,
  });
  plugin.addCommandCenterItem({
    id: "open-pi-kit-settings",
    title: t.settings_open,
    icon: "SlidersHorizontal",
    keywords: ["pi", "kit", "settings", "features", "设置", "开关"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("pi-kit-settings");
    },
  });

  // ── todos ────────────────────────────────────────────────────────
  if (flags.todos) plugin.handle(latestTodoRpc, getLatestTodo);
  // Pi 的 todo 工具调用
  plugin.addTimelineTransformer({
    id: "pi-todo-tool-card",
    query: { itemType: "tool_call" },
    transform({ item }) {
      if (!readFlags().todos) return;
      const board = parseTodoTimelineItem(item);
      if (!board) return;
      return { items: [{ type: "plugin", kind: "pi-todo-board", version: 1, data: timelineData(board) }] };
    },
  });
  // Paseo 原生 todo 条目
  plugin.addTimelineTransformer({
    id: "native-todo-card",
    query: { itemType: "todo" },
    transform({ item }) {
      if (!readFlags().todos) return;
      const board = parseTodoTimelineItem(item);
      if (!board) return;
      return { items: [{ type: "plugin", kind: "pi-todo-board", version: 1, data: timelineData(board) }] };
    },
  });
  plugin.addTimelineRenderer({
    kind: "pi-todo-board",
    version: 1,
    schema: TodoBoardSchema,
    Component: TodoTimelineCard,
  });

  // ── subagents ────────────────────────────────────────────────────
  plugin.addTimelineTransformer({
    id: "pi-subagent-card",
    query: { itemType: "tool_call" },
    transform({ item }) {
      if (!readFlags().subagents) return;
      const call = parseSubagentTimelineItem(item);
      if (!call) return;
      return { items: [{ type: "plugin", kind: "pi-subagent-card", version: 1, data: timelineData(call) }] };
    },
  });
  plugin.addTimelineRenderer({
    kind: "pi-subagent-card",
    version: 1,
    schema: SubagentCallSchema,
    Component: SubagentTimelineCard,
  });
  // ⚠️ 面板与命令项只能在这里决定 —— 注册了就摘不掉
  if (flags.subagents) {
    plugin.handle(subagentCallsRpc, listSubagentCalls);
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
  }

  // ── notices ──────────────────────────────────────────────────────
  // ⚠️ Pi 的 custom_message 被 Paseo 的 pi/history-mapper 拍平成了普通助手消息
  // （details 丢掉，只剩 content 文本），所以只能从 assistant_message 里反解。
  // 详见 domain/pi-notice-parser.shared.ts 与 docs/pi-message-formats.md。
  plugin.addTimelineTransformer({
    id: "pi-notice-card",
    query: { itemType: "assistant_message" },
    transform({ item }) {
      if (!readFlags().notices) return;
      const notice = parsePiNoticeTimelineItem(item);
      if (!notice) return;
      return { items: [{ type: "plugin", kind: "pi-notice", version: 1, data: timelineData(notice) }] };
    },
  });
  plugin.addTimelineRenderer({
    kind: "pi-notice",
    version: 1,
    schema: PiNoticeSchema,
    Component: PiNoticeTimelineCard,
  });

  // ── balances ─────────────────────────────────────────────────────
  if (flags.balances) {
    plugin.handle(providerUsageRpc, listProviderUsage);
  }

  // ── 客户端侧（composer pill）─────────────────────────────────────
  // pill 在**客户端**注册，那边读不到服务端的开关文件，所以只能加载期决定。
  plugin.addClientSide((client) => {
    const cleanups = [
      flags.todos ? contributeTodoPills(client) : null,
      flags.subagents ? contributeSubagentPills(client) : null,
      flags.balances ? contributeProviderUsagePills(client) : null,
    ].filter((cleanup): cleanup is () => void => cleanup !== null);
    return () => {
      for (const cleanup of cleanups.reverse()) cleanup();
    };
  });

  return () => {
    if (flags.balances) closeProviderUsageClient();
  };
}
