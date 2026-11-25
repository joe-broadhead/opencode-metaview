# Changelog

All notable changes to this plugin are recorded here. The format follows the plugin standard: one section per release,
written by `plugin-kit release`.

## 0.0.0 (unreleased)

- Rebuilt on `plugin-contract` v0: one `register` call wires the tools, Code Mode and RPC; the manifest is the
  `capabilities` block in `package.json`.
- Accounts are the contract's `mcp` mechanism: one Metaview MCP server per alias, `metaview` and `metaview-<alias>`.
- The 68 Metaview MCP tools are declared in `methods` with their class and operations, and passed through untouched.
- `status`, `probe` and `events_list` are plugin methods; `events_list` reads the new `metaview.conversations` source.
- Deleted the copied kit, the tools RPC and the source-contract dependency.
