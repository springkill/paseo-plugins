import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

/**
 * 用 Paseo 自己的编译器编出 client bundle，然后真的 evaluate 一遍、
 * 把 `contribute()` 跑起来。
 *
 * ## 为什么需要这条
 *
 * 踩过：`readFlags is not defined`。typecheck 绿、`compilePlugin` 不报错、
 * 服务端 `Loaded plugin` 的 methods 列表完全正确、daemon 日志干净 ——
 * 只有 Paseo 应用里 `contribute()` 一抛异常，**四个 transformer 全都没注册上**，
 * 所有卡片一起退回裸文本。
 *
 * ⭐ 教训：服务端那半边验证不了客户端。唯一靠谱的办法是把 client bundle
 * 真的跑一遍 —— 静态检查（见 entrypoint-boundary.test.ts）只能覆盖已知形态，
 * 这条覆盖「能不能起来」。
 *
 * 编译器来自全局装的 @getpaseo/cli；CI 里没有就跳过，不让它把构建判红。
 */

function compilerPath(): string | null {
  const override = process.env.PASEO_SERVER_DIST;
  const roots = [
    ...(override ? [override] : []),
    (() => {
      try {
        return execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
      } catch {
        return "";
      }
    })(),
  ].filter(Boolean);
  for (const root of roots) {
    const candidate = join(
      root,
      "@getpaseo/cli/node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js",
    );
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const COMPILER = compilerPath();

test("⭐ client bundle 能 evaluate，且注册了全部贡献", { skip: COMPILER ? false : "本机没有全局 @getpaseo/cli" }, async () => {
  const { compilePlugin } = await import(COMPILER!);
  const entry = join(import.meta.dirname, "..", "index.ts");
  const { clientBundle } = (await compilePlugin(entry)) as { clientBundle: string };

  const require_ = createRequire(join(import.meta.dirname, "..", "package.json"));
  // 宿主在运行时提供这些；测试里用真包，取不到就给个惰性桩
  const resolve = (id: string): unknown => {
    if (id === "react-native") return new Proxy({}, { get: () => () => null });
    if (id === "@tanstack/react-query") return new Proxy({}, { get: () => () => ({}) });
    try {
      return require_(id);
    } catch {
      return new Proxy({}, { get: () => () => null });
    }
  };

  const seen = {
    transformers: [] as string[],
    renderers: [] as string[],
    panels: [] as string[],
    commands: [] as string[],
    clientSides: 0,
  };
  const plugin = {
    // client bundle 里 `plugin.handle(...)` 应当已被编译器删掉
    handle: () => assert.fail("client bundle 不该保留 plugin.handle —— 它引用的是 .server 代码"),
    addTimelineTransformer: (c: { id: string }) => seen.transformers.push(c.id),
    addTimelineRenderer: (c: { kind: string }) => seen.renderers.push(c.kind),
    addWorkspacePanel: (c: { id: string }) => seen.panels.push(c.id),
    addCommandCenterItem: (c: { id: string }) => seen.commands.push(c.id),
    addClientSide: () => { seen.clientSides++; },
    addSurface: () => {}, addSidebarItem: () => {}, addAttachmentSource: () => {}, addTheme: () => {},
  };

  // eslint-disable-next-line no-eval -- 就是要按宿主的方式执行它
  const factory = eval(clientBundle) as unknown;
  const exports = typeof factory === "function"
    ? (factory as (r: typeof resolve) => Record<string, unknown>)(resolve)
    : (factory as Record<string, unknown>);
  const contribute = (exports.default ?? exports) as (p: typeof plugin) => (() => void) | undefined;
  assert.equal(typeof contribute, "function", "client bundle 应当默认导出 contribute");

  const cleanup = contribute(plugin);

  assert.deepEqual(seen.transformers.toSorted(), [
    "native-todo-card", "pi-notice-card", "pi-subagent-card", "pi-todo-tool-card",
  ], "四个 transformer 少一个都意味着对应的卡片会退回裸文本");
  assert.deepEqual(seen.renderers.toSorted(), ["pi-notice", "pi-subagent-card", "pi-todo-board"]);
  assert.deepEqual(seen.panels.toSorted(), ["pi-kit-settings", "pi-subagents"]);
  assert.deepEqual(seen.commands.toSorted(), ["open-pi-kit-settings", "open-pi-subagents"]);
  assert.equal(seen.clientSides, 1);

  // cleanup 里引用 .server 符号是另一个踩过的坑（closeProviderUsageClient）
  assert.doesNotThrow(() => cleanup?.(), "cleanup 不该在客户端 ReferenceError");
});
