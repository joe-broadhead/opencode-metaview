# Architecture

The plugin is a thin layer over Metaview's official MCP server. OpenCode owns the MCP transport, OAuth, credentials,
permission prompts and tool output limits. The plugin registers the server, names its `/connect` entry, adds default
permission rules, reports status, ships three skills, and lets scripts call the known reads through a tools RPC. It
adds no tool of its own, makes no Metaview call of its own, and has no runtime dependencies.

## Layout

| Path | Role |
| --- | --- |
| `src/index.ts` | The server part: the plugin `metaview.workspace`, pointed at Metaview's server |
| `src/plugin.ts` | Setup, and server registration or adoption |
| `src/integration.ts` | The `/connect` entry: its name "Metaview", and the sign-in problem on its account |
| `src/account.ts` | The account capture: workspace name, role and plan from a `get_user_context` result, in memory |
| `src/options.ts` | Option parsing and validation |
| `src/host-version.ts` | The host check: the supported range, and the tested releases |
| `src/metaview-tools.ts` | `READ_TOOLS`, `WRITE_TOOLS`, `DENIED_TOOLS`, `PARAMETERS` and `classify()`: every fact the plugin keeps about Metaview's tools. No runtime imports, so `scripts/check-metaview-tools.mjs` (`npm run drift`) can load it. `PARAMETERS` is used by that script and the tests only, and the build leaves it out |
| `src/permissions.ts` | The default rules, their placement, and detection of agents without them |
| `src/status.ts` | The status model and text, `/metaview-status`, and the status RPC method |
| `src/redact.ts` | Redaction for everything status shows: URL credentials, queries and token shapes removed, one line, controls and bidi characters stripped, cut by whole characters |
| `src/skills.ts` | Loading and registering the skills |
| `src/host/tools-rpc.ts` | The tools RPC for scripts, `metaview.workspace.tools`; a copy of a module shared by several plugins, with Metaview's part in one marked block |
| `src/tui.ts` | The terminal UI part: the plugin `metaview.workspace.tui` and the `/metaview` dialog |
| `src/constants.ts` | IDs, the server name and URL, the OAuth scope, the Code Mode namespace description, the supported host range, the tested releases (`TESTED_HOSTS`, the one list the checks and status use) and the error shape. No imports, so `scripts/check.mjs` can load it |
| `src/version.ts` | The plugin's version from `package.json`; the build replaces it with the version string alone |

The default rules, the tools RPC's methods, status's unknown tools, the fake server in the tests and the checks of
`jelly.tools` and the skills all derive from `src/metaview-tools.ts`, so a change to Metaview's tools is a change there,
in `jelly.tools`, and in any skill example that names a tool.

`scripts/build.mjs` bundles each entry with esbuild into one self-contained file: `src/index.ts` into `dist/index.js`
and `src/tui.ts` into `dist/tui.js`. Shared code, such as the status model and the RPC contract, is inlined into both.
The bundles have no chunks and no relative imports, because OpenCode reloads a plugin in place and keeps the modules it
already loaded for unchanged paths: an entry that imported a sibling module could get an older copy of it. Only
`@opencode/plugin`, OpenTUI, Solid and `node:` built-ins stay external, because the host provides them. `tsc` only
typechecks. The package exports `.` (`dist/index.js`) and `./tui` (`dist/tui.js`), and ships no declaration files.
`dist/index.js` finds the skills at `../skills/` from its own URL, which is the package root's `skills/`.

## Setup

1. `parseOptions` validates `allowUntestedHost`; anything else fails with `OPTIONS_INVALID`.
2. `checkHost` compares `ctx.app.version` with `>=2.2.3 <2.3.0`, the same range as `opencode.host` in `package.json`.
   Inside it the plugin starts, and status calls only 2.2.3, 2.2.4, 2.2.5 and 2.2.6 tested. Outside it, setup fails with
   `HOST_UNTESTED` unless `allowUntestedHost` is set.
3. The skills are read from the package's `skills/` folder, before the synchronous skill transform needs them.
4. `ctx.mcp.transform` registers `metaview` at Metaview's URL with `oauth.scope`, or adopts the user's own entry at that
   URL, reading only its type, URL and whether `oauth` is `false`. Any other URL, or a local command, is a conflict:
   nothing is added, and status reports it.
5. `ctx.tool.transform` gives the `metaview` namespace its Code Mode description.
6. `ctx.agent.transform` inserts the default rules after each agent's base `* * allow`.
7. `watchAccount` adds one `execute.after` hook, which reads the account from `metaview_get_user_context` results, and
   forgets it on `credential.switched` and when the server is no longer connected.
