/**
 * composer pill 的注册机制（0.8 按钮描述符模型）。
 *
 * ## 0.8 变了什么
 *
 * 0.7 的 pill 是**一个 React 组件** —— 组件自己拿数据、自己画图标和文字，
 * `onPress` 另给。0.8 改成**按钮描述符**：
 *
 * ```ts
 * client.addComposerPill({
 *   id, workspaceId, agentId,
 *   button: { title, icon, label?, behavior },
 * })  // → { update(patch), remove() }
 * ```
 *
 * `icon` 仍可以是组件（`ComponentType<PluginButtonIconProps>`），但 **`label`
 * 是个普通字符串**。所以「3/7 完成 · 读取配置」这种活标签没法在渲染里直接写。
 *
 * ⭐ 做法：图标组件本来就拿着数据，让它把算好的标签**推上去**
 * （`registration.update({ label })`）。只有一个数据源，不会和 pill 各查一遍
 * 导致对不上。
 *
 * ## behavior 用 popover
 *
 * 0.7 时三个 pill 点开的是 explorer 侧栏面板，而 explorer 在窄屏上**根本不存在**
 * （宿主：`isCompact ? "overlay" : supportsDesktopPaneSplits() ? "pane" : "dock"`，
 * 且 `supportsDesktopPaneSplits` 直接 `return isWeb`），手机上点了只会抛
 * `"Explorer is unavailable"`。0.8 新增的 `kind: "popover"` 两端都能用。
 * 见 docs/card-design.md §5。
 */

import type { PluginCleanup } from "@getpaseo/plugin";
import type {
  PluginButtonContentProps,
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import { withCardBoundary } from "./card-boundary";

/** 算好的标签往上推；组件卸载后调用是安全的（update 幂等且移除后无效）。 */
export type PushLabel = (label: string) => void;

/**
 * ⭐ `PluginButtonContext` 是 workspace | agent 的**联合**，`agentId` 只在
 * agent 那一支上。而 composer pill 一定是 agent 作用域 ——
 * `PluginComposerPillContribution extends PluginHeaderButtonContribution { agentId: string }`
 * 强制要求它。所以在这里收窄一次，各 pill 模块就不用逐个 narrow。
 */
export type AgentPillIconProps = Extract<PluginButtonIconProps, { context: "agent" }>;
export type AgentPillContentProps = Extract<PluginButtonContentProps, { context: "agent" }>;

export interface AgentPillSpec {
  id: string;
  /** tooltip / 标签兜底。注册时刻拿不到 useLocale，用客户端自己的语言就够。 */
  title: string;
  /** 只给 Pi agent 装（任务、subagents 是 Pi 专有的）。 */
  piOnly: boolean;
  /** 图标组件工厂 —— 拿到 push 之后把活标签推上去。 */
  createIcon(push: PushLabel): ComponentType<AgentPillIconProps>;
  /** 点开后弹出的内容。 */
  Content: ComponentType<AgentPillContentProps>;
}

function isPiAgent(provider: string | undefined): boolean {
  return provider === "pi" || provider?.startsWith("pi/") === true;
}

/**
 * 按 agent 挂 / 摘 pill，跟着 agent 列表走。
 *
 * ⚠️ Paseo 对每次状态或消息变化都会发 upsert。每次都重新注册会和 React 的
 * 卸载清理赛跑，把已经显示出来的 pill 弄成哑的 —— 所以 workspaceId 没变就不动。
 */
export function registerAgentPill(client: PluginClientContext, spec: AgentPillSpec): PluginCleanup {
  const pills = new Map<string, { workspaceId: string; registration: PluginButtonRegistration }>();
  let active = true;

  function remove(agentId: string) {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
  }

  function upsert(agent: { id: string; workspaceId?: string; archivedAt?: string | null; provider?: string }) {
    if (!active || !agent.workspaceId || agent.archivedAt || (spec.piOnly && !isPiAgent(agent.provider))) {
      remove(agent.id);
      return;
    }
    const existing = pills.get(agent.id);
    if (existing?.workspaceId === agent.workspaceId) return;
    remove(agent.id);

    const { id: agentId, workspaceId } = agent;
    // ⚠️ 图标组件要拿到 registration 才能推标签，而 registration 又要先有图标 ——
    // 用一个可变持有量打破这个环。图标是组件，第一次渲染必然晚于下面的赋值。
    let handle: PluginButtonRegistration | undefined;
    const IconComponent = withCardBoundary(
      `${spec.id}-icon`,
      spec.createIcon((label) => handle?.update({ label })),
    );
    handle = client.addComposerPill({
      id: spec.id,
      workspaceId,
      agentId,
      button: {
        title: spec.title,
        label: spec.title,
        // ⚠️ 这两处 cast 是安全的：addComposerPill 保证渲染时 context 一定是
        // "agent"（见上面 AgentPillIconProps 的说明）。组件声明的是窄类型，
        // 函数参数逆变会让 TS 拒绝，但运行时契约是成立的。
        icon: IconComponent as ComponentType<PluginButtonIconProps>,
        behavior: {
          kind: "popover",
          Content: withCardBoundary(`${spec.id}-popover`, spec.Content) as ComponentType<PluginButtonContentProps>,
        },
      },
    });
    pills.set(agentId, { workspaceId, registration: handle });
  }

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "upsert") upsert(update.agent);
    else remove(update.agentId);
  });

  void client.paseo.agents.list({}).then(({ entries }) => {
    if (!active) return;
    for (const { agent } of entries) upsert(agent);
  }).catch((error) => console.error(`[${spec.id}] failed to seed composer pills`, error));

  return () => {
    active = false;
    unsubscribe();
    for (const { registration } of pills.values()) registration.remove();
    pills.clear();
  };
}
