/**
 * 功能开关的读写与自重载。
 *
 * ```
 * $PASEO_HOME/plugin-features.json    // { "todos": true, "subagents": false, … }
 * ```
 *
 * 与 `plugin-locale.json` 同一套路：原子写（临时文件 + rename），读失败一律
 * 退回默认值不抛错 —— 开关读不到的后果是功能照常全开，为这个把插件搞崩不值得。
 *
 * ⭐ **同步缓存的必要性**：`index.ts` 在注册阶段要按开关决定注册什么，而注册是
 * 同步的；`readFileSync` 一次即可。之后 RPC 改写开关会更新缓存并触发重载，
 * 所以缓存不会陈旧到影响判断。
 */

import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { paseoHome } from "./daemon.server";
import {
  DEFAULT_FLAGS,
  normalizeFlags,
  type Feature,
  type FeatureFlags,
} from "../domain/features.shared";

export function sharedFeaturesPath(): string {
  return join(paseoHome(), "plugin-features.json");
}

let cached: FeatureFlags | null = null;
let cachedAt = 0;

/**
 * 同步读 —— 注册阶段和 timeline transformer 都要用，那两处都没法 await。
 *
 * ⭐ transformer 是**每个时间线条目**调一次的热路径，所以给一秒缓存：
 * 既不会把 readFileSync 打成瓶颈，又能在用户改完开关后很快认到
 * （包括别的进程或手工改文件）。
 */
export function readFlags(): FeatureFlags {
  const now = Date.now();
  if (cached && now - cachedAt < 1_000) return cached;
  try {
    cached = normalizeFlags(JSON.parse(readFileSync(sharedFeaturesPath(), "utf8")));
  } catch {
    cached = { ...DEFAULT_FLAGS };
  }
  cachedAt = now;
  return cached;
}

async function writeFlags(flags: FeatureFlags): Promise<void> {
  const path = sharedFeaturesPath();
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(flags, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
  cached = flags;
}

/**
 * ⛔ 不要在这里自动调 `DaemonClient.reloadPlugin(自己)`。
 *
 * 实测过（2026-09-04，@getpaseo/server 0.7.2）：发起重载的请求方就是被停掉的
 * 那个进程，daemon 打完 "Stopping plugin" 之后不再 "Loading plugin"，
 * 插件停在 `failed`，要手动 reload 才能救回来。
 *
 * 所以改成分层门控（见 index.ts）：时间线卡片调用期判断、立即生效；
 * 面板 / 命令项 / composer pill 加载期判断、下次重载生效。
 */

// ── RPC handler ─────────────────────────────────────────────────────

export const PLUGIN_ID = "paseo-pi-kit";

export function getFeatures(): { flags: FeatureFlags } {
  return { flags: readFlags() };
}

export async function setFeature(input: { feature: Feature; enabled: boolean }): Promise<{
  flags: FeatureFlags;
}> {
  const flags = { ...readFlags(), [input.feature]: input.enabled };
  await writeFlags(flags);
  return { flags };
}
