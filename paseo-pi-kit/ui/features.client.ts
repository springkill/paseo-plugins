/**
 * 客户端这一侧的功能开关缓存。
 *
 * ## 为什么开关不能在 index.ts 里判断
 *
 * Paseo 编译器对入口文件做的是**文本级删除**
 * （`@getpaseo/server` 的 `plugins/compiler.js` → `filterEntrypoint()`）：
 *
 * 1. `collectOppositeTargetImportRanges` 把对面 target 的 **import 语句整条删掉**
 * 2. `collectRemovedRegistrationRanges` 删掉不属于该 target 的**注册调用**，
 *    清单是 `REGISTRATIONS_REMOVED_BY_TARGET`：
 *    - client bundle 只删 `handle`
 *    - server bundle 删掉全部 `add*`
 *
 * ⭐ 关键推论：**client bundle 保留除 `handle` 之外的一切**。所以入口里任何
 * 裸语句（`const flags = readFlags()`、`if (flags.x) …`）都会原样留在客户端，
 * 而它依赖的 `./server/*.server` import 已经被删 —— 运行时 `ReferenceError`。
 *
 * 踩过：`readFlags is not defined`。而且**构建不会报错** —— boundary 检查
 * 根本看不到那条 import，它在更早的文本阶段就没了。服务端 bundle 一切正常，
 * `paseo plugin ls` 显示 running，只有 UI 里炸。所以**光看 daemon 日志验证不了**。
 *
 * ## 于是
 *
 * 注册一律无条件，门控放进回调体里：transformer 读这里的缓存，面板与 pill
 * 走各自的 React / client 上下文。好处是不需要重载 —— 改完开关立刻生效。
 */

import type { PluginCommandCapabilities } from "@getpaseo/plugin";
import { featuresRpc } from "../domain/contracts.shared";
import { DEFAULT_FLAGS, type Feature, type FeatureFlags } from "../domain/features.shared";

/** 拿到真值之前一律按开着算 —— 首屏少显示卡片比多显示更让人困惑。 */
let flags: FeatureFlags = { ...DEFAULT_FLAGS };

const listeners = new Set<() => void>();

/** ⚠️ 同步读 —— timeline transformer 是同步函数，只能这样。 */
export function isFeatureEnabled(feature: Feature): boolean {
  return flags[feature];
}

export function getClientFlags(): FeatureFlags {
  return flags;
}

/** 设置面板改完开关后直接喂进来，省一次往返。 */
export function setClientFlags(next: FeatureFlags): void {
  flags = next;
  for (const listener of listeners) listener();
}

export function subscribeClientFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 向服务端要一次真值。
 *
 * `PluginClientContext` 继承 `PluginCommandCapabilities`，带 `rpc()` ——
 * 客户端不用 React hook 也能调 RPC，所以 `addClientSide` 里就能拉。
 *
 * 失败就保持默认（全开）：开关读不到的后果是功能照常显示，不该把 UI 搞崩。
 */
export async function primeClientFlags(client: Pick<PluginCommandCapabilities, "rpc">): Promise<void> {
  try {
    const result = await client.rpc(featuresRpc, {});
    setClientFlags(result.flags);
  } catch {
    // 保持默认
  }
}
