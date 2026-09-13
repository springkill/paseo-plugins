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
  // ⭐ 0.8 起是两个入口：compilePlugin({ client, server })，不再是单个 index.ts
  const root = join(import.meta.dirname, "..");
  const { clientBundle } = (await compilePlugin({
    client: join(root, "index.client.tsx"),
    server: join(root, "index.server.ts"),
  })) as { clientBundle: string };

  const require_ = createRequire(join(import.meta.dirname, "..", "package.json"));
  // 宿主在运行时提供这些；测试里用真包，取不到就给个惰性桩
  const resolve = (id: string): unknown => {
    if (id === "react-native") return new Proxy({}, { get: () => () => null });
    if (id === "@tanstack/react-query") return new Proxy({}, { get: () => () => ({}) });
    // 0.8 的子路径
    if (id === "@getpaseo/plugin/client") {
      return new Proxy({}, { get: () => () => undefined });
    }
    if (id === "@getpaseo/plugin/client/react-native") {
      return { Icon: () => null, Modal: () => null, useToast: () => () => {} };
    }
    try {
      return require_(id);
    } catch {
      return new Proxy({}, { get: () => () => null });
    }
  };

  const seen = {
    transformers: [] as string[],
    renderers: [] as string[],
    pills: [] as string[],
    panels: [] as string[],
    commands: [] as string[],
  };
  const noop = () => {};
  const client = {
    // ⚠️ 0.8 的 client 上下文 —— 服务端那半边（handle）在另一个 bundle 里，
    // 这里出现就说明目录边界破了
    handle: () => assert.fail("client bundle 不该有 handle —— 那是 index.server.ts 的事"),
    addTimelineTransformer: (c: { id: string }) => { seen.transformers.push(c.id); return noop; },
    addTimelineRenderer: (c: { kind: string; Component: unknown }) => {
      assert.equal(typeof c.Component, "function", `renderer ${c.kind} 的 Component 必须是组件`);
      seen.renderers.push(c.kind);
      return noop;
    },
    addWorkspacePanel: (c: { id: string; Component: unknown; locations?: readonly string[] }) => {
      assert.equal(typeof c.Component, "function", `panel ${c.id} 的 Component 必须是组件`);
      // 少了 explorer，桌面上就回不到侧栏那个位置
      assert.ok(c.locations?.includes("explorer"), `panel ${c.id} 应当支持 explorer`);
      seen.panels.push(c.id);
      return noop;
    },
    addCommandCenterItem: (c: { id: string }) => { seen.commands.push(c.id); return noop; },
    addComposerPill: (c: { id: string; agentId: string; button: Record<string, unknown> }) => {
      const behavior = c.button.behavior as { kind?: string; Content?: unknown } | undefined;
      // ⭐ 手机上 explorer 侧栏根本不存在，pill 必须是 popover
      assert.equal(behavior?.kind, "popover", `pill ${c.id} 必须用 popover`);
      assert.equal(typeof behavior?.Content, "function", `pill ${c.id} 的 Content 必须是组件`);
      assert.equal(typeof c.button.icon, "function", `pill ${c.id} 的 icon 应当是活组件`);
      seen.pills.push(c.id);
      return { update: noop, remove: noop };
    },
    addSurface: () => noop, addSidebarItem: () => noop, addAttachmentSource: () => noop,
    addTheme: () => noop, addSettingsScreen: () => noop, addSlashCommand: () => noop,
    addHeaderButton: () => ({ update: noop, remove: noop }),
    openPanel: () => assert.fail("0.8 起不开面板 —— pill 是 popover"),
    openSurface: noop, openSettings: noop,
    rpc: async () => ({}),
    paseo: {
      agents: {
        subscribe: (cb: (u: unknown) => void) => {
          cb({ kind: "upsert", agent: { id: "a1", workspaceId: "w1", provider: "pi" } });
          return noop;
        },
        list: async () => ({ entries: [{ agent: { id: "a1", workspaceId: "w1", provider: "pi" } }] }),
      },
    },
  };

  // eslint-disable-next-line no-eval -- 就是要按宿主的方式执行它
  const factory = eval(clientBundle) as unknown;
  const exports = typeof factory === "function"
    ? (factory as (r: typeof resolve) => Record<string, unknown>)(resolve)
    : (factory as Record<string, unknown>);
  const contribute = (exports.default ?? exports) as (c: typeof client) => (() => void) | undefined;
  assert.equal(typeof contribute, "function", "client bundle 应当默认导出 contribute");

  const cleanup = contribute(client);
  await new Promise((resolve_) => setTimeout(resolve_, 30));

  assert.deepEqual(seen.transformers.toSorted(), [
    "native-todo-card", "pi-notice-card", "pi-subagent-card", "pi-todo-tool-card",
  ], "四个 transformer 少一个都意味着对应的卡片会退回裸文本");
  assert.deepEqual(seen.renderers.toSorted(), ["pi-notice", "pi-subagent-card", "pi-todo-board"]);
  assert.deepEqual(seen.pills.toSorted(), ["pi-subagents", "pi-todos", "provider-usage"]);
  // ⭐ 两条入口并存：pill 走 popover（两端可用），面板走命令项
  // （**只有桌面 web 才可能落到 explorer 侧栏**，原生端退回主区标签页）。
  assert.deepEqual(seen.panels.toSorted(), ["pi-subagents", "pi-todos", "pi-usage"]);
  assert.deepEqual(seen.commands.toSorted(), ["open-pi-subagents", "open-pi-todos", "open-pi-usage"]);

  assert.doesNotThrow(() => cleanup?.(), "cleanup 不该抛");
});