8. `ctx.skill.transform`, `ctx.command.transform` (`/metaview-status`) and `ctx.rpc.register` (`metaview.workspace/status`).
9. `registerToolsRpc` registers the tools RPC, `metaview.workspace.tools`, and its `evaluate` hook.
10. `watchIntegration` starts. Setup returns one cleanup that stops it, disposes the tools RPC and stops the account
    capture.

Transforms are synchronous and never throw: a failure is kept as a problem for status, and cleared when the next replay
succeeds.

## The `/connect` entry

OpenCode gives every remote MCP server with OAuth an integration, which `/connect` lists under MCP. The host registers
it after plugin setup, named after the server, and registers it again on every MCP reload, after the plugin's
transforms. So `watchIntegration` checks the server's integration on `integration.updated`, `mcp.status.changed` and
credential events, and polls for the first ten seconds. When the name is not "Metaview", it registers a rename
transform again, which then runs after the host's, and disposes the old one.

While the server is `needs_auth` and the integration has an active account, it reports
`{ status: "needs_auth" }` on that account with `ctx.integration.connection.status`, so `/connect` shows that a new
sign-in is required. `connection.active` returns the credential alone, so the plugin reads the status back from
`integration.get`, which projects it, and clears only its own message once the server is connected again. A user's own
entry with
`"oauth": false` has no integration, so there is nothing to name.

## Status

`readStatus` reads the server's state (`ctx.mcp.list()`), the `metaview` tools (`ctx.tool.list()`, by the namespace
`metaview`), every agent's rules (`ctx.agent.list()`) and the skills OpenCode lists (`ctx.skill.list()`), and takes the
captured account. `buildStatus` turns them into one model, and `formatStatus` renders it in a fixed order: Connection
(state and server), Account (the workspace), Access (the role, and what the default rules let run), Plan, Tools
(counts and up to 20 unknown names), Agents without default rules (names, then the default rules to paste, one rule a
line), OpenCode (version, tested or not, the supported range, and setup problems), and exactly one Next step,
"Nothing to do." when nothing is needed. An agent is listed only when it has a base allow, lacks the plugin's whole
block after it, and its own rules would let a new Metaview tool run without asking. A skill of the plugin's id that
OpenCode loads from another path is named, with a next step to rename or move it. OpenCode's text for a needed sign-in
is never shown, and a failure's reason is cut to one line of 160 characters with no URL query.

- `/metaview-status` posts the text with `ctx.session.synthetic` (`resume: false`).
- The RPC method returns the model to the terminal UI and to scripts, with the fields every plugin of this family
  shares (`version`, `host`, `state`, `unguardedAgents`, `nextStep`). Its input and output are JSON Schemas that
  OpenCode validates. A status it cannot read is its declared error `unavailable`, with a next step. The UI part needs
  the RPC because on OpenCode 2.2.x it receives no plugin options and cannot see the server part's findings.

## Tools RPC

`metaview.workspace.tools` lets a script call every known tool with no model; [Scripting](scripting.md) is the user's
view. Its methods are `describe` and one per name in `READ_TOOLS`, `WRITE_TOOLS` and `DENIED_TOOLS`, named after the
upstream tool and carrying a tools RPC class (`read`, `send`, `write` or `destructive`). It is an allowlist: a tool
that Metaview adds later is not a method until it is classified, and `describe` lists it as unclassified. `describe`
reports each method as available or not from what OpenCode lists now, which follows the Metaview products the account
has.

A call is `{ sessionID, input }`. The module:

1. looks up the session with `ctx.session.get`, and its agent's rules with `ctx.agent.get` in the session's location
   (`SESSION_UNKNOWN`, `SESSION_AGENT_REQUIRED`);
2. refuses the tool when the last rule that matches `metaview_<tool>` on `*`, in the agent's rules followed by the
   session's, is a deny: OpenCode hides such a tool from the model (`PERMISSION_DENIED`);
3. refuses with `SERVER_CONFLICT` while `metaview` is a user server at another URL; an adopted server is the plugin's;
4. finds the tool's executor in `ctx.tool.list()`, or names the server's connection state (`AUTH_REQUIRED` and so on)
   or `TOOL_UNAVAILABLE`;
5. calls `execute(input, { sessionID, agent, messageID, id, signal, progress })` with a new call id. OpenCode's
   executor checks `metaview_<tool>` on `*` itself, with the agent's rules, the session's rules and saved approvals,
   and sends OpenCode's own credential;
6. returns `{ output?, text }`: the executor's output (the tool's structured content, or OpenCode's copy of its text
   when it has none) and the tool's text parts.

