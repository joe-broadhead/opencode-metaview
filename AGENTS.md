# Repository rules

This repository builds `@joe-broadhead/opencode-metaview`, an OpenCode plugin that registers Metaview's official MCP
server and adds default permission rules, a status command, a status dialog, three skills and a tools RPC for scripts.
It has no tool of its own. Read [docs/architecture.md](docs/architecture.md) before you change code, and
[CONTRIBUTING.md](CONTRIBUTING.md) for the checks and the release steps.

## Rules

- **Public API only.** Use only the public `@opencode/plugin` 2.2.3 API. `opencode.host` in `package.json` and
  `SUPPORTED_HOST` in `src/constants.ts` both say exactly `>=2.2.3 <2.3.0`, never `^2.2.3`. `TESTED_HOSTS` in
  `src/constants.ts` is the one list of tested releases (2.2.3, 2.2.4, 2.2.5 and 2.2.6): status calls only those tested,
  the host and pack stages and CI run on each. Inside the range an untested release still starts.
- **Greenfield.** No legacy, migration code, compatibility shim, dual path or deprecated alias, and nothing dead.
  Delete rather than deprecate.
- **No peers, no runtime dependencies, no lifecycle scripts.** `@opencode/plugin`, `@opencode/sdk` and
  `@opencode/client` (whose types the host tests use) are devDependencies pinned to exactly `2.2.3`. Do not add another
  host version to the lockfile: the host stage installs the other tested SDKs into a temp folder.
- **Ship prebuilt, one file per entry.** `scripts/build.mjs` bundles `src/index.ts` and `src/tui.ts` with esbuild into
  the self-contained `dist/index.js` and `dist/tui.js`: no chunks, no relative imports, and only host-provided modules
  external. `tsc` only typechecks. No declaration files, `.tsx` or JSX.
- **One endpoint string.** `ENDPOINT` in `src/constants.ts` is the only place Metaview's URL is written in code; the
  pack test points the built plugin at a fake by replacing its one occurrence in `dist/index.js`.
- **Default rules, not hooks.** Permissions come from rules inserted through `ctx.agent.transform` directly after each
  agent's base allow. A stricter agent is never weakened. An agent counts as guarded only with the whole block for the
  current `access` after its base allow. Agents that miss the rules are named in status with the per-agent fix, never
  patched, and the fix never goes in the top-level `permissions`.
- **Every tool is allowed by default.** The one option that restricts the plugin is `access`, with `"all"` (the
  default), `"ask-changes"` (reads run, everything else asks) and `"read-only"` (reads run, everything else is denied).
  `defaultRules(access)` generates the block from the tool lists, status and the README print it in full, and a docs
  test asserts the printed block equals `defaultRules(access)` for each value. A tool Metaview adds later is covered by
  the `metaview_*` rule, so it follows `access` too. There is no deny in the default block; a user restricts with a rule
  or with `access`.
- **Transforms are cheap, synchronous and never throw.** Record failures for status instead.
- **Errors** read `CODE: What happened. Next step: What to do.`, built by `metaviewError` or `errorText`. Codes have no
  service prefix; shared failures use the shared names (`HOST_UNTESTED`, `OPTIONS_INVALID`, `STATUS_UNAVAILABLE`,
  `SKILLS_INVALID`). `PLUGIN_CODES` and `RPC_CODES` in `src/constants.ts` are the one table: `metaviewError` and
  `errorText` take a `PluginCode`, and `test/unit/codes.test.ts` fails when a code raised in `src` is in neither table,
  or when `README.md`'s Troubleshooting table or `docs/scripting.md`'s refusal table drifts from it.
- **Status.** `src/status.ts` builds one model for `/metaview-status`, the `/metaview` dialog and the status RPC. The
  RPC keeps the fields every plugin of this family shares, `version`, `host` (`version`, `range`, `tested`), `state`,
  `access`, `unguardedAgents` and `nextStep`, under those names. It never shows OpenCode's text for a needed sign-in, cuts a
  failure's reason to one line of 160 characters with `src/redact.ts` (no credentials, URL queries or tokens), and names
  at most 20 unknown tools, plain names only. A status it cannot read is the declared RPC error `unavailable`, with a
  next step. Status makes no Metaview call: the account comes only from `get_user_context` results the model or a script
  asked for.
- **A user's own server entry** is read for its type, URL and whether `oauth` is `false`, never its `headers`, which
  may hold an API key.
- **`src/metaview-tools.ts` is the one record of Metaview's tools**, and has no runtime imports. Everything else
  derives from it; `jelly.tools` and the skills are checked against it. `src/constants.ts` has no imports at all:
  `scripts/check.mjs` loads it with Node's type stripping.
- **Candidate data is personal data.** Tests, fixtures, docs and skills use only invented people and companies. The
  skills label Metaview's AI output as Metaview's, never infer protected characteristics, make no hiring decision the
  user did not ask for, and say whom a change reaches before it asks.
