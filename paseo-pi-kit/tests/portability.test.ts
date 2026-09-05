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

// ── 版本对账 ────────────────────────────────────────────────────────

test("⭐ 错误边界里的版本号与 package.json 一致", () => {
  // 边界把版本号画进错误消息，好让一张截图就能分辨「修没修好」和
  // 「app 还在跑旧 bundle」—— 对不上的话这个作用就没了，而且会误导。
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
  const source = readFileSync(join(ROOT, "ui", "card-boundary.client.tsx"), "utf8");
  const declared = source.match(/^const VERSION = "([^"]+)";$/m)?.[1];
  assert.equal(declared, pkg.version, "改版本号时 ui/card-boundary.client.tsx 也要跟着改");
});

test("⭐ 所有插件界面都裹了错误边界", () => {
  // 宿主的 SurfaceErrorBoundary 同样包着面板和 pill，但它只显示一行
  // `Plugin failed: <msg>`，细节进了 app 里的 console.warn —— 等于查不了。
  const sources = [
    ["index.ts", readFileSync(join(ROOT, "index.ts"), "utf8")] as const,
    ...readdirSync(join(ROOT, "ui"))
      .filter((name) => name.endsWith(".client.tsx"))
      .map((name) => [`ui/${name}`, readFileSync(join(ROOT, "ui", name), "utf8")] as const),
  ];
  const offenders = sources.flatMap(([name, source]) =>
    [...source.matchAll(/^\s*Component: (\w+),$/gm)].map((m) => `${name}: Component: ${m[1]}`),
  );
  assert.deepEqual(offenders, [], "改成 Component: withCardBoundary(\"<id>\", X)");
});

test("⭐ Icon 一律从 @getpaseo/plugin/react-native 取", () => {
  // 宿主给 `@getpaseo/plugin` 和 `@getpaseo/plugin/react-native` 都注入了 Icon，
  // 但**npm 包本身只导出后者** —— 前者纯靠宿主运行时补。少一处不确定性总是好的，
  // 而且这类问题炸出来是 `Element type is invalid … but got: undefined`，
  // 从报错完全看不出是导入写错了。
  const offenders: string[] = [];
  for (const [name, source] of shippedFiles()) {
    const imports = source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@getpaseo\/plugin"/g);
    for (const match of imports) {
      if (/\bIcon\b/.test(match[1]!.replace(/\btype\s+\w+/g, ""))) offenders.push(name);
    }
  }
  assert.deepEqual(offenders, [], '改成 import { Icon } from "@getpaseo/plugin/react-native"');
});

test("⭐ 不用 React.xxx，一律具名导入", () => {
  // esbuild 把 `React.Component` / `React.useMemo` 编成 `import_react.default.xxx`，
  // 依赖 `__toESM` 合成出来的 `.default`。宿主在 web 和原生两端各自提供 react 模块，
  // 两边的 interop 形状不保证一样 —— 具名导入编出来是 `import_react.Component`，
  // 没有这层不确定性。
  //
  // ⚠️ 这类问题的表现是 `Element type is invalid … but got: undefined`，
  // 从报错完全看不出跟 import 有关。
  const offenders: string[] = [];
  for (const [name, source] of shippedFiles()) {
    const stripped = stripComments(source);
    for (const match of stripped.matchAll(/\bReact\.(\w+)/g)) {
      // 类型位置（React.ReactNode 之类）会被 tsc 擦掉，不进运行时
      if (/^[A-Z]/.test(match[1]!) && !/^(Component|PureComponent|Fragment|StrictMode)$/.test(match[1]!)) continue;
      offenders.push(`${name}: React.${match[1]}`);
    }
  }
  assert.deepEqual(offenders, [], '改成具名导入，如 import { useMemo, Component } from "react"');
});
