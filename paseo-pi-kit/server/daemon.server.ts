/**
 * 连接本机 Paseo daemon 的公共部分。
 *
 * 只有一个用处：读 provider 用量（`provider-usage.server.ts`）—— 那份数据
 * 公开的 `PaseoApi` 没暴露，只能直接问本机 daemon。
 *
 * ⚠️ 这条路走的是 `@getpaseo/client/internal/daemon-client` —— **internal**。
 * 它是本插件唯一的**值导入**（其余 `@getpaseo/client` 引用都是 `import type`，
 * 编译期擦除），所以 `paseo-plugin.json` 里必须保留 `build: npm install`：
 * `paseo plugin install` 只 clone 不装依赖，少了它这个模块打不进 bundle。
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function paseoHome(): string {
  return process.env.PASEO_HOME ?? join(homedir(), ".paseo");
}

/**
 * 从 daemon 配置推出 ws 地址。
 *
 * 三种连不上的情况直接抛错而不是猜：带密码的 daemon、Unix socket、
 * 以及配置读不到。猜一个地址去连只会把失败推迟到超时。
 */
export async function daemonUrl(): Promise<string> {
  const raw = await readFile(join(paseoHome(), "config.json"), "utf8");
  const config = JSON.parse(raw) as { daemon?: { listen?: string; auth?: { password?: string } } };
  if (config.daemon?.auth?.password) {
    throw new Error("本插件不支持带密码的本地 daemon");
  }
  const listen = config.daemon?.listen ?? "127.0.0.1:6767";
  if (listen.startsWith("/") || listen.startsWith("unix:")) {
    throw new Error(`本插件无法连接 Unix daemon socket: ${listen}`);
  }
  if (/^\d+$/.test(listen)) return `ws://127.0.0.1:${listen}/ws`;
  const normalized = listen
    .replace(/^0\.0\.0\.0:/, "127.0.0.1:")
    .replace(/^\[?::\]?:/, "127.0.0.1:");
  return `ws://${normalized}/ws`;
}
