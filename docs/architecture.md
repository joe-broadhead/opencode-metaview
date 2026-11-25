# Architecture

## Layers

| Layer | Files | Does |
|---|---|---|
| Entry | `src/index.ts` | `Plugin.define({ id, setup })`, the host gate, the account wiring and one `register` call |
| Accounts | `src/accounts.ts` | one Metaview MCP server per alias, through the contract's `accounts` module |
| Manifest | `src/manifest.ts` | reads `package.json` `capabilities` and checks it with the contract's validator |
| Handlers | `src/handlers/` | one handler per method: the input, the answer schema, the description and the work |
| Provider | `src/provider/client.ts` | the two Metaview MCP tools the plugin reads, and the page and probe normalisation |

The entry is deliberately thin. `register` from the contract wires doors 1–3: one agent tool per method in the
`metaview` namespace, the same tools in Code Mode, one RPC registration under `metaview`, the permission assertions on
`<alias>:<operation>`, the access rules inserted into every agent and the bus writer (empty, because the manifest
declares no event). This repository never calls `ctx.tool.transform`, `ctx.rpc.register` or `ctx.permission.assert`
itself.

## The call path

1. OpenCode loads `dist/index.js` through the package's `./server` export and calls `setup(ctx)`.
2. `assertHost` refuses an OpenCode release outside `>=2.4.1 <2.5.0`, unless `allowUntestedHost` is set.
3. `src/accounts.ts` adds one MCP server per alias through `ctx.mcp.transform`, named `metaview` or
   `metaview-<alias>`, all at Metaview's one endpoint.
4. `register` checks the handler table against `capabilities.methods`, resolves the accounts from the options,
   generates the access rules into every agent, and registers the three plugin methods and the single RPC id.
5. A call resolves the account, validates the input against the handler's schema, asserts the method's operations,
   runs the handler, checks the answer and maps a failure to the contract's error table.

## The provider

`src/provider/client.ts` is the only file that names Metaview's URL and the two tools a source read uses. It does not
hold a token and does not call an HTTP API: it finds the account's MCP tool through `ctx.tool.list()` and executes it
through OpenCode's own executor, so the vendor tool's permission rule applies too.

- `get_user_context` names the signed-in owner: the participant id, else the user id, else the organization id, with
  the workspace's name as its label.
- `search_conversations` lists the conversations in a window, filtered on `default:start_time` with a relative `after`
  and sorted oldest first. `default:start_time`, `default:candidate` and `default:interviewer` become the event's time
  and actors; `app.metaview.ai` links are kept without a query or fragment; the text stays empty.

The page, cursor, probe answer and event hashes come from the contract's `events` and `cursor` modules. The consumer owns
the cursor; the plugin binds it to the plugin, source, account and scope and refuses one that another account presents.

## Recorded evidence

`test/fixtures/live-tools.json` is the tool list OpenCode showed for Metaview's server on 2026-11-14. It is recorded
evidence for the 68 pass-through tool names and their input schemas, not a test matrix; T1 runs on 2.4.1.
`test/fixtures/provenance.json` records the capture and the historical capture host; the plugin supports and tests
2.4.1 only.

## OpenCode APIs

| API | Who calls it |
|---|---|
| `Plugin.define` | `src/index.ts` |
| `ctx.app.version` | `src/index.ts`, for the host gate and status |
| `ctx.mcp.transform` | `src/accounts.ts` |
| `ctx.agent.transform` | `register`'s access rules |
| `ctx.agent.list` | `register`'s `call.unguardedAgents()`, read by `status` |
| `ctx.mcp.list`, `ctx.tool.list`, a tool's `execute` | `src/provider/client.ts` |
| `ctx.tool.transform`, `ctx.rpc.register`, `ctx.permission.assert` | `register` only |

## State and caching

The plugin keeps no content cache and no credential. The consumer owns the cursor and stores it; the plugin binds the
cursor to the account and scope. `status` reads each alias's identity on demand and never reads a conversation.

## Build

`scripts/build.mjs` bundles `src/index.ts` into `dist/index.js` with esbuild through `npm run bundle`. `@opencode/*`
stays external, because OpenCode provides it; the contract modules are bundled, so an install needs no build. `dist/` is
generated and committed, and CI runs `npm run bundle && git diff --exit-code dist/` so a stale bundle fails.
