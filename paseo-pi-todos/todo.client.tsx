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
import { latestTodoRpc, type TodoBoard, type TodoTask } from "./contracts.shared";

function statusMeta(status: TodoTask["status"], theme: PluginTheme) {
  if (status === "completed") return { icon: "CheckCircle2", label: "完成", color: theme.colors.statusSuccess };
  if (status === "in_progress") return { icon: "LoaderCircle", label: "进行中", color: theme.colors.accent };
  if (status === "deleted") return { icon: "CircleOff", label: "已删除", color: theme.colors.foregroundMuted };
  return { icon: "Circle", label: "待处理", color: theme.colors.foregroundMuted };
}

function actionLabel(board: TodoBoard): string {
  const suffix = board.changedId === undefined ? "" : ` #${board.changedId}`;
  return ({
    create: `新增任务${suffix}`,
    update: `更新任务${suffix}`,
    delete: `删除任务${suffix}`,
    clear: "清空任务",
    list: "刷新任务",
    get: `查看任务${suffix}`,
    snapshot: "任务状态",
  } as Record<string, string>)[board.action] ?? "任务状态更新";
}

function BoardView({
  board,
  theme,
  compact,
  initiallyExpanded = false,
}: {
  board: TodoBoard;
  theme: PluginTheme;
  compact: boolean;
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
        borderRadius: 12,
        backgroundColor: theme.colors.surface1,
      },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
    }),
    [compact, theme],
  );

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 }}>
          <Icon name="ListTodo" size={17} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.foreground, fontWeight: "800", fontSize: 15 }}>Pi 任务进度</Text>
        </View>
        <Text style={{ color: theme.colors.foreground, fontWeight: "800" }}>{completed}/{liveTasks.length}</Text>
      </View>

      <View style={{ height: 7, borderRadius: 4, backgroundColor: theme.colors.surface2, overflow: "hidden" }}>
        <View style={{ width: `${percent}%`, height: 7, backgroundColor: theme.colors.accent, borderRadius: 4 }} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Text style={styles.muted}>{actionLabel(board)}</Text>
        <Text style={{ color: running.length ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 12 }}>进行中 {running.length}</Text>
        <Text style={styles.muted}>待处理 {pending.length}</Text>
        <Text style={styles.muted}>{percent}%</Text>
      </View>

      {visibleTasks.length === 0 ? <Text style={styles.muted}>当前没有任务</Text> : null}
      {visibleTasks.map((task) => {
        const meta = statusMeta(task.status, theme);
        return (
          <View
            key={String(task.id)}
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 8,
              padding: 9,
              borderRadius: 9,
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
                <Text style={{ color: meta.color, fontSize: 11, fontWeight: "700" }}>{meta.label}</Text>
              </View>
              {task.status === "in_progress" && task.activeForm ? (
                <Text style={{ color: theme.colors.accent, fontSize: 12 }}>{task.activeForm}</Text>
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
            {expanded ? "收起任务列表" : `查看全部 ${liveTasks.length} 项`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function TodoTimelineCard({ item, theme, layout }: PluginTimelineItemProps<TodoBoard>) {
  return <BoardView board={item.data} theme={theme} compact={layout.compact} />;
}

const cardOpeners = new Map<string, () => void>();

function TodoStatusPill({ theme, host, layout, agentId }: PluginComposerPillProps) {
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
      <Modal title="Pi Todo List" open={open} onOpenChange={setOpen}>
        <Modal.Content>
          <ScrollView style={{ maxHeight: layout.compact ? 520 : 620 }} contentContainerStyle={{ padding: 12 }}>
            {query.isLoading ? <ActivityIndicator color={theme.colors.accent} /> : null}
            {query.error ? <Text style={{ color: theme.colors.statusDanger }}>{query.error instanceof Error ? query.error.message : String(query.error)}</Text> : null}
            {board ? <BoardView board={board} theme={theme} compact={layout.compact} initiallyExpanded /> : null}
            {!query.isLoading && !query.error && !board ? <Text style={{ color: theme.colors.foregroundMuted }}>这个 Agent 还没有 Pi todo 数据。</Text> : null}
          </ScrollView>
        </Modal.Content>
      </Modal>
    </>
  );
}

export function contributeTodoPills(client: PluginClientContext) {
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
        title: "Open Pi todo list",
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
