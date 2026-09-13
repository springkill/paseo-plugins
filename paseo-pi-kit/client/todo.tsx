/**
 * Pi 任务列表。
 *
 * 时间线卡片、composer pill、explorer 侧边面板三处共用同一个 `BoardView`。
 * 视觉全部走 `ui/tokens.client.tsx` —— 这张卡片曾经有 4 处 `<Text>` 漏写字号，
 * 在同一条时间线上比邻居小一号。
 */

import type { PluginCleanup, PluginTheme } from "@getpaseo/plugin";
import {
  type PluginAgentPanelProps,
  type PluginClientContext,
  type PluginTimelineItemProps,
  useAgent,
  useRpc,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { latestTodoRpc, type TodoBoard, type TodoTask } from "../shared/contracts";
import { translator, type Translator } from "../shared/i18n";
import { localeFromTag } from "../shared/locale";
import { registerAgentPill, type AgentPillContentProps, type AgentPillIconProps, type PushLabel } from "./pill";
import { detectClientLocale, LanguagePicker, useLocale } from "./locale";
import {
  CardHeader,
  CardShell,
  CardTitle,
  ErrorText,
  EmptyState,
  ExpandToggle,
  ICON,
  MetaRow,
  ContentShell,
  useSurfaceKind,
  ProgressBar,
  RowShell,
  SPACE,
  text,
  type Tone,
} from "./tokens";

function statusMeta(status: TodoTask["status"], theme: PluginTheme, t: Translator): {
  icon: string;
  label: string;
  color: string;
  tone: Tone | undefined;
} {
  if (status === "completed") return { icon: "CircleCheck", label: t.status_completed, color: theme.colors.statusSuccess, tone: "ok" };
  if (status === "in_progress") return { icon: "LoaderCircle", label: t.status_in_progress, color: theme.colors.accent, tone: undefined };
  if (status === "deleted") return { icon: "CircleOff", label: t.status_deleted, color: theme.colors.foregroundMuted, tone: undefined };
  return { icon: "Circle", label: t.status_pending, color: theme.colors.foregroundMuted, tone: undefined };
}

function actionLabel(board: TodoBoard, t: Translator): string {
  const suffix = board.changedId === undefined ? "" : ` #${board.changedId}`;
  return ({
    create: t.action_create(suffix),
    update: t.action_update(suffix),
    delete: t.action_delete(suffix),
    clear: t.action_clear,
    list: t.action_list,
    get: t.action_get(suffix),
    snapshot: t.action_snapshot,
  } as Record<string, string>)[board.action] ?? t.action_default;
}

function TaskRow({ task, theme, t, expanded }: {
  task: TodoTask;
  theme: PluginTheme;
  t: Translator;
  expanded: boolean;
}) {
  const meta = statusMeta(task.status, theme, t);
  const active = task.status === "in_progress";
  return (
    <View style={{ opacity: task.status === "completed" ? 0.72 : 1 }}>
      <RowShell theme={theme} active={active}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACE.gap }}>
          <Icon name={meta.icon} size={ICON.row} color={meta.color} />
          <View style={{ flex: 1, gap: SPACE.hair }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: SPACE.gap }}>
              <Text style={text(theme, "rowTitle", { flex: 1 })}>#{task.id} {task.subject}</Text>
              <Text style={text(theme, "meta", { strong: true, ...(meta.tone ? { tone: meta.tone } : {}) })}>
                {meta.label}
              </Text>
            </View>
            {active && task.activeForm ? (
              <Text style={text(theme, "body", { accent: true })}>{task.activeForm}</Text>
            ) : null}
            {(expanded || active) && task.description ? (
              <Text style={text(theme, "body", { muted: true })}>{task.description}</Text>
            ) : null}
            {expanded && task.blockedBy?.length ? (
              <Text style={text(theme, "meta", { muted: true })}>
                {t.todo_blocked_by(task.blockedBy.map((id) => `#${id}`).join(", "))}
              </Text>
            ) : null}
          </View>
        </View>
      </RowShell>
    </View>
  );
}