While a call runs, its id is live. A `permission.hook("evaluate")` turns an `ask` whose source id is live into a deny,
so the script gets `PERMISSION_DENIED` at once and no prompt waits. It changes nothing else; this is the plugin's only
permission hook, and the forbidden scan allows exactly this one.

A `Tool.Error` with a cause is a permission refusal; one without a cause is Metaview's own error (`isError`), which
becomes `UPSTREAM_ERROR` with its first line, at most 300 characters, with tokens and URL queries removed. Any other
failure is OpenCode's own and passes through.

OpenCode decodes a plain JSON Schema input with Effect, which drops unknown keys of an object that has properties
instead of refusing them. So the envelope's schema carries a strict Standard Schema validator as a non-enumerable
`~standard` property, which OpenCode prefers. The contract still reads and serialises as plain JSON Schema, and
OpenCode answers a bad envelope with `rpc.invalid_input`.

The executor does not run `execute.before` and `execute.after` hooks, so the module's `shapeResult` does what the
account hook does: a `get_user_context` result records the account. Results are otherwise unchanged.

## Terminal UI part

`src/tui.ts` uses no JSX, because OpenTUI's JSX transform skips `node_modules`. One global keymap layer provides
"Metaview: Status" (palette and `/metaview`) and the `r` key, which is enabled only while the dialog is open. The
dialog is a `ui.dialog.alert`, which closes on `Esc`. It listens to events only while it is open, and refreshes on
`mcp.status.changed` for `metaview`, `server.connected`, `agent.updated`, `integration.updated`, `credential.updated`
and `credential.switched`. The newest answer wins, and a refresh never reopens a closed dialog.

## Platform facts

These facts about OpenCode 2.2.3 hold on 2.2.4, 2.2.5 and 2.2.6 too. Links point to the source at tag `v2.2.3`.

| Topic | Fact | Source |
| --- | --- | --- |
| MCP tool permissions | The host asserts every MCP call: action `<server>_<tool>`, resource `*`. A last-matching `deny` on `*` hides the tool. | [`tool/mcp.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/tool/mcp.ts) |
| Rule evaluation | The last match wins. Saved approvals come after all rules as `allow`. An unattended `ask` is refused. | [`permission.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/permission.ts) |
| Agent rule order | Built-in agents start from a base `* * allow` and exist before package plugins run. User `permissions`, and agents defined only in user config, come after. | [`config/plugin/agent.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/config/plugin/agent.ts) |
| User MCP config | `mcp.servers` is applied before package plugins. A later plugin `set` would replace the user's entry. | [`config/plugin/mcp.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/config/plugin/mcp.ts) |
| MCP integrations | Integration ID `mcp_` + the first 16 hex digits of sha1(`<name>\0<url>`), so credentials are kept per name and URL. | [`mcp/index.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/mcp/index.ts) |
| Credential status | A status set with `integration.connection.status` is not on what `connection.active` returns; `integration.get` projects it as `connections[].status`. A 401 whose token refresh fails with no refresh token leaves the credential in place, so the `/connect` mark is only observable then. The host test signs in through the loopback callback and the token endpoint, then challenges, and asserts the mark is set and cleared. | The host test, on 2.2.3, 2.2.4, 2.2.5 and 2.2.6 |
| Code Mode | MCP tools are in Code Mode by default (`tools.metaview.<tool>`). A declined prompt is an error the program can catch. | [`codemode/tool.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/codemode/tool.ts) |
| Dialog close paths | A plugin's `ui.dialog.alert` resolves on its dialog's `onClose`. Opening another dialog (`replace`), `clear` (also a click outside), Escape and Ctrl+C all call `onClose` for each dialog they remove, so the `/metaview` dialog's `r` key and listeners stop on every path. | The pack test reads each stock release's terminal UI code for this |
| UI part options | The UI part of a plugin listed in `opencode.json` gets no plugin options. | Observed on stock 2.2.3, 2.2.4, 2.2.5 and 2.2.6 |
| Tool executors | `ctx.tool.list()` returns each MCP tool with a callable `execute`, which checks `<server>_<tool>` with the agent's and the session's rules and saved approvals, and gives the `evaluate` hook the call's `source`. A deny is a `Tool.Error` with a cause; the server's `isError` is one without. `execute.before` and `execute.after` hooks do not run for it. Not documented as an entry point: the package test checks it on stock 2.2.3, 2.2.4, 2.2.5 and 2.2.6. | [`tool/mcp.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/tool/mcp.ts) |
| RPC input | An RPC input given as a Standard Schema is validated with it; a plain JSON Schema is decoded with Effect, which drops unknown keys of an object that has properties. The package test checks the envelope on stock 2.2.3, 2.2.4, 2.2.5 and 2.2.6. | `@opencode/core` 2.2.3, the RPC service's `parse` |