- **The `jelly` section** of `package.json` declares every known tool, the skills, the sign-in, a one-line `summary`
  and the `icon`, with only the keys Jelly reads: its contracts drop an unknown top-level key, and refuse an unknown key
  inside a tool, sign-in or `contributes` entry. `test/unit/jelly.test.ts` keeps it in step with the tool lists and the
  default rules.
- **The icons** `assets/icon.svg`, `assets/icon-128.png` and `assets/icon-256.png` are a neutral speech-bubble glyph: no
  Metaview logo, shape or brand colour, because the plugin is unofficial. They are generated by the family icon kit and
  checked by `scripts/check-icons.mjs`, which is a byte-identical copy of the kit's: only `opencode.icons`, the three
  `exports` and the three `files` entries describe them, and `opencode.vendor` declares Metaview as the vendor.
- **TypeScript.** No enums, namespaces or parameter properties. `import type` for types, `.js` in relative imports.
- **The tools RPC.** `src/host/tools-rpc.ts` is a copy of a module shared by several plugins. Change only its block
  between the `PLUGIN-SPECIFIC` markers here; change the rest in the shared copy first. Its methods are `METHODS`,
  built from `READ_TOOLS`, `WRITE_TOOLS`, `SEND_TOOLS` and `DESTRUCTIVE_TOOLS` in `src/metaview-tools.ts`: every known
  tool, by exact name, with its class. The rule is resolved before dispatch, so only an `allow` runs and an `ask` or a
  `deny` is refused; at the default `access` every tool is allowed. An unknown tool is never a method. Keep the RPC id
  `metaview.workspace.tools` and its method names stable: scripts call them by name.
- **Tests.** Unit tests use narrow `Pick<Plugin.Context, ...>` fakes. Host tests use the public `@opencode/sdk` with
  `OpenCode.create({ app: { version } })`, a loopback fake server and the temp root from `test/host/isolate.ts`.
  Every temp root of the host and pack tests is a git repository under the system's `/tmp`, never under `TMPDIR` or
  `HOME`, so OpenCode never finds a `.opencode` folder of whoever runs them; each stock server has its own port.
  Never sign in to Metaview or call its API from a check.
- **Text.** Model-facing text and docs use plain language and describe what the code does now: no process
  narrative, test counts, machine-local paths, secrets or personal data.
- **Releases** come only from `.github/workflows/release.yml` ("Releasing" in [CONTRIBUTING.md](CONTRIBUTING.md)). A
  release-prep PR sets `version` in `package.json` and the install specs and runs `node scripts/changelog.mjs release`;
  once it is on `master` and CI passed, start the release with
  `gh workflow run release.yml --ref master -f sha=<its full sha>`. The workflow builds `dist/`, makes the release
  commit on a temporary `release/v<version>` branch, checks and stages everything, and waits for the owner to approve
  the `release` environment; only then does it create the tag `v<version>` and the GitHub Release. Never push a tag or a
  `release/*` branch, and never commit, tag or publish a release by hand. Agents never approve a release, never call the
  deployment-approval API, and never bypass a ruleset or the environment.
- **No personal email in anything we publish.** Every commit is authored and committed as
  `joe-broadhead <91376460+joe-broadhead@users.noreply.github.com>`, except the release commit and tag, which the
  release workflow makes as `github-actions[bot]`. Before committing or tagging, check that
  `git config user.email` is that address: a fresh clone inherits the machine's global identity, which is not that
  address. Never commit, tag or publish with a work or personal address, or with a local hostname.
- **One check command.** `npm run check` passes before every commit. Never skip, weaken or delete a test to get
  green.

## Forbidden in this repository

`scripts/check-forbidden.mjs` enforces this list in `src/`, `test/`, `scripts/` and `dist/`:

- dispatch-lease, catalog-ownership and text-only markers, and tool `options.mcp` delegation;
- `Plugin.image` and profile images;
- imported OAuth grants;
- the V1 plugin API: `@opencode-ai/*` packages and hooks such as `tool.execute.before`, `chat.message` or
  `permission.ask`;
- the deprecated `ctx.generate.text` and `experimental.policies`;
- importing `@opencode/ai`;
- a permission hook, except the one `permission.hook("evaluate")` in `src/host/tools-rpc.ts` (and the bundle that
  inlines it), exactly once each: it turns an `ask` on one of the tools RPC's own script calls in flight into a deny,
  because no one can answer it, and touches nothing else;
- references to private host source or host checkouts;
- machine-local home and temp paths;
- `.tsx` or `.jsx` files in `dist/`.

The pack test also rejects anything in `dist/` other than the two bundles, any relative, dynamic or `require` import in
them, and any import of a module OpenCode does not provide.
