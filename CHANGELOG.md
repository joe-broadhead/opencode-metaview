# Changelog

## 0.0.0 (2026-11-25)

Metaview is an OpenCode plugin on plugin-contract v0. It registers Metaview's MCP server once per account alias
(`metaview`, `metaview-<alias>`), passes the vendor's 68 tools through, and adds the contract's `status`, `probe` and
`events_list` reads for the `metaview.conversations` source.

- `status` reports the version, OpenCode host, every alias and the next step; `probe` names the signed-in owner.
- `events_list` lists recruiting conversations as metadata-only `meeting` events, oldest first, with a cursor that is a
  total order on `(occurred_at, external_id)`, so two conversations with the same start are never skipped at a page
  boundary.
- Accounts are the contract's `mcp` mechanism, one server per alias, with `account` on every method that takes one.
- The manifest declares no actions and no bus events: every change is the vendor's own MCP tool, under its own
  permission action.
