import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * 运行时可移植性。
 *
 * ═══════════════════════════════════════════════════════════════════
 * ⭐ **Paseo 的客户端代码要在两个完全不同的 JS 运行时里跑：**
 *
 * | 端 | 运行时 | Intl |
 * |---|---|---|
 * | web / 桌面 | 浏览器 + react-native-web | 有 |
 * | iOS / 安卓 app | **Hermes** | **常常没有** |
 *
 * 0.7.0 在 `classifyNumber` 里写了一句 `value.toLocaleString()`。
 * web 上完全正常，本机把 67 条真实通知全渲染一遍也零失败 ——
 * 安卓上整条时间线是 `Plugin failed: Object is not a function`。
 *
 * 这类问题的恶劣之处在于**本机怎么测都是绿的**，而且宿主的
 * `SurfaceErrorBoundary` 把详细信息扔进了 app 里的 `console.warn`，
 * daemon 日志（只有服务端那半边）看不到。
 *
 * `tests/render.test.ts` 能在裁剪过的运行时里复现它，但那条依赖全局装的
 * `@getpaseo/cli` 编译器，**CI 上是跳过的**。所以还需要这条纯静态的 ——
 * 它哪都能跑，是真正拦住回归的那道闸。
 *
 * 确实需要用的地方（比如语言探测的兜底）在行尾标 `hermes-ok:` 说明理由。
 * ═══════════════════════════════════════════════════════════════════
 */

const ROOT = join(import.meta.dirname, "..");

function shippedFiles(): Array<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [["index.ts", readFileSync(join(ROOT, "index.ts"), "utf8")]];
  for (const dir of ["domain", "ui"]) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (!/\.(ts|tsx)$/.test(name)) continue;
      // .server.ts 只在 daemon 里跑（Node），不受 Hermes 约束
      if (name.endsWith(".server.ts")) continue;
      out.push([`${dir}/${name}`, readFileSync(join(ROOT, dir, name), "utf8")] as const);
    }
  }
  return out;
}

/** 剥掉注释 —— 这些 API 的名字在解释「为什么不能用」的注释里必然出现。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const BANNED: Array<readonly [RegExp, string]> = [
  [/\.toLocaleString\s*\(/, "Hermes（安卓）没有 Intl，toLocaleString 会把整张卡片打成 Plugin failed；改用 domain/format.shared.ts 的 formatNumber / formatDateTime"],
  [/\.toLocaleDateString\s*\(/, "同上，改用 formatDateTime"],
  [/\.toLocaleTimeString\s*\(/, "同上，改用 formatDateTime"],
  [/\bIntl\s*\./, "Hermes 上 Intl 可能整个不存在"],
  [/\bnew\s+Intl\b/, "Hermes 上 Intl 可能整个不存在"],
  [/\.localeCompare\s*\(/, "排序改用普通比较，别依赖 Intl 排序规则"],
  [/\bReflect\.ownKeys\s*\(/, "裁剪过的运行时上不一定有；用 Object.keys / Object.getOwnPropertySymbols"],
];

test("⭐ 客户端代码里不出现 Intl 家族 API", () => {
  const offenders: string[] = [];
  for (const [name, source] of shippedFiles()) {
    const lines = stripComments(source).split("\n");
    lines.forEach((line, index) => {
      // 显式豁免：行尾标 hermes-ok: 并写清理由
      if (line.includes("hermes-ok:")) return;
      for (const [pattern, why] of BANNED) {
        if (pattern.test(line)) offenders.push(`${name}:${index + 1}  ${line.trim()}\n    → ${why}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `\n${offenders.join("\n")}\n`);
});

test("豁免必须写理由", () => {
  const bare = shippedFiles()
    .flatMap(([name, source]) => source.split("\n").map((line, index) => [name, index + 1, line] as const))
    .filter(([, , line]) => /hermes-ok:\s*$/.test(line))
    .map(([name, line]) => `${name}:${line}`);
  assert.deepEqual(bare, [], "hermes-ok: 后面要写清为什么这里安全");
});

test("格式化只有一处实现", () => {
  const format = readFileSync(join(ROOT, "domain", "format.shared.ts"), "utf8");
  assert.ok(/export function formatNumber/.test(format));
  assert.ok(/export function formatDateTime/.test(format));
  const others = shippedFiles()
    .filter(([name]) => name !== "domain/format.shared.ts")
    .filter(([, source]) => /function formatNumber\b|function formatDateTime\b/.test(stripComments(source)))
    .map(([name]) => name);
  assert.deepEqual(others, [], "从 domain/format.shared.ts 引，别各写各的");
});
