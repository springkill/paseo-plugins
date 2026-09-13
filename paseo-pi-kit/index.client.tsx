/**
 * Pi Kit —— 客户端入口。
 *
 * ⚠️ **这里不做任何条件注册，也不在回调体里判断开关。**
 *
 * 曾经加过一套功能开关（`plugin-features.json` + 客户端缓存 + 设置面板）。
 * 结果时间线卡片在真实 app 里全部退回裸文本，而所有离线检查都是绿的。
 * 排查不出来的原因很实在：客户端模块级缓存的**运行时**取值，在 app 之外
 * 观测不到。为一个开关赌上插件的核心功能不划算，整套已移除。
 *
 * ⭐ 所以这个文件的规矩很简单：**注册就是注册，没有条件，没有状态。**
 *
 * ## 0.8 变化
 *
 * - `addClientSide(...)` 没了 —— 这个文件的函数体**就是**原来那个回调
 * - 前后端边界改由编译器按目录管（`client/` / `server/` / `shared/`），
 *   不再需要 `typeof X === "function"` 那种守卫
 * - composer pill 从 React 组件改成按钮描述符，行为是 `popover`
 */

import type { PluginTimelineData } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  PiNoticeSchema,
  reportRpc,
  SubagentCallSchema,
  TodoBoardSchema,
} from "./shared/contracts";
import { parsePiNoticeTimelineItem } from "./shared/pi-notice-parser";
import { parseSubagentTimelineItem } from "./shared/subagent-parser";
import { parseTodoTimelineItem } from "./shared/todo-parser";
import { translator } from "./shared/i18n";
import { localeFromTag } from "./shared/locale";
import { detectClientLocale } from "./client/locale";
import { VERSION, withCardBoundary } from "./client/card-boundary";
import { openPanelPreferExplorer } from "./client/open-panel";
import { captureHostPluginLogs, clientFingerprint, drain, record } from "./client/report";
import { PiNoticeTimelineCard } from "./client/pi-notice";
import { registerSubagentPill, SubagentPanel, SubagentTimelineCard } from "./client/subagents";
import { registerTodoPill, TodoPanel, TodoTimelineCard } from "./client/todo";
import { ProviderUsagePanel, registerProviderUsagePill } from "./client/usage-pill";

/**
 * ⭐⭐ 必须先把 `undefined` 的键清掉，否则整条通知会静默退回裸文本。
 *
 * 宿主在 `transformTimelineItem` 里校验返回的 `data` 是否 JSON 兼容
 * （`transformed timeline item ... data must be JSON-compatible`）。那个检查器是：
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
 * 而 zod 的 `.optional()` 会把「存在但为 undefined」的键保留在输出里。
 * `JSON.parse(JSON.stringify(…))` 一次性满足宿主的契约。
 * 见 tests/timeline-data.test.ts —— 那条测试直接复刻了宿主的检查器。
 */
function timelineData(value: unknown): PluginTimelineData {
  return JSON.parse(JSON.stringify(value)) as PluginTimelineData;
}

