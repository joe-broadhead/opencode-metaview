# Configuration

Every option is optional. The smallest setup is one entry in `plugins`:

```json
{
  "plugins": ["@joe-broadhead/opencode-metaview"]
}
```

To set options, use the object form:

```json
{
  "plugins": [{ "package": "@joe-broadhead/opencode-metaview", "options": { "allowUntestedHost": true } }]
}
```

## Options

### `allowUntestedHost`

- Type: `true` or `false`.
- Default: `false`.

The plugin supports OpenCode `>=2.2.3 <2.3.0`, the range `opencode.host` in `package.json` declares, and every check
runs on 2.2.3, 2.2.4 and 2.2.5, the tested releases. Status shows the version, whether it is tested and the supported
range in its `OpenCode` row, for example `2.2.5 (tested; supported range >=2.2.3 <2.3.0)`.

- **A tested release:** the plugin starts.
- **Another release inside the range, such as 2.2.6:** the plugin starts too. Status marks the version `untested`, and
  the status RPC's `host.tested` is `false`. The next step is the same as on a tested release.
- **Outside the range, including 2.3.0, prereleases and development builds:** the plugin refuses to start, and
  `/plugins` shows:

  ```text
  HOST_UNTESTED: This plugin supports OpenCode >=2.2.3 <2.3.0, found 2.3.0. Next step: Use OpenCode >=2.2.3 <2.3.0, or set the plugin option "allowUntestedHost": true to run anyway.
  ```

- **Outside the range with `"allowUntestedHost": true`:** it starts anyway, and `/metaview-status` and `/metaview` show
  a warning.