function BoardView({ board, theme, compact, t, initiallyExpanded = false }: {
  board: TodoBoard;
  theme: PluginTheme;
  compact: boolean;
  t: Translator;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const liveTasks = board.tasks.filter((task) => task.status !== "deleted");
  const completed = liveTasks.filter((task) => task.status === "completed").length;
  const running = liveTasks.filter((task) => task.status === "in_progress");
  const pending = liveTasks.filter((task) => task.status === "pending");
  const percent = liveTasks.length === 0 ? 0 : Math.round((completed / liveTasks.length) * 100);
  const preview = running.length > 0
    ? [...running, ...pending.slice(0, 2)]
    : liveTasks.every((task) => task.status === "completed")
      ? liveTasks.slice(-3)
      : pending.slice(0, 3);
  const visibleTasks = expanded ? liveTasks : preview;
  const inPopover = useSurfaceKind() === "popover";

  return (
    <CardShell theme={theme} compact={compact}>
      {/* ⚠️ popover 的外壳已经画了标题和 `3/7 完成`，这里再画一遍就是重复。
          时间线上没有那层外壳，标题必须留着。 */}
      {inPopover ? null : (
        <CardHeader
          trailing={<Text style={text(theme, "rowTitle")}>{completed}/{liveTasks.length}</Text>}
        >
          <Icon name="ListTodo" size={ICON.card} color={theme.colors.accent} />
          <CardTitle label={t.todo_title} theme={theme} />
        </CardHeader>
      )}

      <ProgressBar percent={percent} theme={theme} />

      <MetaRow>
        <Text style={text(theme, "meta", { muted: true })}>{actionLabel(board, t)}</Text>
        <Text style={text(theme, "meta", running.length ? { accent: true } : { muted: true })}>
          {t.count_running(running.length)}
        </Text>
        <Text style={text(theme, "meta", { muted: true })}>{t.count_pending(pending.length)}</Text>
        <Text style={text(theme, "meta", { muted: true })}>{percent}%</Text>
      </MetaRow>

      {visibleTasks.length === 0 ? <EmptyState label={t.todo_empty} theme={theme} /> : null}
      {visibleTasks.map((task) => (
        <TaskRow key={String(task.id)} task={task} theme={theme} t={t} expanded={expanded} />
      ))}

      {liveTasks.length > preview.length ? (
        <ExpandToggle
          expanded={expanded}
          onPress={() => setExpanded((value) => !value)}
          theme={theme}
          moreLabel={t.todo_expand(liveTasks.length)}
          lessLabel={t.todo_collapse}
        />
      ) : null}
    </CardShell>
  );
}

export function TodoTimelineCard({ item, theme, layout, host }: PluginTimelineItemProps<TodoBoard>) {
  const { t } = useLocale(host.id);
  return <BoardView board={item.data} theme={theme} compact={layout.compact} t={t} />;
}

function useTodoBoard(agentId: string, hostId: string) {
  const latestTodo = useRpc(latestTodoRpc);
  const agentStatus = useAgent(agentId, (agent) => agent.status);
  return useQuery({
    queryKey: ["pi-todos", hostId, agentId],
    queryFn: () => latestTodo({ agentId }),
    refetchInterval: agentStatus === "running" ? 5_000 : 30_000,
    retry: 1,
  });
}

/**
 * pill 的图标。
 *
 * ⭐ 它同时负责把**活标签**推上去 —— 0.8 的 `label` 是普通字符串，没法在渲染里
 * 直接写「3/7 完成 · 读取配置」。图标组件本来就拿着数据，顺手算完推给
 * `registration.update({ label })`，只有一个数据源，不会对不上。见 client/pill.tsx。
 */
function createTodoPillIcon(push: PushLabel) {
  return function TodoPillIcon({ theme, host, agentId, size, color }: AgentPillIconProps) {
    const { t } = useLocale(host.id);
    const query = useTodoBoard(agentId, host.id);
    const board = query.data?.board;
    const live = board?.tasks.filter((task) => task.status !== "deleted") ?? [];
    const completed = live.filter((task) => task.status === "completed").length;
    const active = live.find((task) => task.status === "in_progress");
    const label = query.isLoading
      ? t.todo_pill_loading
      : board
        ? `${t.todo_progress(completed, live.length)}${active ? ` · ${active.activeForm ?? active.subject}` : ""}`
        : t.todo_pill_idle;

    useEffect(() => { push(label); }, [label]);

    if (query.isFetching && !board) {
      return <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />;
    }
    return <Icon name="ListTodo" size={size} color={active ? theme.colors.accent : color} />;
  };
}

/**
 * 点 pill 弹出的任务列表。
 *
 * ⭐ 0.7 时这是个注册到 explorer 侧栏的面板。0.8 改成 popover —— explorer
 * 在窄屏上根本不存在（见 docs/card-design.md §5），popover 两端都能用。
 */
function TodoPopoverBody({ theme, host, layout, agentId, shell }: AgentPillContentProps & { shell: "popover" | "panel" }) {
  const localeCtx = useLocale(host.id);
  const t = localeCtx.t;
  const query = useTodoBoard(agentId, host.id);
  const board = query.data?.board;
  const live = board?.tasks.filter((task) => task.status !== "deleted") ?? [];
  const completed = live.filter((task) => task.status === "completed").length;

  return (
    <ContentShell
      kind={shell}
      theme={theme}
      compact={layout.compact}
      title={t.modal_todos}
      subtitle={board ? t.todo_progress(completed, live.length) : null}
      actions={query.isFetching ? <ActivityIndicator color={theme.colors.accent} /> : null}
      footer={<LanguagePicker ctx={localeCtx} hostId={host.id} theme={theme} />}
    >
      {query.error ? <ErrorText error={query.error} theme={theme} /> : null}
      {board ? <BoardView board={board} theme={theme} compact={layout.compact} t={t} initiallyExpanded /> : null}
      {!query.isLoading && !query.error && !board ? (
        <EmptyState label={t.todo_none_for_agent} theme={theme} />
      ) : null}
    </ContentShell>
  );
}

export function registerTodoPill(client: PluginClientContext): PluginCleanup {
  // ⚠️ 这里是注册时刻，不是 React 渲染，拿不到 useLocale。
  // pill 的标题只是兜底文案，用客户端自己的语言足够；
  // 用户真正阅读的弹出内容走完整的服务端判定（含共享设置）。
  const t = translator(localeFromTag(detectClientLocale()) ?? "en");
  return registerAgentPill(client, {
    id: "pi-todos",
    title: t.nav_open_todos,
    piOnly: true,
    createIcon: createTodoPillIcon,
    Content: TodoPopover,
  });
}

/**
 * 两个出口，同一份内容。
 *
 * - `TodoPopover` —— composer pill 点开的 popover（两端都可用）
 * - `TodoPanel` —— 面板。**只有桌面 web 才可能落到 explorer 侧栏**
 *   （宿主 `supportsDesktopPaneSplits()` 直接 `return isWeb`）；
 *   原生端会退回主区标签页。见 client/open-panel.ts。
 */
export function TodoPopover(props: AgentPillContentProps) {
  return <TodoPopoverBody {...props} shell="popover" />;
}

export function TodoPanel(props: PluginAgentPanelProps) {
  return <TodoPopoverBody {...props} close={() => {}} shell="panel" />;
}