export default function contribute(client: PluginClientContext) {
  // ⭐ 启动信标：报一行客户端**实际在跑的 bundle 版本 + 运行时指纹**。
  //
  // 没有它就会反复卡在同一个问题上：设备报错，而分不清是「没修好」还是
  // 「app 还在跑旧 bundle」—— 宿主只在 clientBundle 字符串变化时才重新求值，
  // 光重启 app 不一定换得掉。实测为此空转了三轮。一行/次加载，不是噪音。
  record(`client up v${VERSION} ${clientFingerprint()}`);

  // ⭐ 接管宿主自己打的 `[Plugins] …` 日志。
  // 宿主的错误边界把完整错误和组件栈丢进 console.warn，而屏幕上只留一句
  // `Plugin failed: <msg>` —— 客户端在 app 里，那个 console 读不到。
  // 而且宿主在插件组件外面还套了两层，那两层抛异常时插件自己的边界
  // 压根不会挂载，上报通道也就哑了。见 client/report.ts。
  const releaseConsole = captureHostPluginLogs();

  // 渲染异常从 CardBoundary 进缓冲区，这里定时送回服务端打进 daemon 日志。
  const timer = setInterval(() => {
    const lines = drain();
    if (lines.length) void client.rpc(reportRpc, { lines }).catch(() => {});
  }, 3000);

  const cleanups: Array<() => void> = [];

  // ⚠️ 注册时刻不是 React 渲染，拿不到 useLocale。面板标题与命令项名用客户端
  // 自己的语言就够；用户真正阅读的内容走完整的服务端判定（含共享设置）。
  const t = translator(localeFromTag(detectClientLocale()) ?? "en");

  /**
   * 面板 + 命令入口。
   *
   * ⭐ **面板只有桌面 web 才可能落到 explorer 侧栏** —— 宿主的
   * `supportsDesktopPaneSplits()` 直接 `return isWeb`，而且手机还额外是
   * `isCompact`，两条都不满足 "pane"。原生端 `openPanelPreferExplorer`
   * 会退回主区标签页（至少能一直留着切回来）。见 docs/card-design.md §5。
   *
   * pill 的 popover 两端都可用，所以两条入口并存：桌面要侧栏就走命令面板，
   * 手机随手看就点 pill。
   */
  function addPanel(id: string, title: string, icon: string, keywords: string[], Component: Parameters<typeof client.addWorkspacePanel>[0]["Component"]) {
    cleanups.push(client.addWorkspacePanel({
      id,
      title,
      icon,
      context: "agent",
      locations: ["workspace", "explorer"],
      Component: withCardBoundary(id, Component as never) as never,
    }));
    cleanups.push(client.addCommandCenterItem({
      id: `open-${id}`,
      title,
      icon,
      keywords,
      context: "agent",
      onSelect({ openPanel }) {
        openPanelPreferExplorer(openPanel, id, {});
      },
    }));
  }

  // ── 任务列表 ─────────────────────────────────────────────────────
  // Pi 的 todo 工具调用
  cleanups.push(client.addTimelineTransformer({
    id: "pi-todo-tool-card",
    query: { itemType: "tool_call" },
    transform({ item }) {
      const board = parseTodoTimelineItem(item);
      if (!board) return;
      return { items: [{ type: "plugin", kind: "pi-todo-board", version: 1, data: timelineData(board) }] };
    },
  }));
  // Paseo 原生 todo 条目
  cleanups.push(client.addTimelineTransformer({
    id: "native-todo-card",
    query: { itemType: "todo" },
    transform({ item }) {
      const board = parseTodoTimelineItem(item);
      if (!board) return;
      return { items: [{ type: "plugin", kind: "pi-todo-board", version: 1, data: timelineData(board) }] };
    },
  }));
  cleanups.push(client.addTimelineRenderer({
    kind: "pi-todo-board",
    version: 1,
    schema: TodoBoardSchema,
    Component: withCardBoundary("pi-todo-board", TodoTimelineCard),
  }));

  // ── Subagents ────────────────────────────────────────────────────
  cleanups.push(client.addTimelineTransformer({
    id: "pi-subagent-card",
    query: { itemType: "tool_call" },
    transform({ item }) {
      const call = parseSubagentTimelineItem(item);
      if (!call) return;
      return { items: [{ type: "plugin", kind: "pi-subagent-card", version: 1, data: timelineData(call) }] };
    },
  }));
  cleanups.push(client.addTimelineRenderer({
    kind: "pi-subagent-card",
    version: 1,
    schema: SubagentCallSchema,
    Component: withCardBoundary("pi-subagent-card", SubagentTimelineCard),
  }));

  // ── Pi 通知卡片 ──────────────────────────────────────────────────
  // ⚠️ Pi 的 custom_message 被 Paseo 的 pi/history-mapper 拍平成了普通助手消息
  // （details 丢掉，只剩 content 文本），所以只能从 assistant_message 里反解。
  // 详见 shared/pi-notice-parser.ts 与 docs/pi-message-formats.md。
  cleanups.push(client.addTimelineTransformer({
    id: "pi-notice-card",
    query: { itemType: "assistant_message" },
    transform({ item }) {
      const notice = parsePiNoticeTimelineItem(item);
      if (!notice) return;
      return { items: [{ type: "plugin", kind: "pi-notice", version: 1, data: timelineData(notice) }] };
    },
  }));
  cleanups.push(client.addTimelineRenderer({
    kind: "pi-notice",
    version: 1,
    schema: PiNoticeSchema,
    Component: withCardBoundary("pi-notice", PiNoticeTimelineCard),
  }));

  // ── composer pill（0.8 起是 popover，不再开面板）────────────────
  //
  // ⭐ 三个入口统一成点击就地弹出。0.7 时代它们开的是 explorer 侧栏面板，
  // 而 explorer 在窄屏上**根本不存在**（宿主：isCompact ? "overlay" :
  // supportsDesktopPaneSplits() ? "pane" : "dock"，且 supportsDesktopPaneSplits
  // 直接 return isWeb），手机上点了只会抛 "Explorer is unavailable"。
  // popover 两端都能用，这个宿主限制就绕开了。见 docs/card-design.md §5。
  cleanups.push(registerTodoPill(client));
  cleanups.push(registerSubagentPill(client));
  cleanups.push(registerProviderUsagePill(client));

  // ── 面板（桌面 explorer 侧栏 / 原生退回主区标签页）──────────────
  addPanel("pi-todos", t.modal_todos, "ListTodo", ["pi", "todo", "tasks", "任务"], TodoPanel);
  addPanel("pi-subagents", t.panel_subagents, "Network", ["pi", "children", "workflow", "agents"], SubagentPanel);
  addPanel("pi-usage", t.usage_modal_title, "Gauge", ["provider", "usage", "balance", "quota", "用量", "余额"], ProviderUsagePanel);

  return () => {
    clearInterval(timer);
    releaseConsole();
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
