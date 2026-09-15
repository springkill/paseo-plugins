# Paseo Plugins

A collection of practical plugins for [Paseo](https://github.com/getpaseo/paseo).

*[中文](README.zh-CN.md)*

| Plugin | What it does |
|---|---|
| [`paseo-pi-kit`](paseo-pi-kit) | Four features for [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) sessions: todo cards, subagent cards, notice cards, and provider usage |

Each plugin has its own README with the details. This file only covers what they
share: installing, versioning, and the conventions they follow.

## Install

```bash
paseo plugin install https://github.com/springkill/paseo-plugins:paseo-pi-kit
```

`source:subdirectory` is Paseo's monorepo syntax — it installs one plugin out of
a repository.

Pin a version, or follow updates:

```bash
paseo plugin install https://github.com/springkill/paseo-plugins:paseo-pi-kit --ref paseo-pi-kit-v0.8.3
paseo plugin status              # anything newer?
paseo plugin update --all
```

Uninstall: `paseo plugin remove paseo-pi-kit`

## ⚠️ Before you install

Paseo plugins are **trusted and unsandboxed**:

- **Server code runs on your machine as you** — it can read and write files,
  spawn processes, and talk to the Paseo daemon
- `paseo-plugin.json` may declare a `build` command (`npm install`), and
  **that runs on your machine too**
- Client code runs inside the Paseo app

Installing any third-party plugin means trusting its author. Read the source, or
pin `--ref` to a commit you have reviewed yourself.

## Versioning and releases

**Every plugin is versioned on its own.** Tags look like:

```
<plugin-directory>-v<semver>        e.g.  paseo-pi-kit-v0.8.3
```

Pushing such a tag runs the checks for *that plugin only*, then publishes a
GitHub Release. Nothing else in the repo is touched, so shipping one plugin
never forces a version bump on the others — and `--ref` pins the version of the
plugin you actually installed, not "whatever the repo looked like that day".

Releasing:

```bash
cd <plugin>
npm version <patch|minor|major> --no-git-tag-version   # keeps package-lock in sync
cd .. && git commit -am "chore: <plugin> <version>"
git tag "<plugin>-v<version>" && git push origin main "<plugin>-v<version>"
```

The release job refuses the tag if `package.json` disagrees with it, or if the
directory does not exist — so a forgotten bump fails loudly instead of shipping a
release that lies about its version.

CI discovers plugins by globbing `*/paseo-plugin.json`, so **adding a plugin
needs no workflow changes**.

> Tags before this scheme were repo-wide (`v0.1.0` … `v0.3.3`). They still
> resolve, but new releases use the per-plugin form.

## Shared conventions

**Interface language.** Paseo plugins on the same machine share one setting —
change it in any of them and the rest follow on their next render:

```
$PASEO_HOME/plugin-locale.json      # { "locale": "auto" | "zh" | "en" }
```

That file is **not owned by any single plugin** — do not delete it when
uninstalling one.

Resolution order, highest first: `<PLUGIN>_LANG` → `PASEO_PLUGIN_LANG` → the
shared setting → the client's own locale → `LC_ALL` / `LC_MESSAGES` / `LANG` →
English. The client only *reports* its locale; the decision is made server-side,
because deciding in both places guarantees they eventually disagree.

**Layout.** See [STRUCTURE.md](STRUCTURE.md). The short version: `shared/` is
pure logic that goes into both bundles, `server/` runs in the daemon, `client/`
runs inside the Paseo app — and since Paseo 0.8 **the directory is what the
compiler splits on**, enforced at compile time. Entry points are
`index.client.tsx` and `index.server.ts`.

**Paseo 0.8 or newer.** Each manifest declares
`"requirements": { "paseo": ">=0.8.0" }`; without it a 0.8 daemon refuses to
load the plugin. Note that the *client* bundle is evaluated by the **app**, not
the daemon — an older app (0.7.x) cannot run these plugins even against a 0.8
daemon, and fails with no visible surfaces at all.

## Development

```bash
cd paseo-pi-kit
npm install
npm run typecheck
npm test

paseo plugin install "$(pwd)"          # install from a directory
paseo plugin reload paseo-pi-kit
paseo plugin logs paseo-pi-kit
```

Editing source only needs `reload`, not a Paseo restart.

⚠️ A directory install does **not** run the `build` command — only git installs
and updates do. Run `npm install` yourself when developing locally.

⚠️ `paseo plugin ls` and the daemon log only show you the **server** half. A
broken client bundle still reports `running`. `npm test` compiles the real client
bundle and runs it; trust that over the daemon log.

## License

Apache-2.0 — see [LICENSE](LICENSE).
