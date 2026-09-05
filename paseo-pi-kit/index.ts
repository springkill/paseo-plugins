/**
 * Pi Kit —— Pi 会话的四块功能：任务卡、subagent 卡、通知卡、provider 用量。
 *
 * ⚠️ **这里不做任何条件注册，也不在回调体里判断开关。**
 *
 * 曾经加过一套功能开关（`plugin-features.json` + 客户端缓存 + 设置面板）。
 * 结果时间线卡片在真实 app 里全部退回裸文本，而所有离线检查都是绿的：
 * 编译通过、按宿主规则 eval 通过、transformer 注册成功、直接调 `transform()`
 * 返回正确的 plugin item、开关 RPC 也返回全 true。
 *
 * 排查不出来的原因很实在：客户端模块级缓存的**运行时**取值，在 app 之外
 * 观测不到。为一个开关赌上插件的核心功能不划算，整套已移除。
 *
 * ⭐ 所以这个文件的规矩很简单：**注册就是注册，没有条件，没有状态。**
 * 唯一还需要留意的是前后端边界 —— 见 ../STRUCTURE.md 与
 * tests/entrypoint-boundary.test.ts。
 */

import type { PluginContext, PluginTimelineData } from "@getpaseo/plugin";
import {
  latestTodoRpc,
  localeRpc,
  PiNoticeSchema,
  providerUsageRpc,
  reportRpc,
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
import { getLocale, reportClientLines, setLocale } from "./server/locale.server";
import { closeProviderUsageClient, listProviderUsage } from "./server/provider-usage.server";
import { listSubagentCalls } from "./server/subagents.server";
import { getLatestTodo } from "./server/todo.server";
import { withCardBoundary } from "./ui/card-boundary.client";
import { drain, record } from "./ui/report.client";
import { PiNoticeTimelineCard } from "./ui/pi-notice.client";
import { contributeSubagentPills, PiSubagentsPanel, SubagentTimelineCard } from "./ui/subagents.client";
import { contributeTodoPills, PiTodoPanel, TodoTimelineCard } from "./ui/todo.client";
import { contributeProviderUsagePills, ProviderUsagePanel } from "./ui/usage-pill.client";

/**
 * ⭐⭐ 必须先把 `undefined` 的键清掉，否则整条通知会静默退回裸文本。
 *
 * 宿主在 `transformTimelineItem` 里校验返回的 `data` 是否 JSON 兼容
 * （web-ui 的 `transformed timeline item ... data must be JSON-compatible`）。
 * 那个检查器是：
 *
 * ```js
 * if (n === null || typeof n === "string" || typeof n === "boolean") return true;
 * if (typeof n === "number") return Number.isFinite(n);
 * if (typeof n !== "object") return false;          // ← undefined 落这里
 * …
 * return (Array.isArray(n) ? n : Object.values(n)).every(…)
 * ```
 *
 * `Object.values()` **包含值为 `undefined` 的键**，而 `typeof undefined` 不是
 * `"object"` —— 直接判不兼容、throw。调用处是 `try { … } catch`，异常被吞掉，
 * 条目原样落回默认渲染。**没有任何报错，服务端一切正常。**
 *
 * 而 zod 的 `.optional()` 会把「存在但为 undefined」的键保留在输出里，
 * 所以像 `runId` / `agent` / `variant` 取不到时就正好是这种键。
 *
 * `JSON.parse(JSON.stringify(…))` 会把这些键整个丢掉，一次性满足宿主的契约。
 * 见 tests/timeline-data.test.ts —— 那条测试直接复刻了宿主的检查器。
 */
function timelineData(value: unknown): PluginTimelineData {
  return JSON.parse(JSON.stringify(value)) as PluginTimelineData;
}

export default function contribute(plugin: PluginContext) {
  // 注册时刻只有宿主机环境可判 —— 没有客户端可问。面板内部走完整判定链
  const t = translator(resolveLocale({ env: process.env, envKey: "PI_KIT_LANG" }));

  plugin.handle(latestTodoRpc, getLatestTodo);
  plugin.handle(subagentCallsRpc, listSubagentCalls);
  plugin.handle(providerUsageRpc, listProviderUsage);
  plugin.handle(localeRpc, getLocale);
  plugin.handle(setLocaleRpc, setLocale);
  plugin.handle(reportRpc, reportClientLines);

  // ── 任务列表 ─────────────────────────────────────────────────────
  // Pi 的 todo 工具调用
  plugin.addTimelineTransformer({
    id: "pi-todo-tool-card",
    query: { itemType: "tool_call" },
    transform({ item }) {
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
      const board = parseTodoTimelineItem(item);
      if (!board) return;
      return { items: [{ type: "plugin", kind: "pi-todo-board", version: 1, data: timelineData(board) }] };
    },
  });
  plugin.addTimelineRenderer({
    kind: "pi-todo-board",
    version: 1,
    schema: TodoBoardSchema,
    Component: withCardBoundary("pi-todo-board", TodoTimelineCard),
  });
  // ⭐ 三块功能的面板都注册 ["workspace","explorer"] —— explorer 就是文件树、
  // git 变更树所在的那个容器（宿主 panel manifest 里它们是 hosts:["explorer"]），
  // 所以点 composer pill 打开的是侧边标签页，而不是遮住对话的 Modal。
  plugin.addWorkspacePanel({
    id: "pi-todos",
    title: t.modal_todos,
    icon: "ListTodo",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: PiTodoPanel,
  });
  plugin.addCommandCenterItem({
    id: "open-pi-todos",
    title: t.nav_open_todos,
    icon: "ListTodo",
    keywords: ["pi", "todo", "tasks", "任务"],
    context: "agent",
    onSelect({ openPanel }) {
      // 与 composer pill 保持一致：缺省是 "workspace"（主区大标签页）
      openPanel("pi-todos", { location: "explorer" });
    },
  });

  // ── Subagents ────────────────────────────────────────────────────
  plugin.addTimelineTransformer({
    id: "pi-subagent-card",
    query: { itemType: "tool_call" },
    transform({ item }) {
      const call = parseSubagentTimelineItem(item);
      if (!call) return;
      return { items: [{ type: "plugin", kind: "pi-subagent-card", version: 1, data: timelineData(call) }] };
    },
  });
  plugin.addTimelineRenderer({
    kind: "pi-subagent-card",
    version: 1,
    schema: SubagentCallSchema,
    Component: withCardBoundary("pi-subagent-card", SubagentTimelineCard),
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
      // 与 composer pill 保持一致：缺省是 "workspace"（主区大标签页）
      openPanel("pi-subagents", { location: "explorer" });
    },
  });

  // ── Pi 通知卡片 ──────────────────────────────────────────────────
  // ⚠️ Pi 的 custom_message 被 Paseo 的 pi/history-mapper 拍平成了普通助手消息
  // （details 丢掉，只剩 content 文本），所以只能从 assistant_message 里反解。
  // 详见 domain/pi-notice-parser.shared.ts 与 docs/pi-message-formats.md。
  plugin.addTimelineTransformer({
    id: "pi-notice-card",
    query: { itemType: "assistant_message" },
    transform({ item }) {
      const notice = parsePiNoticeTimelineItem(item);
      if (!notice) return;
      return { items: [{ type: "plugin", kind: "pi-notice", version: 1, data: timelineData(notice) }] };
    },
  });
  plugin.addTimelineRenderer({
    kind: "pi-notice",
    version: 1,
    schema: PiNoticeSchema,
    Component: withCardBoundary("pi-notice", PiNoticeTimelineCard),
  });

  plugin.addWorkspacePanel({
    id: "pi-usage",
    title: t.usage_modal_title,
    icon: "Gauge",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: ProviderUsagePanel,
  });
  plugin.addCommandCenterItem({
    id: "open-pi-usage",
    title: t.usage_nav_open_usage,
    icon: "Gauge",
    keywords: ["provider", "usage", "balance", "quota", "用量", "余额"],
    context: "agent",
    onSelect({ openPanel }) {
      // 与 composer pill 保持一致：缺省是 "workspace"（主区大标签页）
      openPanel("pi-usage", { location: "explorer" });
    },
  });

  // ── composer pill ────────────────────────────────────────────────
  plugin.addClientSide((client) => {
    // 渲染异常从 CardBoundary 进缓冲区，这里定时送回服务端打进 daemon 日志。
    // 客户端跑在 app 里，不这么做的话它的 console 在 app 之外根本看不到。
    const timer = setInterval(() => {
      const lines = drain();
      if (lines.length) void client.rpc(reportRpc, { lines }).catch(() => {});
    }, 3000);
    const cleanups = [
      contributeTodoPills(client),
      contributeSubagentPills(client),
      contributeProviderUsagePills(client),
    ];
    return () => {
      clearInterval(timer);
      for (const cleanup of cleanups.reverse()) cleanup();
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
