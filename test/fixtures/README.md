# Recorded evidence

- `live-tools.json` is the tool list OpenCode showed for Metaview's MCP server on 2026-11-14: 68 tools, their input
  schemas and their public descriptions. It is evidence for the manifest's pass-through `mcp:` rows, not a test matrix.
- `provenance.json` records that capture, including its historical capture host. It is evidence, not a support claim:
  the plugin supports and tests `>=2.4.1 <2.5.0`, tested on 2.4.1 (T1 in `plugin-kit check`).

The tool list is the vendor's own metadata and does not depend on the host version. The recorded capture host is kept in
`provenance.json` so the evidence is not mistaken for a 2.4.1 run.

The conformance fixture the kit replays is `../../fixtures/conformance.json`, recorded from the deterministic fake
Metaview server with two synthetic aliases (`work`, `personal`). `npm run fixtures` rebuilds it.
