import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import React from "react";
import { NOTICE_FIXTURES } from "./notice-fixtures";

/**
 * 卡片**真的渲染得出来**吗。
 *
 * ═══════════════════════════════════════════════════════════════════
 * ## 为什么需要这条
 *
 * 在这条之前，测试只验到「bundle 能 evaluate、贡献都注册上了」
 * （tests/client-bundle.test.ts）—— 从来没有把组件树跑一遍。
 *
 * 于是 0.7.0 出了这样一个洞：`classifyNumber` 里一句 `value.toLocaleString()`，
 * typecheck 绿、69 条测试全绿、web 端完全正常，**安卓上整条时间线是**
 *
 * ```
 * Plugin failed: Object is not a function
 * ```
 *
 * 因为安卓的 Paseo 跑 Hermes，而 RN 的 Hermes 常常不带 Intl。
 * 宿主的 `SurfaceErrorBoundary` 把详细信息扔进 app 里的 `console.warn`，
 * daemon 日志（只有服务端那半边）什么都看不到。
 *
 * ## 做法
 *
 * 用 Paseo 自己的编译器编出 client bundle → 喂桩模块 evaluate →
 * 跑 transformer → 把渲染出来的组件树**递归调用一遍**。
 *
 * ⭐ 两个关键细节，做错就什么都验不到：
 *
 * 1. `react-native` 的图元要桩成**字符串宿主组件**，不能桩成返回 null 的函数 ——
 *    后者会让遍历在第一个 `<View>` 就停住。
 * 2. 要跑一遍 **Hermes 裁剪模式**：把 Intl 和 toLocaleString 换成抛异常的桩。
 *    正常模式下这个 bug 是**测不出来**的（Node 有完整 Intl）。
 *
 * ⚠️ 这条依赖全局装的 @getpaseo/cli 编译器，**CI 上会跳过**。
 * 真正在 CI 里拦回归的是 tests/portability.test.ts 的静态禁令。
 * ═══════════════════════════════════════════════════════════════════
 */

