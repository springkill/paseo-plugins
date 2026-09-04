import {
  type PluginClientContext,
  type PluginComposerPillProps,
  type PluginTheme,
  type PluginTimelineItemProps,
  useAgent,
  useRpc,
} from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { latestTodoRpc, type TodoBoard, type TodoTask } from "../domain/contracts.shared";
import { translator, type Translator } from "../domain/i18n.shared";
import { localeFromTag } from "../domain/locale.shared";
import { detectClientLocale, LanguagePicker, useLocale } from "./locale.client";
import { CardHeader, CardShell, CardTitle, FONT, LINE, ProgressBar, RADIUS, SPACE } from "./tokens.client";

function statusMeta(status: TodoTask["status"], theme: PluginTheme, t: Translator) {
  if (status === "completed") return { icon: "CheckCircle2", label: t.status_completed, color: theme.colors.statusSuccess };
  if (status === "in_progress") return { icon: "LoaderCircle", label: t.status_in_progress, color: theme.colors.accent };
  if (status === "deleted") return { icon: "CircleOff", label: t.status_deleted, color: theme.colors.foregroundMuted };
  return { icon: "Circle", label: t.status_pending, color: theme.colors.foregroundMuted };
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

function BoardView({
  board,
  theme,
  compact,
  t,
  initiallyExpanded = false,
}: {
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
  const styles = useMemo(
    () => ({
      card: {
        gap: compact ? 8 : 10,
        padding: compact ? 10 : 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: RADIUS.card,
        backgroundColor: theme.colors.surface1,
      },
      muted: { color: theme.colors.foregroundMuted, fontSize: FONT.body },
    }),
    [compact, theme],
  );

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 }}>
          <Icon name="ListTodo" size={17} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.foreground, fontWeight: "800", fontSize: FONT.cardTitle }}>{t.todo_title}</Text>
        </View>
        <Text style={{ color: theme.colors.foreground, fontWeight: "800" }}>{completed}/{liveTasks.length}</Text>
      </View>

      <ProgressBar percent={percent} theme={theme} />

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Text style={styles.muted}>{actionLabel(board, t)}</Text>
        <Text style={{ color: running.length ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: FONT.body }}>{t.count_running(running.length)}</Text>
        <Text style={styles.muted}>{t.count_pending(pending.length)}</Text>
        <Text style={styles.muted}>{percent}%</Text>
      </View>

      {visibleTasks.length === 0 ? <Text style={styles.muted}>{t.todo_empty}</Text> : null}
      {visibleTasks.map((task) => {
        const meta = statusMeta(task.status, theme, t);
        return (
          <View
            key={String(task.id)}
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 8,
              padding: 9,
              borderRadius: RADIUS.row,
              borderWidth: task.status === "in_progress" ? 1 : 0,
              borderColor: task.status === "in_progress" ? theme.colors.accent : theme.colors.border,
              backgroundColor: task.status === "in_progress" ? theme.colors.surface2 : theme.colors.surface0,
              opacity: task.status === "completed" ? 0.72 : 1,
            }}
          >
            <Icon name={meta.icon} size={16} color={meta.color} />
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ color: theme.colors.foreground, fontWeight: task.status === "in_progress" ? "700" : "600", flex: 1 }}>
                  #{task.id} {task.subject}
                </Text>
                <Text style={{ color: meta.color, fontSize: FONT.meta, fontWeight: "700" }}>{meta.label}</Text>
              </View>
              {task.status === "in_progress" && task.activeForm ? (
                <Text style={{ color: theme.colors.accent, fontSize: FONT.body }}>{task.activeForm}</Text>
              ) : null}
              {(expanded || task.status === "in_progress") && task.description ? (
                <Text style={styles.muted}>{task.description}</Text>
              ) : null}
              {expanded && task.blockedBy?.length ? (
                <Text style={styles.muted}>依赖：{task.blockedBy.map((id) => `#${id}`).join(", ")}</Text>
              ) : null}
            </View>
          </View>
        );
      })}

      {liveTasks.length > preview.length ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded((value) => !value)}
          style={{ alignSelf: "flex-start", paddingVertical: 4 }}
        >
          <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>
            {expanded ? t.todo_collapse : t.todo_expand(liveTasks.length)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function TodoTimelineCard({ item, theme, layout, host }: PluginTimelineItemProps<TodoBoard>) {
  const { t } = useLocale(host.id);
  return <BoardView board={item.data} theme={theme} compact={layout.compact} t={t} />;
}

const cardOpeners = new Map<string, () => void>();

function TodoStatusPill({ theme, host, layout, agentId }: PluginComposerPillProps) {
  const localeCtx = useLocale(host.id);
  const t = localeCtx.t;
  const latestTodo = useRpc(latestTodoRpc);
  const agentStatus = useAgent(agentId, (agent) => agent.status);
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["pi-todos", host.id, agentId],
    queryFn: () => latestTodo({ agentId }),
    refetchInterval: agentStatus === "running" ? 5_000 : 30_000,
    retry: 1,
  });

  useEffect(() => {
    const openCard = () => setOpen(true);
    cardOpeners.set(agentId, openCard);
    return () => {
      if (cardOpeners.get(agentId) === openCard) cardOpeners.delete(agentId);
    };
  }, [agentId]);

  const board = query.data?.board;
  const live = board?.tasks.filter((task) => task.status !== "deleted") ?? [];
  const completed = live.filter((task) => task.status === "completed").length;
  const active = live.find((task) => task.status === "in_progress");
  const label = query.isLoading
    ? "Pi Tasks…"
    : board
      ? `${completed}/${live.length}${active ? ` · ${active.activeForm ?? active.subject}` : ""}`
      : "Pi Tasks";

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
        {query.isFetching && !board ? (
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        ) : (
          <Icon name="ListTodo" size={14} color={active ? theme.colors.accent : theme.colors.foregroundMuted} />
        )}
        <Text numberOfLines={1} style={{ color: active ? theme.colors.accent : theme.colors.foregroundMuted, fontWeight: "600", flexShrink: 1 }}>
          {label}
        </Text>
      </View>
      <Modal title={t.modal_todos} open={open} onOpenChange={setOpen}>
        <Modal.Content>
          <ScrollView style={{ maxHeight: layout.compact ? 520 : 620 }} contentContainerStyle={{ padding: 12 }}>
            {query.isLoading ? <ActivityIndicator color={theme.colors.accent} /> : null}
            {query.error ? <Text style={{ color: theme.colors.statusDanger }}>{query.error instanceof Error ? query.error.message : String(query.error)}</Text> : null}
            {board ? <BoardView board={board} theme={theme} compact={layout.compact} t={t} initiallyExpanded /> : null}
            {!query.isLoading && !query.error && !board ? <Text style={{ color: theme.colors.foregroundMuted }}>{t.todo_none_for_agent}</Text> : null}
            <LanguagePicker ctx={localeCtx} hostId={host.id} theme={theme} />
          </ScrollView>
        </Modal.Content>
      </Modal>
    </>
  );
}

export function contributeTodoPills(client: PluginClientContext) {
  // ⚠️ 这里是注册时刻，不是 React 渲染，拿不到 useLocale。
  // pill 的 title 只是个 tooltip，用客户端自己的语言足够；
  // 用户真正阅读的弹窗内容走完整的服务端判定（含共享设置）。
  const t = translator(localeFromTag(detectClientLocale()) ?? "en");
  const pills = new Map<string, { workspaceId: string; remove: () => void }>();
  let active = true;

  function remove(agentId: string) {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
    cardOpeners.delete(agentId);
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
        Component: TodoStatusPill,
        onPress() {
          cardOpeners.get(agentId)?.();
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
    cardOpeners.clear();
  };
}
