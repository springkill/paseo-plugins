/**
 * Pi 任务列表。
 *
 * 时间线卡片、composer pill、explorer 侧边面板三处共用同一个 `BoardView`。
 * 视觉全部走 `ui/tokens.client.tsx` —— 这张卡片曾经有 4 处 `<Text>` 漏写字号，
 * 在同一条时间线上比邻居小一号。
 */

import {
  type PluginClientContext,
  type PluginAgentPanelProps,
  type PluginComposerPillProps,
  type PluginTheme,
  type PluginTimelineItemProps,
  useAgent,
  useRpc,
} from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { latestTodoRpc, type TodoBoard, type TodoTask } from "../domain/contracts.shared";
import { translator, type Translator } from "../domain/i18n.shared";
import { localeFromTag } from "../domain/locale.shared";
import { withCardBoundary } from "./card-boundary.client";
import { openPanelPreferExplorer } from "./open-panel.client";
import { detectClientLocale, LanguagePicker, useLocale } from "./locale.client";
import {
  CardHeader,
  CardShell,
  CardTitle,
  ErrorText,
  EmptyState,
  ExpandToggle,
  ICON,
  MetaRow,
  PanelShell,
  ProgressBar,
  RowShell,
  SPACE,
  text,
  type Tone,
} from "./tokens.client";

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

  return (
    <CardShell theme={theme} compact={compact}>
      <CardHeader
        trailing={<Text style={text(theme, "rowTitle")}>{completed}/{liveTasks.length}</Text>}
      >
        <Icon name="ListTodo" size={ICON.card} color={theme.colors.accent} />
        <CardTitle label={t.todo_title} theme={theme} />
      </CardHeader>

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

function TodoStatusPill({ theme, host, agentId }: PluginComposerPillProps) {
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

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.tight, flexShrink: 1 }}>
      {query.isFetching && !board ? (
        <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
      ) : (
        <Icon name="ListTodo" size={ICON.row} color={active ? theme.colors.accent : theme.colors.foregroundMuted} />
      )}
      <Text numberOfLines={1} style={text(theme, "meta", { strong: true, ...(active ? { accent: true } : { muted: true }) })}>
        {label}
      </Text>
    </View>
  );
}

/**
 * 任务列表面板。
 *
 * ⭐ 点 composer pill 打开的就是这个 —— 它跟文件树、git 变更树在同一个
 * explorer 容器里并列（宿主的 panel manifest：`files` / `changes_tree` 都是
 * `hosts: ["explorer"]`，插件面板是 `["main","explorer"]`）。
 * 好处是能一直开着对照看，不像 Modal 那样遮住整个对话。
 */
export function PiTodoPanel({ theme, host, layout, agentId }: PluginAgentPanelProps) {
  const localeCtx = useLocale(host.id);
  const t = localeCtx.t;
  const query = useTodoBoard(agentId, host.id);
  const board = query.data?.board;
  const live = board?.tasks.filter((task) => task.status !== "deleted") ?? [];
  const completed = live.filter((task) => task.status === "completed").length;

  return (
    <PanelShell
      theme={theme}
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
    </PanelShell>
  );
}

export function contributeTodoPills(client: PluginClientContext) {
  // ⚠️ 这里是注册时刻，不是 React 渲染，拿不到 useLocale。
  // pill 的 title 只是个 tooltip，用客户端自己的语言足够；
  // 用户真正阅读的面板内容走完整的服务端判定（含共享设置）。
  const t = translator(localeFromTag(detectClientLocale()) ?? "en");
  const pills = new Map<string, { workspaceId: string; remove: () => void }>();
  let active = true;

  function remove(agentId: string) {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  }

  function upsert(agent: { id: string; workspaceId?: string; archivedAt?: string | null; provider?: string }) {
    const isPi = agent.provider === "pi" || agent.provider?.startsWith("pi/") === true;
    if (!active || !isPi || !agent.workspaceId || agent.archivedAt) {
      remove(agent.id);
      return;
    }
    const existing = pills.get(agent.id);
    if (existing?.workspaceId === agent.workspaceId) return;
    remove(agent.id);
    const { id: agentId, workspaceId } = agent;
    pills.set(agentId, {
      workspaceId,
      remove: client.addComposerPill({
        id: "pi-todos",
        title: t.nav_open_todos,
        workspaceId,
        agentId,
        Component: withCardBoundary("pi-todos-pill", TodoStatusPill),
        onPress() {
          // ⚠️ 不能直接写 location: "explorer" —— 手机上 explorer 是 overlay
          // 形态，没有可用的 pane，宿主会抛 "Explorer is unavailable"，
          // 点了就什么都不发生。见 ui/open-panel.client.ts。
          openPanelPreferExplorer(client.openPanel, "pi-todos", { workspaceId, agentId });
        },
      }),
    });
  }

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "upsert") upsert(update.agent);
    else remove(update.agentId);
  });

  return () => {
    active = false;
    unsubscribe();
    for (const registration of pills.values()) registration.remove();
    pills.clear();
  };
}
