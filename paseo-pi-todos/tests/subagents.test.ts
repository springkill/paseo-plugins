import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PluginHandlerContext } from "@getpaseo/plugin";
import { listSubagentCalls } from "../server/subagents.server";

function line(message: unknown, timestamp: string) {
  return JSON.stringify({ type: "message", timestamp, message });
}

function context(agentId: string, nativeHandle: string, returnedAgentId = agentId): PluginHandlerContext {
  return {
    paseo: {
      agents: {
        ref: () => ({
          timeline: {
            refetch: async () => ({
              agent: { id: returnedAgentId, provider: "pi", persistence: { nativeHandle } },
              entries: [],
            }),
          },
        }),
      },
    },
  } as unknown as PluginHandlerContext;
}

test("reports async workflow children while they are still running and keeps exact Agent scope", async () => {
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "paseo-pi-subagents-home-"));
  process.env.HOME = home;
  const sessions = join(home, ".pi", "agent", "sessions", "test");
  await mkdir(sessions, { recursive: true });
  const sessionPath = join(sessions, "session.jsonl");
  const runId = `paseo-test-${process.pid}-${Date.now()}`;
  const asyncRoot = join(tmpdir(), `pi-subagents-uid-${process.getuid?.() ?? "unknown"}`, "async-subagent-runs");
  const asyncDir = join(asyncRoot, runId);
  await mkdir(asyncDir, { recursive: true });
  const callId = "call-live-workflow";
  const directCallId = "call-live-direct";
  try {
    await writeFile(sessionPath, [
      line({ role: "assistant", content: [{ type: "toolCall", id: callId, name: "subagent", arguments: { async: true, workflowScript: "runs.all(...)" } }] }, "2026-01-01T00:00:00.000Z"),
      line({ role: "toolResult", toolCallId: callId, toolName: "subagent", content: [{ type: "text", text: `Async workflow [${runId}]` }], details: { mode: "workflow", runId, asyncId: runId, asyncDir, results: [], workflowChildren: { workflowState: "running", children: [] } } }, "2026-01-01T00:00:01.000Z"),
      line({ role: "assistant", content: [{ type: "toolCall", id: directCallId, name: "subagent", arguments: { agent: "reviewer", task: "Review live state", async: false, context: "fresh" } }] }, "2026-01-01T00:00:02.000Z"),
      line({ role: "assistant", content: [{ type: "toolCall", id: "call-management", name: "subagent", arguments: { action: "list" } }] }, "2026-01-01T00:00:03.000Z"),
    ].join("\n") + "\n");
    await writeFile(join(asyncDir, "status.json"), JSON.stringify({
      runId,
      mode: "workflow",
      state: "running",
      steps: [
        { agent: "scout", label: "api", status: "running", startedAt: Date.now() - 5_000, model: "gpt-test", toolCount: 3, tokens: { total: 1200 } },
        { agent: "reviewer", label: "review", status: "completed", startedAt: Date.now() - 8_000, endedAt: Date.now() - 1_000, durationMs: 7000, toolCount: 5 },
      ],
    }));

    const live = await listSubagentCalls({ agentId: "agent-a" }, context("agent-a", sessionPath));
    assert.equal(live.calls.length, 2, "management calls are excluded");
    const workflow = live.calls.find((call) => call.callId === callId)!;
    assert.equal(workflow.status, "running");
    assert.equal(workflow.children.length, 2);
    assert.equal(workflow.children.filter((child) => child.status === "running").length, 1);
    assert.equal(workflow.children[0].toolCount, 3);
    assert.equal(workflow.children[0].tokens, 1200);
    const direct = live.calls.find((call) => call.callId === directCallId)!;
    assert.equal(direct.status, "running");
    assert.equal(direct.children.length, 1);
    assert.equal(direct.children[0].agent, "reviewer");

    const isolated = await listSubagentCalls({ agentId: "agent-b" }, context("agent-b", sessionPath, "agent-a"));
    assert.deepEqual(isolated.calls, []);

    await writeFile(join(asyncDir, "status.json"), JSON.stringify({
      runId,
      mode: "workflow",
      state: "complete",
      steps: [
        { agent: "scout", label: "api", status: "completed", startedAt: Date.now() - 8_000, endedAt: Date.now(), durationMs: 8000 },
        { agent: "reviewer", label: "review", status: "completed", startedAt: Date.now() - 8_000, endedAt: Date.now(), durationMs: 8000 },
      ],
    }));
    const done = await listSubagentCalls({ agentId: "agent-a" }, context("agent-a", sessionPath));
    assert.equal(done.calls.find((call) => call.callId === callId)!.status, "completed");
  } finally {
    process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
    await rm(asyncDir, { recursive: true, force: true });
  }
});