There is no other option. To narrow what the model may do in Metaview, use permission rules; see
[Permissions](#permissions).

## Your own `mcp.servers.metaview`

If your config defines no server named `metaview`, the plugin registers one:

```json
{ "type": "remote", "url": "https://mcp.metaview.ai/mcp", "oauth": { "scope": "openid profile email offline_access" } }
```

Metaview's server lists no scopes of its own, so without `oauth.scope` OpenCode would request none, and Metaview would
issue no refresh token. OpenCode signs in with its own client metadata document: there is no client ID to set, and
OpenCode's defaults apply to everything else.

To change anything else, define `mcp.servers.metaview` yourself at Metaview's URL. The plugin then **adopts** your entry
unchanged, and `/metaview-status` shows "Connection: connected (…, your own mcp.servers.metaview, used unchanged)". The
permission rules and skills still apply. Of your entry the plugin reads only its type, its URL and whether `oauth` is
`false`; it never reads, copies or reports its `headers`. An entry that signs in with OAuth should keep
`"oauth": { "scope": "openid profile email offline_access" }`, with any other `oauth` settings you add: without the
scope, Metaview issues no refresh token, and the sign-in expires after one token lifetime.

### With a Metaview API key

On a machine without a browser, you can sign in with a Metaview API key instead of OAuth. Create the key in Metaview:
Settings, MCP, turn on "Use API key instead of OAuth?", then generate a key. Keep it in an environment variable, and
define the server yourself:

```json
{
  "mcp": {
    "servers": {
      "metaview": {
        "type": "remote",
        "url": "https://mcp.metaview.ai/mcp",
        "oauth": false,
        "headers": { "Authorization": "Bearer {env:METAVIEW_API_KEY}" }
      }
    }
  }
}
```

- Your entry wins: the plugin adopts it as written, and status shows "your own mcp.servers.metaview without OAuth".
- An entry with `"oauth": false` has no `/connect` entry: you sign in by changing the key.
- OpenCode never refreshes or rotates the key. Deleting the key in Metaview revokes it at once.
- Metaview keys are personal, so an organisation cannot set one for its members.

### A conflict

The plugin compares origin and path, so a trailing slash or a query string still matches. Any other URL, or a local
command, is a **conflict**: the plugin leaves your entry alone, adds nothing, status shows "Connection: conflict", and
gives the next step:

```text
- Next step: Your OpenCode config defines mcp.servers.metaview with https://metaview.example.com/mcp, but the plugin uses https://mcp.metaview.ai/mcp. Point it at https://mcp.metaview.ai/mcp or remove it, then restart OpenCode.
```

## Permissions

OpenCode asserts every MCP call itself, with the action `metaview_<tool>` and the resource `*`. The plugin adds these
rules to every agent that starts with the base rule `{ "action": "*", "resource": "*", "effect": "allow" }`, directly
after that rule:

```json
[
  { "action": "metaview_*", "resource": "*", "effect": "ask" },
  { "action": "metaview_fetch_candidates", "resource": "*", "effect": "allow" },
  "… one allow rule for each read tool in src/metaview-tools.ts …",
  { "action": "metaview_search_snippets", "resource": "*", "effect": "allow" },
  { "action": "metaview_give_application_review_candidate_feedback", "resource": "*", "effect": "deny" },
  { "action": "metaview_manage_candidate_sequence", "resource": "*", "effect": "deny" },
  { "action": "metaview_submit_feedback", "resource": "*", "effect": "deny" }
]
```

`READ_TOOLS` in `src/metaview-tools.ts` lists Metaview's read tools, `WRITE_TOOLS` its write tools, and
`DENIED_TOOLS` the three that are off. Writes and
tools that Metaview adds later match only `metaview_*`, so they ask. `/metaview-status` names the tools in neither
list. Metaview lists only the tools for the products your account has, so a known tool can be missing; that is
normal.

The last three rules turn tools off:

- `metaview_give_application_review_candidate_feedback` records application review decisions. A REJECT or PROGRESS
  syncs to your ATS, and a REJECT can send the candidate a rejection email. It is a hiring decision about a person, and
  can't be undone once sent.
- `metaview_manage_candidate_sequence` adds candidates to outreach sequences, which send email, LinkedIn, SMS or
  WhatsApp messages, or pauses, cancels or removes them.
- `metaview_submit_feedback` sends text to the Metaview team, and its own description asks the model to call it after
  any tool error, unasked; text written after a failed candidate lookup could carry candidate data.

To turn one on, add a rule that makes it ask to the agent's own `permissions`, which come after the plugin's block in
that agent. Each call then asks. For the build agent:

```json
{
  "agents": {
    "build": {
      "permissions": [
        { "action": "metaview_give_application_review_candidate_feedback", "resource": "*", "effect": "ask" },
        { "action": "metaview_manage_candidate_sequence", "resource": "*", "effect": "ask" },
        { "action": "metaview_submit_feedback", "resource": "*", "effect": "ask" }
      ]
    }
  }
}
```

Don't put these in the top-level `permissions`: a top-level rule comes after every agent's own rules, so it would
reach every agent, Explore included, which otherwise can't use Metaview. For an agent that exists only in your config,
put them after the plugin's block (see [Agents that miss the rules](#agents-that-miss-the-rules)).

Use only the rules you need. Never make the two candidate tools `allow`, and don't answer "Always allow" when they ask:
OpenCode would save an allow for every agent in the project, and every later decision or outreach would run unasked.

OpenCode uses the last rule that matches, so everything after the plugin's rules wins:

1. the agent's own rules, such as Explore's, which turn Metaview off there;
2. your top-level `permissions`, which OpenCode adds to every agent;
3. your saved "Always allow" answers, which beat an `ask` but never a configured `deny`.

A `deny` on resource `*` also hides the tool from the model. In an unattended run such as `opencode run`, a tool that
asks is refused. An agent without the base rule gets no Metaview rules and keeps its own behaviour.

### Recipes

A `deny` can go in the top-level `permissions` of `opencode.json`: it applies to every agent, and only tightens. An
`allow` or `ask` goes in the agent's own `permissions`: a top-level one would reach every agent, Explore included.

Never post sourced candidates to the ATS, and never spend enrichment credits, in any agent (a `deny` also hides the
tools):

```json
[
  { "action": "metaview_post_sourcing_candidates_to_ats", "resource": "*", "effect": "deny" },
  { "action": "metaview_enrich_candidate_contacts", "resource": "*", "effect": "deny" }
]
```

Run one write tool without a prompt in the build agent (answering "Always allow" once does the same, for every agent
in the project):

```json
{
  "agents": {
    "build": {
      "permissions": [{ "action": "metaview_create_snippet", "resource": "*", "effect": "allow" }]
    }
  }
}
```

A strict agent where every Metaview tool asks, reads included: put these in that agent's own `permissions`, after the
block. The last match wins, so the `metaview_*` ask alone would turn the three denied tools into asks too; repeating
their denies after it keeps them off:

```json
[
  { "action": "metaview_*", "resource": "*", "effect": "ask" },
  { "action": "metaview_give_application_review_candidate_feedback", "resource": "*", "effect": "deny" },
  { "action": "metaview_manage_candidate_sequence", "resource": "*", "effect": "deny" },
  { "action": "metaview_submit_feedback", "resource": "*", "effect": "deny" }
]
```

### Agents that miss the rules

OpenCode creates agents that exist only in your config after plugins add their rules, so those agents get no Metaview
rules; agents that a later plugin adds are in the same position. An agent counts as guarded when the plugin's whole
block appears anywhere after its base allow. `/metaview-status` and `/metaview` list every other agent that has a base
allow and where a new Metaview tool would run without asking, by name, followed by the default rules to paste. The
next step reads:

```text
Put the default rules shown by /metaview-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Metaview tools.
```

Put the block first in that agent's own `permissions`, then repeat after it any top-level rules you have for
`metaview_*` tools, so yours keep winning. Never put the block in the top-level `permissions`: top-level rules come
after every agent's own rules, so it would loosen Explore. For an agent `reviewer`, with one top-level rule of your
own:

```json
{
  "permissions": [{ "action": "metaview_enrich_candidate_contacts", "resource": "*", "effect": "deny" }],
  "agents": {
    "reviewer": {
      "description": "Reviews changes",
      "mode": "subagent",
      "permissions": [
        { "action": "metaview_*", "resource": "*", "effect": "ask" },
        { "action": "metaview_fetch_candidates", "resource": "*", "effect": "allow" },
        "… the rest of the block from /metaview-status …",
        { "action": "metaview_enrich_candidate_contacts", "resource": "*", "effect": "deny" }
      ]
    }
  }
}
```

Copy the full block from your own `/metaview-status` output; the lines in quotes above stand for it.

## Errors

Every error from the plugin reads `CODE: What happened. Next step: What to do.`

| Code | When | Next step |
| --- | --- | --- |
| `OPTIONS_INVALID` | Setup: an option is unknown or has a wrong value. `/plugins` shows the message, which names the option and the accepted values. | Fix the plugin options in `opencode.json`. |
| `HOST_UNTESTED` | Setup: OpenCode is outside `>=2.2.3 <2.3.0`, and `allowUntestedHost` is not set. | Use OpenCode `>=2.2.3 <2.3.0`, or set `"allowUntestedHost": true`. |
| `STATUS_UNAVAILABLE` | `/metaview-status`, `/metaview` or the status RPC: the status could not be read, or the plugin is not running on the server. The RPC answers with its error `unavailable`. | The message's own next step: restart OpenCode and run the command again, or, when the plugin is not running, run `/plugins` to see why. |
| `SKILLS_INVALID` | Setup: a skill file is missing or broken. The plugin still starts; status shows the problem. | Reinstall the plugin. |
| `SERVER_NOT_REGISTERED` | Setup: the `metaview` server could not be registered. Status shows the problem. | Restart OpenCode. |
| `RULES_NOT_ADDED` | Setup: the default permission rules could not be added, so Metaview tools may run without asking. Status shows the problem. | Restart OpenCode. |

For example:

```text
OPTIONS_INVALID: Unknown option "apiKey". Accepted options: "allowUntestedHost". Next step: Fix the plugin options in opencode.json, for example "plugins": [{ "package": "@joe-broadhead/opencode-metaview", "options": { "allowUntestedHost": true } }].
```

Errors from Metaview's server and from OpenCode pass through unchanged, except in the tools RPC for scripts, whose codes
are in [Scripting](scripting.md#errors).

## Status and RPC

`/metaview-status`, the `/metaview` dialog and the RPC method `status` (RPC ID `metaview.workspace`) share one status
model. It holds no token, no header and no URL query, and makes no Metaview call. `version`, `host`, `state`,
`unguardedAgents` and `nextStep` are the fields every plugin of this family shares, with the same names and meanings:

| Field | Content |
| --- | --- |
| `version` | The plugin's version |
| `state` | `connected`, `sign_in_required`, `connecting`, `disabled`, `failed`, `not_configured` or `conflict`. The `Connection` row shows the same states as `connected`, `sign-in required`, `connecting`, `disabled`, `failed`, `not configured` and `conflict`. |
| `error` | For a failed connection only: OpenCode's reason, on one line of at most 160 characters, with any URL cut before its query. The text for a needed sign-in can hold an authorization URL, so it is never shown. |
| `source` | `type` (`plugin`, `adopted` or `conflict`), `url`, `signIn` (`oauth`, or `own` for your own entry with `"oauth": false`), and for a conflict the `expected` URL |
| `workspace` | The Metaview workspace's name, or `null` until the first `get_user_context` call since OpenCode started |
| `role` | `admin` (every conversation in the workspace), `member` (your own and those shared with you), or `null` until read |
| `plan` | `paid`, `free` (transcripts, summaries and AI fields may be limited), `credits` (conversations unlock on the workspace's shared platform credits), or `null` until read |
| `tools` | How many Metaview tools OpenCode lists that the default rules let run or ask: the listed ones, without the denied ones |
| `deniedTools` | The listed tools that the default rules deny, such as `submit_feedback`. The `Tools` row shows them as "off by default"; your own later `ask` rule may have turned one on. |
| `listing` | True while a server that connected moments ago lists no tools yet. The next step is then to run `/metaview-status` again in a few seconds, not to ask an admin. |
| `unknownCount`, `unknownTools` | How many of them the plugin does not know, and at most 20 of their names, only those made of lowercase letters, digits and `_` |
| `unguardedAgents` | Agents where a new Metaview tool would run without asking; empty when there are none. An agent whose own rules already ask or deny for every Metaview tool is not listed. |
| `shadowedSkills` | Present only when a skill with one of the plugin's ids, such as your own `metaview` skill, replaces the plugin's: each `id` and the `path` OpenCode loads instead |
| `host` | `version` (`null` if OpenCode reports none), `range` (the supported range) and `tested` (true only for 2.2.3, 2.2.4 and 2.2.5) |
| `problems` | Setup problems, each `CODE: What happened. Next step: What to do.` |
| `nextStep` | Exactly one next step: the `Next step` row, `Nothing to do.` when nothing is needed |

The workspace, role and plan come from the fields `workspace_name`, `is_admin` and `is_paying_plan` of a
`get_user_context` result, made by the model or by a script, and are kept in memory only. When the result has
`notes_on_platform_credits` instead of `is_paying_plan`, the plan is `credits`; that note's text is not read. Nothing
else of the result is read. They are forgotten when the server is no longer connected, or the account is switched.

When the status cannot be read, the method answers with its error `unavailable`: the message
`STATUS_UNAVAILABLE: Could not read Metaview's status (…).` and `data: { nextStep }`.
