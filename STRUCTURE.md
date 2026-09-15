# Layout conventions (Paseo 0.8)

*[中文](STRUCTURE.zh-CN.md)*

```
index.client.tsx   client entry — timeline cards, composer pills
index.server.ts    server entry — RPC handlers
client/            app bundle only (browser / iOS / Android Hermes)
server/            daemon bundle only (Node, may use node:*)
shared/            both bundles: pure logic, contracts, message catalog
tests/
docs/
```

## The compiler enforces the boundary

Since 0.8 the split is by **directory**, not by filename suffix:

```js
directoryTarget(file):
  client/ → client      server/ → server      shared/ → both
  index.client.tsx / index.server.ts → the two entries
  anything else → "invalid" → compile error
```

Importing `server/foo.ts` from client code fails the build outright:

```
server-only module cannot be imported into the plugin client bundle: …
```

⚠️ **0.7 did not work this way.** It filtered the text of `index.ts`
(`REGISTRATIONS_REMOVED_BY_TARGET` + `collectOppositeTargetImportRanges`):
imports for the opposite target were deleted whole, as were the registration
calls that target did not want.

That mechanism **did not check references**, and it bit us twice —
`readFlags is not defined` and `closeProviderUsageClient` in the cleanup — each
needing a `typeof X === "function"` guard. Worse, when it failed **the server
half was fine** and `paseo plugin ls` still reported `running`.
**Those guards are unnecessary on 0.8.**

## Dependency direction

```
client/  ──▶  shared/  ◀──  server/
```

`shared/` imports neither side. That is what keeps it unit-testable without a host.

## SDK subpaths

| For | Import from |
|---|---|
| `defineRpc` / `defineSettings` / contract types | `@getpaseo/plugin` |
| Hooks (`useRpc` / `useAgent` / `useWorkspace`) and client types | `@getpaseo/plugin/client` |
| `Icon` / `Modal` / `useToast` | `@getpaseo/plugin/client/react-native` |
| Settings screen components | `@getpaseo/plugin/client/ui` |
| `PluginServerContext` / lifecycle types | `@getpaseo/plugin/server` |

## Manifest

```json
{ "id": "…", "requirements": { "paseo": ">=0.8.0" } }
```

Without `requirements.paseo`, a 0.8 daemon rejects the plugin as targeting pre-0.8.

⚠️ **The client bundle is evaluated by the app, using the app's own plugin
runtime.** So upgrading the daemon to 0.8 is not enough — an older app (0.7.2,
say) cannot provide the new `@getpaseo/plugin/client` subpaths, evaluation fails,
and *no* surfaces appear. Check the `appVersion` of every connected client before
upgrading the daemon.
