/**
 * 卡片级错误边界 —— **把渲染异常显示在卡片里**。
 *
 * ## 为什么需要它
 *
 * 宿主自己有 `SurfaceErrorBoundary`，但它只渲染一行
 * `Plugin failed: <message>`，详细信息全进了 `console.warn`。
 * 而 `console.warn` 在**安卓 app 里拿不到** —— daemon 日志只有服务端那半边。
 *
 * 于是出现过这样的僵局：安卓上报 `Plugin failed: Object is not a function`，
 * 本机把同一批真实数据全渲染一遍却零失败（见 tests/render.test.ts）——
 * 因为 web 跑 react-native-web，安卓跑 Hermes，运行时不是一个。
 * 隔着设备边界猜是猜不出来的。
 *
 * ⭐ 所以这一层**抢在宿主边界之前接住**，把 message + 前几帧调用栈直接画在
 * 卡片位置上：截个图就够定位，不用来回传日志。同时也记进诊断缓冲区，
 * 由 clientSide 定时送回 daemon 日志。
 *
 * 平时它零成本 —— 没异常就是个透传的 children。
 */

import type { PluginTheme } from "@getpaseo/plugin";
import React from "react";
import { Text, View } from "react-native";
import { record } from "./report.client";
import { RADIUS, SPACE, text } from "./tokens.client";

/**
 * ⭐ 版本号要**画进错误消息里**。
 *
 * 踩过：修完一版之后用户回报「还是失败」，但截图上
 * `Plugin failed: Object is not a function` 与修复前**一字不差** ——
 * 没法判断是修没修好，还是 app 还在跑旧 bundle
 * （宿主只在 clientBundle 字符串变了才重新求值，app 不重连就不换）。
 *
 * 带上版本号，一张截图就能分辨。
 *
 * ⚠️ 必须与 package.json 一致 —— tests/portability.test.ts 会对账。
 */
const VERSION = "0.7.3";

type Props = { kind: string; theme: PluginTheme; children: React.ReactNode };
type State = { message: string | null; frames: string };

export class CardBoundary extends React.Component<Props, State> {
  override state: State = { message: null, frames: "" };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    // 前几帧就够指到组件；全栈在窄屏上没法看
    const frames = error instanceof Error
      ? (error.stack ?? "").split("\n").slice(1, 5).map((line) => line.trim()).join("\n")
      : "";
    return { message, frames };
  }

  override componentDidCatch(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? "").split("\n").slice(1, 6).join(" | ") : "";
    record(`RENDER FAILED v${VERSION} kind=${this.props.kind} msg=${message} stack=${stack}`);
  }

  override render(): React.ReactNode {
    const { message, frames } = this.state;
    if (message === null) return this.props.children;
    const { theme, kind } = this.props;
    return (
      <View
        style={{
          gap: SPACE.tight,
          padding: SPACE.row,
          borderRadius: RADIUS.card,
          borderWidth: 1,
          borderColor: theme.colors.statusDanger,
          backgroundColor: theme.colors.surface1,
        }}
      >
        <Text selectable style={text(theme, "rowTitle", { tone: "danger" })}>
          pi-kit {VERSION} · {kind}: {message}
        </Text>
        {frames ? (
          <Text selectable style={text(theme, "chip", { mono: true, muted: true })}>{frames}</Text>
        ) : null}
      </View>
    );
  }
}

/**
 * 把任意插件界面裹进边界 —— 时间线卡片、面板、composer pill 都要。
 *
 * ⚠️ 别只裹时间线卡片。宿主的 `SurfaceErrorBoundary` 同样包着面板和 pill，
 * 它们炸了也只会显示一行 `Plugin failed: <msg>`，细节同样进了 app 里的
 * `console.warn` —— 也就是同样查不了。
 */
export function withCardBoundary<P extends { theme: PluginTheme }>(
  kind: string,
  Component: React.ComponentType<P>,
): React.ComponentType<P> {
  function BoundedCard(props: P) {
    return (
      <CardBoundary kind={kind} theme={props.theme}>
        <Component {...props} />
      </CardBoundary>
    );
  }
  BoundedCard.displayName = `Bounded(${kind})`;
  return BoundedCard;
}
