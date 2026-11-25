# Changelog

## 0.0.0 (2026-11-25)

Metaview is an OpenCode plugin on plugin-contract v0. It registers Metaview's MCP server once per account alias
(`metaview`, `metaview-<alias>`), passes the vendor's 68 tools through, and adds the contract's `status`, `probe` and
`events_list` reads for the `metaview.conversations` source.

- `status` reports the version, OpenCode host, every alias and the next step; `probe` names the signed-in owner.
- `events_list` lists recruiting conversations as metadata-only `meeting` events, oldest first, with a cursor that is a
  total order on `(occurred_at, external_id)`; a page completes a same-start tie group before it is cut, and all reports
  in a scope are merged before the page is cut, so conversations are not lost at a boundary.
- The plugin's three skills are loaded from `skills/` and registered through OpenCode's skill domain; a real-host test
  checks the exact ids on OpenCode 2.4.1.
- Accounts are the contract's `mcp` mechanism, one server per alias, with `account` on every method that takes one.
- The manifest declares no actions and no bus events: every change is the vendor's own MCP tool, under its own
  permission action.

## Removed since v0.0.8

- `/metaview-status` and `/metaview`: the old slash command and TUI duplicated the private `metaview.workspace/status`
  RPC. `status` is now the contract method, reachable as a tool, in Code Mode and over RPC; a TUI view is optional host
  UI under plugin standard §2, and apps own placement.
- The `metaview.workspace.tools` and `metaview.workspace/status` RPC ids: replaced by the contract's one `metaview` RPC
  id with `status`, `probe` and `events_list`; the 68 vendor tools stay the vendor MCP server's own.
- Adopting a user's `mcp.servers.metaview` entry unchanged: the contract's `accounts` module owns one server per alias
  (`metaview`, `metaview-<alias>`), so OAuth and permissions stay per account; an adopted entry could bypass that.
- The old status model (`connected`, workspace, role, plan, tool counts and server adoption/conflict): replaced by the
  contract's `status` shape (`ready`, `needs_sign_in` or `error`, per-alias owner, unguarded agents, next step).
  `probe` reports the owner.
