# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

Jelly names the plugin **Metaview** (`jelly.title`), with the package name and version beneath. Under
that name it shows the one line in `jelly.summary`, and beside it the mark in `jelly.icon`
(`assets/icon.svg`, shipped in the package): Jelly reads that file once, when it records the
plugin, and keeps it only if it is a clean SVG of drawing elements, with no script, style, link
or outside reference. The mark is a neutral speech bubble, not Metaview's logo. Jelly's declaration
contracts drop a top-level key they don't know, and refuse an unknown key inside a tool, sign-in or
`contributes` entry, so the section uses only the keys Jelly reads.

## Tools and permissions

Every tool in `src/metaview-tools.ts` is declared: each read tool as read-only with `allow`, each write
tool with `ask`, and each denied tool with `deny`. Jelly's agents have no base "allow everything" rule,
so this plugin's own default rules, which it puts after that rule, never reach them. Jelly writes each
declared `ask` or `deny` as that tool's default instead (the person's own choice replaces it), and denies
a read-only helper every tool not marked `readOnly`. A declared `allow` changes nothing in Jelly.

- Ask: every write tool (`WRITE_TOOLS`), including those that reach candidates, such as
  `metaview_update_screen_outreach`, or the ATS, such as `metaview_post_sourcing_candidates_to_ats`.
- Off: `metaview_give_application_review_candidate_feedback` (application review decisions, which sync to the ATS and
  can email the candidate), `metaview_manage_candidate_sequence` (candidate outreach) and `metaview_submit_feedback`
  (text sent to the Metaview team).
- Everything else runs, as the plugin's own rules let it.

A tool the upstream server adds later is not declared, so in Jelly it runs without asking, even if it changes
something, such as a write that reaches candidates, until a new version of this plugin declares it. A Jelly admin
can set such a tool to ask. Keep `jelly.tools` in step with `src/metaview-tools.ts`; `test/unit/jelly.test.ts`
checks the list against it, and each declared effect against the plugin's own default rules.

## Skills

Declared: `metaview`, `metaview-candidate-brief`, `metaview-write`. Jelly refuses an install whose
skill ids collide with another plugin's or the agent's own. Metaview publishes skills of its own
for other assistants (interview prep, debriefs and others); this plugin's ids differ from them.

## Views

None: `jelly.views` and `jelly.rpc` are empty, and the plugin contributes no Home feed or widget.
A feed of interviews would put candidate names on a dashboard and call Metaview unasked.

## Signing in

`jelly.signIns` declares one sign-in, `metaview`, for Metaview's MCP server `metaview`, which signs in with OpenCode's MCP OAuth. A person who defines their own `mcp.servers.metaview` with `"oauth": false` and an API key has no sign-in for Jelly to show; that server signs in with its own headers.

Jelly folds the declared sign-in into this plugin's one card, which shows it as Connected, Not signed in or Sign in again (expired or revoked), and starts, renews and signs out of it. An agent's `jelly_connection_request`, or a tool result that names this plugin's "Run /connect and choose …" next step, opens the same card. The plugin still signs in through OpenCode, as it does without Jelly; the declaration only tells Jelly which of the engine's integrations and servers are this plugin's.

## Versions

Jelly's curated catalogue pins an exact version, so publish each release under a new version: a review in Jelly
can then tell the two apart.
