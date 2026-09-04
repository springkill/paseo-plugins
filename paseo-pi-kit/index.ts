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
import type { Feature } from "./domain/features.shared";
import { translator } from "./domain/i18n.shared";
import { resolveLocale } from "./domain/locale.shared";
import { parsePiNoticeTimelineItem } from "./domain/pi-notice-parser.shared";
import { parseSubagentTimelineItem } from "./domain/subagent-parser.shared";
import { parseTodoTimelineItem } from "./domain/todo-parser.shared";
import { getFeatures, setFeature } from "./server/features.server";
import { getLocale, setLocale } from "./server/locale.server";
import { closeProviderUsageClient, listProviderUsage } from "./server/provider-usage.server";
import { listSubagentCalls } from "./server/subagents.server";
import { getLatestTodo } from "./server/todo.server";
import { PiNoticeTimelineCard } from "./ui/pi-notice.client";
import { contributeProviderUsagePills } from "./ui/usage-pill.client";
import { isFeatureEnabled, primeClientFlags, subscribeClientFlags } from "./ui/features.client";
import { GatedSubagentsPanel, PiKitSettingsPanel } from "./ui/settings.client";
import { contributeSubagentPills, SubagentTimelineCard } from "./ui/subagents.client";
import { contributeTodoPills, TodoTimelineCard } from "./ui/todo.client";
import type { PluginTimelineData } from "@getpaseo/plugin";

function timelineData(value: unknown): PluginTimelineData {
  return value as PluginTimelineData;
}

export default function contribute(plugin: PluginContext) {
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
  plugin.handle(latestTodoRpc, getLatestTodo);
  // Pi 的 todo 工具调用
  plugin.addTimelineTransformer({
    id: "pi-todo-tool-card",
    query: { itemType: "tool_call" },
    transform({ item }) {
      if (!isFeatureEnabled("todos")) return;
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
      if (!isFeatureEnabled("todos")) return;
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
      if (!isFeatureEnabled("subagents")) return;
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
  plugin.handle(subagentCallsRpc, listSubagentCalls);
  // ⚠️ 面板与命令项无条件注册 —— 它们活在 client bundle，那边读不到开关文件。
  // 关掉时由面板自己渲染「已关闭」，菜单入口会留着。
  plugin.addWorkspacePanel({
    id: "pi-subagents",
    title: t.panel_subagents,
    icon: "Network",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: GatedSubagentsPanel,
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

  // ── notices ──────────────────────────────────────────────────────
  // ⚠️ Pi 的 custom_message 被 Paseo 的 pi/history-mapper 拍平成了普通助手消息
  // （details 丢掉，只剩 content 文本），所以只能从 assistant_message 里反解。
  // 详见 domain/pi-notice-parser.shared.ts 与 docs/pi-message-formats.md。
  plugin.addTimelineTransformer({
    id: "pi-notice-card",
    query: { itemType: "assistant_message" },
    transform({ item }) {
      if (!isFeatureEnabled("notices")) return;
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
  plugin.handle(providerUsageRpc, listProviderUsage);

  // ── 客户端侧（composer pill）─────────────────────────────────────
  // pill 在**客户端**注册，那边读不到服务端的开关文件，所以只能加载期决定。
  plugin.addClientSide((client) => {
    // 客户端拿不到服务端的开关文件，得自己拉一次（PluginClientContext 带 rpc）
    void primeClientFlags(client);

    // ⭐ pill 是唯一能真正增删的贡献（addComposerPill 返回 cleanup），
    // 所以这里订阅开关变化，开就挂上、关就摘掉，不需要重载。
    const contributors: Array<[Feature, (c: typeof client) => () => void]> = [
      ["todos", contributeTodoPills],
      ["subagents", contributeSubagentPills],
      ["balances", contributeProviderUsagePills],
    ];
    const active = new Map<Feature, () => void>();
    const sync = () => {
      for (const [feature, contributePills] of contributors) {
        const on = isFeatureEnabled(feature);
        const running = active.get(feature);
        if (on && !running) active.set(feature, contributePills(client));
        if (!on && running) {
          running();
          active.delete(feature);
        }
      }
    };
    sync();
    const unsubscribe = subscribeClientFlags(sync);
    return () => {
      unsubscribe();
      for (const cleanup of active.values()) cleanup();
      active.clear();
    };
  });

  return () => {
    // ⚠️ 这个 cleanup 在两个 bundle 里都存在，但 closeProviderUsageClient 只有
    // server bundle 里有定义 —— client 那边的 `.server` import 被编译器整条删了。
    // 不加 typeof 守卫的话，Paseo 应用卸载插件时会 ReferenceError。
    // （对未声明标识符做 typeof 是安全的，不会抛。）
    if (typeof closeProviderUsageClient === "function") closeProviderUsageClient();
  };
}
