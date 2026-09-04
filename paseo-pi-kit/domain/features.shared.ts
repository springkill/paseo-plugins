/**
 * 功能开关。
 *
 * ## 为什么是「加载期门控 + 自重载」而不是热开关
 *
 * Paseo SDK 里 `PluginContext` 的注册 API —— `addTimelineTransformer`、
 * `addTimelineRenderer`、`addWorkspacePanel`、`addCommandCenterItem`、
 * `addSurface`、`addClientSide` —— **全部返回 `void`，没有注销句柄**。
 * 只有 client 侧的 `addComposerPill` 返回 `PluginCleanup`。
 *
 * 也就是说：transformer 可以在 `transform()` 里返回 `undefined` 装作不存在，
 * 但**面板和命令面板项一旦注册就摘不掉**。
 *
 * 于是有两条路：
 *
 * 1. 混合：transformer/pill 热切，面板走重载 —— 代码分叉成两套路径，
 *    而且「关了但菜单还在」只在部分功能上发生，行为不一致。
 * 2. 统一：**加载期就按开关决定注册什么**，切开关后自重载。
 *
 * ⭐ 选 2。四个功能里只有 subagents 有面板，为它单独留一条冷路径不值得；
 * 统一之后「关掉 = 彻底不存在」，没有例外要解释。
 * 代价是切开关要重载一次插件（实测约 370ms，daemon 日志里
 * Stopping → Plugin ready 的间隔）。
 *
 * 自重载靠 `DaemonClient.reloadPlugin(id)`，见 server/features.server.ts。
 */

export const FEATURES = ["todos", "subagents", "notices", "balances"] as const;

export type Feature = (typeof FEATURES)[number];

export type FeatureFlags = Record<Feature, boolean>;

/** 默认全开 —— 装了插件就该看到全部能力，要减自己去关。 */
export const DEFAULT_FLAGS: FeatureFlags = {
  todos: true,
  subagents: true,
  notices: true,
  balances: true,
};

/**
 * 哪些功能关掉后需要重载才能真正消失。
 *
 * 目前统一走重载，这张表只用于**告诉用户会发生什么**，不驱动逻辑 ——
 * 逻辑上一律重载，免得两套路径。
 */
export const HAS_STATIC_SURFACE: Record<Feature, boolean> = {
  todos: false,
  subagents: true, // workspace panel + command center item
  notices: false,
  balances: false,
};

export function normalizeFlags(value: unknown): FeatureFlags {
  const raw = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const flags = { ...DEFAULT_FLAGS };
  for (const feature of FEATURES) {
    if (typeof raw[feature] === "boolean") flags[feature] = raw[feature];
  }
  return flags;
}
