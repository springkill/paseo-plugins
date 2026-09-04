# Layout conventions

*[中文](STRUCTURE.zh-CN.md)*

Every plugin here uses the same layers, matching
[paseo-rumen](https://github.com/springkill/paseo-rumen):

```
index.ts       plugin registration
domain/        pure logic, no IO, shared by both ends (.shared.ts)
server/        plugin subprocess (.server.ts, may use node:*)
ui/            inside the Paseo app (.client.tsx)
tests/         *.test.ts
```

## ⚠️ The suffix is load-bearing; the directory is not

Paseo's compiler splits the client and server bundles **by filename suffix**:

```js
onResolve({ filter: /\.(?:client|server)(?:\.[cm]?[jt]sx?)?$/ }, ...)
```

Directories are for humans. Rename `foo.server.ts` to `foo.ts` and its `node:fs`
imports land in the client bundle.

## The entry point is filtered as text

`index.ts` gets special treatment (`filterEntrypoint()` in the compiler):
imports for the opposite target are **deleted line by line**, and so are the
registration calls that target does not want — `handle` for the client bundle,
every `add*` for the server one.

So a `.server` value may only be referenced **inside `plugin.handle(...)`**, and
a `.client` value only inside those `add*` calls. Anywhere else — a bare
statement, a condition, a callback body the compiler keeps — leaves an
identifier with no definition in the other bundle, and it throws at runtime.

⚠️ The build does not catch this: the boundary check never sees the import,
because it was already removed at the text stage.

## Dependency direction

```
ui/  ──▶  domain/  ◀──  server/
```

`domain/` imports nothing from `ui/` or `server/`. That is what keeps it testable
without a host, and what lets both bundles share it.
