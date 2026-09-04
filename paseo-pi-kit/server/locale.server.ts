/**
 * 共享语言设置的读写。
 *
 * 本插件与 paseo-rumen 读写**同一个文件**，所以在任何一个里改语言，
 * 另一个下次渲染就跟上。
 *
 * ```
 * $PASEO_HOME/plugin-locale.json      // { "locale": "auto" | "zh" | "en" }
 * ```
 *
 * 文件不存在 / 读不动 / 格式坏 —— 一律当 `auto`，不抛错。语言设置读不到的
 * 后果只是显示成英文，为这个把插件搞崩不值得。**写**失败才需要让用户知道。
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { output as ZodOutput } from "zod";
import type { localeRpc, setLocaleRpc } from "../domain/contracts.shared";
import { lockedByEnv, resolveLocale, type LocalePreference } from "../domain/locale.shared";

export function sharedLocalePath(): string {
  const home = process.env.PASEO_HOME ?? join(homedir(), ".paseo");
  return join(home, "plugin-locale.json");
}

export async function readSharedLocale(): Promise<LocalePreference> {
  try {
    const raw = await readFile(sharedLocalePath(), "utf8");
    const value = (JSON.parse(raw) as { locale?: unknown }).locale;
    if (value === "zh" || value === "en" || value === "auto") return value;
  } catch {
    // 没有文件、读不动、格式坏 —— 都当没设过
  }
  return "auto";
}

export async function writeSharedLocale(locale: LocalePreference): Promise<void> {
  const path = sharedLocalePath();
  await mkdir(dirname(path), { recursive: true });
  // 临时文件 + rename：另一个插件正在读的时候不会读到半个文件
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ locale }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

// ── RPC handler ─────────────────────────────────────────────────────

/** 本插件专用的强制开关。作用域比 `PASEO_PLUGIN_LANG` 更窄，所以优先级更高。 */
const ENV_KEY = "PI_KIT_LANG";

async function snapshot(clientLocale: string | undefined) {
  const preference = await readSharedLocale();
  return {
    preference,
    resolved: resolveLocale({ env: process.env, envKey: ENV_KEY, saved: preference, clientHint: clientLocale }),
    lockedByEnv: lockedByEnv(process.env, ENV_KEY),
  };
}

export async function getLocale(input: ZodOutput<typeof localeRpc.input>) {
  return snapshot(input.clientLocale);
}

export async function setLocale(input: ZodOutput<typeof setLocaleRpc.input>) {
  if (!lockedByEnv(process.env, ENV_KEY)) await writeSharedLocale(input.preference);
  return snapshot(input.clientLocale);
}


/** ⛔ 临时诊断：把客户端探针的记录打进 daemon 日志。定位完删掉。 */
export function reportDiag(input: { lines: string[] }): { ok: boolean } {
  for (const line of input.lines) console.log(`[pi-kit diag] ${line}`);
  return { ok: true };
}
