/**
 * 打开面板：**优先 explorer 侧栏，开不出来就退回默认放置**。
 *
 * ═══════════════════════════════════════════════════════════════════
 * ⭐ 为什么不能直接写 `{ location: "explorer" }`
 *
 * 宿主的 `createPluginNavigation` 是这么处理的（从 web-ui 产物里读出来的）：
 *
 * ```js
 * function placementFor(location) {
 *   if (location !== "explorer") return;                  // 默认放置
 *   const paneId = useWorkspaceLayoutStore.getState()
 *                    .showExplorerSidebar(`${serverId}:${workspaceId}`);
 *   if (!paneId) throw new Error("Explorer is unavailable");   // ← 手机
 *   return { mode: "pane", paneId };
 * }
 * ```
 *
 * 而 explorer 有**三种形态**，按屏幕宽度和平台分：
 *
 * ```js
 * isCompact ? "overlay"                       // xs / sm 断点 —— 手机
 *   : supportsDesktopPaneSplits() ? "pane"    // 桌面 web
 *   : "dock"
 * ```
 *
 * `supportsDesktopPaneSplits()` 直接 `return isWeb`。
 * **手机上是 `overlay` 形态，压根没有可用的 pane** —— `showExplorerSidebar`
 * 返回 `null`，`openPanel` 同步抛 `"Explorer is unavailable"`，
 * 于是点了 pill 什么都不发生：图标在，侧边栏空的。
 *
 * Mac 上正常纯粹是因为屏幕够宽、且桌面端是 web 形态。
 *
 * ⚠️ 这个差异**本机与 web 端都测不出来** —— 只有窄屏的原生端会踩到。
 *
 * ⭐ 所以：先试 explorer，抛了就退回默认放置（主区标签页）。
 * 手机上有个能看的界面，比点了没反应好得多。
 * ═══════════════════════════════════════════════════════════════════
 */

import { record } from "./report.client";

type OpenPanel<O> = (panelId: string, options: O) => void;

export function openPanelPreferExplorer<O extends { location?: "workspace" | "explorer" }>(
  open: OpenPanel<O>,
  panelId: string,
  options: O,
): void {
  try {
    open(panelId, { ...options, location: "explorer" });
    return;
  } catch (error) {
    // 宿主抛的是 "Explorer is unavailable"。不硬匹配那句话 —— 文案会变，
    // 而退回默认放置对任何失败原因都是合理的兜底。
    record(`openPanel(${panelId}) explorer 不可用，退回默认放置: ${error instanceof Error ? error.message : String(error)}`);
  }
  open(panelId, options);
}