function compilerPath(): string | null {
  const roots = [process.env.PASEO_SERVER_DIST, (() => {
    try { return execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(); } catch { return ""; }
  })()].filter(Boolean) as string[];
  for (const root of roots) {
    const candidate = join(root, "@getpaseo/cli/node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
const COMPILER = compilerPath();

/** 极简 hooks dispatcher：只求把组件函数跑起来，不做重渲染。 */
const DISPATCHER = {
  useState: (init: unknown) => [typeof init === "function" ? (init as () => unknown)() : init, () => {}],
  useReducer: (_r: unknown, init: unknown) => [init, () => {}],
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useRef: (init: unknown) => ({ current: init }),
  useEffect: () => {}, useLayoutEffect: () => {}, useInsertionEffect: () => {},
  useContext: (ctx: { _currentValue?: unknown } | null) => ctx?._currentValue,
  useDebugValue: () => {}, useId: () => "id",
  useSyncExternalStore: (_s: unknown, get: () => unknown) => get(),
  useTransition: () => [false, (fn: () => void) => fn()],
  useDeferredValue: (v: unknown) => v, useImperativeHandle: () => {},
};

// ⚠️ 必须真的装上去 —— 只定义不安装的话每个组件在第一个 useMemo 就炸，
// 而那看起来跟「卡片渲染失败」一模一样（第一版就是这样白跑了一轮）。
(React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown };
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = DISPATCHER;

/** 递归展开元素树：函数组件调用之，类组件实例化后调 render，宿主组件走 children。 */
function walk(node: unknown, trail: string[], depth = 0): void {
  if (depth > 300) throw new Error("render depth exceeded");
  if (node === null || node === undefined || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, trail, depth + 1);
    return;
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  const type = element.type;
  const props = element.props ?? {};
  // ⭐ React 对 undefined / null 的元素类型会抛
  // `Element type is invalid: expected a string … but got: undefined`
  // ——导入写错、导出名对不上、循环依赖都长这样。
  // ⚠️ 第一版这里是**静默跳过**的，于是这一整类错误一条都测不出来。
  if (type === undefined || type === null) {
    throw new Error(`Element type is invalid: got ${String(type)}（导入拿到了 undefined）`);
  }
  if (typeof type === "function") {
    trail.push((type as { name?: string }).name || "anonymous");
    const proto = (type as { prototype?: { isReactComponent?: unknown } }).prototype;
    if (proto?.isReactComponent) {
      const instance = new (type as new (p: unknown) => { render: () => unknown })(props);
      walk(instance.render(), trail, depth + 1);
    } else {
      walk((type as (p: unknown) => unknown)(props), trail, depth + 1);
    }
    trail.pop();
    return;
  }
  if (typeof type === "string") trail.push(type);
  if (props.children !== undefined) walk(props.children, trail, depth + 1);
  if (typeof type === "string") trail.pop();
}

const THEME = {
  colors: {
    surface0: "#000", surface1: "#111", surface2: "#222", border: "#333",
    foreground: "#fff", foregroundMuted: "#aaa", accent: "#4af", accentForeground: "#000",
    statusSuccess: "#0a0", statusWarning: "#fa0", statusDanger: "#f00",
  },
};

/** 时间线卡片的样本走 transformer，pill 的图标与 popover 直接渲染。 */
async function renderAll(): Promise<{ ok: number; failures: string[] }> {
  const { compilePlugin } = await import(COMPILER!);
  // ⭐ 0.8 起是两个入口：compilePlugin({ client, server })
  const root = join(import.meta.dirname, "..");
  const { clientBundle } = (await compilePlugin({
    client: join(root, "index.client.tsx"),
    server: join(root, "index.server.ts"),
  })) as { clientBundle: string };
  const require_ = createRequire(join(root, "package.json"));

  // ⭐ 图元桩成**字符串**宿主组件，不是返回 null 的函数 —— 见文件头
  const HOSTS = ["View", "Text", "Pressable", "ScrollView", "ActivityIndicator", "Image", "TextInput", "FlatList", "TouchableOpacity"];
  const base: Record<string, unknown> = Object.fromEntries(HOSTS.map((name) => [name, name]));
  base.StyleSheet = { create: (style: unknown) => style, flatten: (style: unknown) => style };
  base.Platform = { OS: "android", select: (o: Record<string, unknown>) => o.android ?? o.default };
  base.NativeModules = {};
  const reactNative = new Proxy(base, {
    get: (target, key) => (key in target ? target[key as string] : typeof key === "string" ? key : undefined),
    has: () => true,
  });

  const resolve = (id: string): unknown => {
    if (id === "react-native") return reactNative;
    if (id === "@getpaseo/plugin/client") {
      // 0.8 把 hooks 挪到了 /client
      return {
        useRpc: () => async () => ({}), useAgent: () => undefined,
        useWorkspace: () => undefined, usePaseo: () => ({}), useSettings: () => ({}),
      };
    }
    if (id === "@getpaseo/plugin/client/react-native") {
      const Modal = Object.assign((props: { children?: unknown }) => props?.children ?? null, {
        Content: (props: { children?: unknown }) => props?.children ?? null,
      });
      return { Icon: "Icon", Modal, useToast: () => () => {} };
    }
    if (id === "@tanstack/react-query") return {
      useQuery: () => ({ data: undefined, error: null, isLoading: false, isFetching: false, refetch: async () => {} }),
      useMutation: () => ({ mutate: () => {}, isPending: false }),
      useQueryClient: () => ({ setQueryData: () => {}, invalidateQueries: async () => {} }),
    };
    // 0.8 的核心只剩 defineRpc / defineSettings / 契约类型
    try { return require_(id); } catch { return new Proxy({}, { get: () => () => null }); }
  };

  const transformers: Array<{ id: string; transform: (input: unknown) => { items?: Array<{ kind: string }> } | undefined }> = [];
  const renderers = new Map<string, { Component: unknown }>();
  // ⭐ pill 的 icon 与 popover Content 都是组件，两个都要渲染一遍。
  // 只验时间线卡片是不够的 —— 实测漏过一次。
  const surfaces: Array<{ id: string; Component: unknown }> = [];
  const noop = () => {};
  const client = {
    addTimelineTransformer: (c: never) => { transformers.push(c); return noop; },
    addTimelineRenderer: (c: { kind: string; Component: unknown }) => { renderers.set(c.kind, c); return noop; },
    // ⭐ 面板也要渲染 —— 它和 popover 是同一份内容的两个出口，
    // 但走的是 ContentShell 的另一个分支（自带滚动/内边距/flex）。
    addWorkspacePanel: (c: { id: string; Component: unknown }) => {
      surfaces.push({ id: `panel:${c.id}`, Component: c.Component });
      return noop;
    },
    addCommandCenterItem: () => noop,
    addSurface: () => noop, addSidebarItem: () => noop, addAttachmentSource: () => noop,
    addTheme: () => noop, addSettingsScreen: () => noop, addSlashCommand: () => noop,
    addHeaderButton: () => ({ update: noop, remove: noop }),
    addComposerPill: (c: { id: string; button: { icon: unknown; behavior: { Content?: unknown } } }) => {
      surfaces.push({ id: `pill-icon:${c.id}`, Component: c.button.icon });
      surfaces.push({ id: `pill-popover:${c.id}`, Component: c.button.behavior.Content });
      return { update: noop, remove: noop };
    },
    openPanel: noop, openSurface: noop, openSettings: noop,
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
  const cleanup = ((exports.default ?? exports) as (c: typeof client) => (() => void) | undefined)(client);
  await new Promise((done) => setTimeout(done, 30));

  const HOST_PROPS = {
    theme: THEME,
    host: { id: "pi-kit", label: "Pi Kit" },
    layout: { compact: false, platform: "android" },
  };

  const failures: string[] = [];
  let ok = 0;

  for (const fixture of NOTICE_FIXTURES) {
    const item = { type: "assistant_message", text: fixture.content };
    for (const transformer of transformers) {
      let produced;
      try {
        produced = transformer.transform({ item });
      } catch (error) {
        failures.push(`${fixture.name} / transform ${transformer.id}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      for (const entry of produced?.items ?? []) {
        const renderer = renderers.get(entry.kind);
        if (!renderer) continue;
        const trail: string[] = [];
        try {
          walk(React.createElement(renderer.Component as never, {
            ...HOST_PROPS, item: entry, context: "agent", agentId: "a1", workspaceId: "w1",
          } as never), trail);
          ok++;
        } catch (error) {
          failures.push(`${fixture.name} / ${entry.kind}: ${error instanceof Error ? error.message : String(error)}\n    路径 ${trail.join(" › ")}`);
        }
      }
    }
  }

  for (const surface of surfaces) {
    const trail: string[] = [];
    try {
      walk(React.createElement(surface.Component as never, {
        ...HOST_PROPS, context: "agent", agentId: "a1", workspaceId: "w1",
        size: 14, color: "#aaa", close: () => {},
      } as never), trail);
      ok++;
    } catch (error) {
      failures.push(`${surface.id}: ${error instanceof Error ? error.message : String(error)}\n    路径 ${trail.join(" › ")}`);
    }
  }

  cleanup?.();
  return { ok, failures };
}

const skip = COMPILER ? false : "本机没有全局 @getpaseo/cli";

test("⭐ 所有卡片都渲染得出来", { skip }, async () => {
  const { ok, failures } = await renderAll();
  assert.deepEqual(failures, [], `\n${failures.join("\n")}\n`);
  // 9 条样本 + 3 个面板 + 3 个 pill
  // 9 条通知样本 + 3 个 pill 图标 + 3 个 popover + 3 个面板
  assert.ok(ok >= NOTICE_FIXTURES.length + 9, `只渲染了 ${ok} 个界面`);
});

test("⭐ 在没有 Intl 的运行时上也渲染得出来（安卓 Hermes）", { skip }, async () => {
  // 安卓的 Paseo 跑 Hermes，而 RN 的 Hermes 常常不带 Intl。
  // ⚠️ 正常模式测不出这个 —— Node 有完整 Intl，一路绿灯，投到手机上才炸。
  const savedIntl = (globalThis as { Intl?: unknown }).Intl;
  const savedNumber = Number.prototype.toLocaleString;
  const savedDate = Date.prototype.toLocaleString;
  const savedCompare = String.prototype.localeCompare;
  const boom = function (): never { throw new TypeError("Object is not a function"); };
  (globalThis as { Intl?: unknown }).Intl = undefined;
  Number.prototype.toLocaleString = boom;
  Date.prototype.toLocaleString = boom;
  String.prototype.localeCompare = boom as never;
  try {
    const { ok, failures } = await renderAll();
    assert.deepEqual(failures, [], `\n${failures.join("\n")}\n`);
    assert.ok(ok >= NOTICE_FIXTURES.length);
  } finally {
    (globalThis as { Intl?: unknown }).Intl = savedIntl;
    Number.prototype.toLocaleString = savedNumber;
    Date.prototype.toLocaleString = savedDate;
    String.prototype.localeCompare = savedCompare;
  }
});
