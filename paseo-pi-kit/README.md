# Paseo Pi Kit

Four features for [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
sessions in [Paseo](https://github.com/getpaseo/paseo). All on by default.

*[中文](README.zh-CN.md)* · *[repository root](../README.md)*

## Features

### Todo list

Replaces Pi's `todo` tool calls (and Paseo's native `todo` items) with a progress
card: a bar, per-task status colours, and the in-progress task plus what is next.
A composer pill shows `done / total` and the current `activeForm`; clicking it
opens the full list.

### Subagents

Turns Pi `subagent` tool calls into cards showing run state, role, model, tool
count, tokens, duration, cost, acceptance criteria and final output. Async
workflows are read from the live `status.json` the session records, so children
appear as running / completed / failed **while the call is still in flight**
rather than only at the end.

Adds a `Subagents` composer pill (`running / total`) and a **Pi Subagents** panel
scoped to the exact agent you are looking at.

### Pi notice cards

Pi sends background-task, workflow, subagent-supervisor and web-fetch notices as
structured `custom_message`s. Paseo flattens them into plain assistant messages,
so you see raw `<background-task-notification>` XML, tool-call boilerplate meant
for the model, and workflow return values that were `JSON.stringify`-escaped and
then truncated mid-string.

This restores the structure: nine message types across four Pi plugins, each one
reverse-engineered from the `format*()` function that produces it. Workflow
completions are expanded **per child run** instead of dumping the truncated JSON.

⚠️ Notices addressed to the *parent agent* (supervisor requests, control notices)
are collapsed to one line and never styled as something you must act on — their
"Reply with: …" lines are tool calls only a model can make. Questions that
genuinely need you appear as a Paseo dialog with options, on a different channel
entirely.

Format reference: [`docs/pi-message-formats.md`](docs/pi-message-formats.md).

### Provider usage

Composer pills showing each provider's quota windows and balances, with reset
times and a shortfall estimate.

## Install

```bash
paseo plugin install https://github.com/springkill/paseo-plugins:paseo-pi-kit
```

Pin a version with `--ref paseo-pi-kit-v0.3.3`. See
[versioning](../README.md#versioning-and-releases).

⚠️ Paseo plugins are **trusted and unsandboxed**. This one declares a `build`
command (`npm install`) that runs on your machine — see
[the repo README](../README.md#-before-you-install).

## What it reads

Only the current agent's canonical timeline, Pi's own session JSONL, and the
`/tmp/pi-subagents-uid-*/async-subagent-runs/<runId>/status.json` that this
session started and explicitly recorded. Before reading it validates the agent
id, provider, session realpath, the current user's async-run root, and the
`runId`. It does not modify tasks, sessions or run state, and makes no network
requests.

Provider usage is the one exception: it asks the local Paseo daemon for data the
public `PaseoApi` does not expose. That is also the only reason this plugin has a
runtime dependency at all.

## A compatibility layer

`domain/pi-notice-parser.shared.ts` is **temporary**, marked
`COMPAT(pi-custom-message)`.

Pi's notices carry full `details`, and Pi renders them structurally in its own
TUI via `pi.registerMessageRenderer()`. Paseo's Pi provider
(`pi/history-mapper.js` → `mapCustomMessage`) tries `hooks.mapCustomMessage`
first — but **no provider supplies that hook**, so it always falls through,
drops `details`, and keeps only the human-readable `content`. This layer parses
that text back.

The same mapper ignores `display` too, so messages Pi marks model-only (goal
contracts, compaction notices) leak into the timeline as well. Those are
collapsed to one line.

When upstream wires the hook up, delete this layer, its renderer, its tests and
the format doc. How to tell it is time is in the file's header comment.

⚠️ It fails **silently**: once timeline items stop being `assistant_message`, the
transformer stops firing and the cards just quietly disappear. Nothing errors.

## Development

```bash
npm install
npm run typecheck
npm test
paseo plugin reload paseo-pi-kit
```

⚠️ `paseo plugin ls` and the daemon log only show the **server** half — a broken
client bundle still reports `running`. `tests/client-bundle.test.ts` compiles the
real client bundle with Paseo's own compiler and runs `contribute()` against a
fake host; `tests/entrypoint-boundary.test.ts` catches `.server` values
referenced where the client bundle would keep them. Both exist because that
exact bug shipped once.
