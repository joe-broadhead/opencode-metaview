# Scripting

A script can call every tool this plugin knows with no model: a cron job, a shell script, or any program that can reach
the OpenCode server. It uses the tools RPC, `metaview.workspace.tools`, through `opencode api` or an OpenCode client.

| Class | Methods |
| --- | --- |
| read | one per known read, named after Metaview's tool: `search_conversations`, `list_field_values`, `fetch_candidates`, `get_user_context` and the others, the tools the default rules allow (`READ_TOOLS` in `src/metaview-tools.ts`) |
| send | `send_job_post_message`, `send_sourcing_message`: they send a message to a person |
| write | every other known write, from `create_snippet` to `update_screen_plan` (`WRITE_TOOLS`) |
| destructive | `give_application_review_candidate_feedback`, `manage_candidate_sequence`, `submit_feedback` (`DENIED_TOOLS`): denied by default, so a script is refused them unless the user opts one in |
| `describe` | not a tool: lists the methods, their classes and permission actions, whether OpenCode lists each tool now, each tool's input as JSON Schema, and — with a session — that session's permission for each |

The class is the worst thing a tool can do. It never decides whether a call runs: the rules do. It is what `describe`
reports and what a job's approval shows. Call `describe` for the list: Metaview lists only the tools for the products
your account has, so `describe` marks a known tool that Metaview does not offer you as unavailable.

Each method runs the tool with the same input: Metaview's own tool, through OpenCode's own connection and sign-in. The
plugin never sees the OAuth token, or the API key of your own server entry. A tool that Metaview adds later is not a
method until this plugin classifies it, and `describe` lists it under `unclassified`.

Results hold candidate data, which is personal data: keep what a script writes where the people it is about would
expect it, and only as long as you need it.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with exactly the
access its model would have:

- The rule for the tool's permission name, such as `metaview_search_conversations`, on resource `*` is resolved
  **before** the tool runs, in OpenCode's own order: the agent's rules, then the session's, the last match winning.
- Only an `allow` runs. An `ask` is refused, because no one can answer a prompt for a script. A `deny` is refused.
  Neither makes a tool call or leaves a prompt waiting. The plugin's default rules allow the reads and ask for every
  write, so a script needs an allow rule for a write. An agent defined only in your config gets no default rules;
  `/metaview-status` names it.
- OpenCode then checks the call itself, as it does for the model: the agent's rules, the session's rules, then saved
  approvals.

**A saved "Always allow" approval does not authorize an ad-hoc script.** It lives outside the agent's and the
session's rules, so the resolve refuses an `ask` even after a past approval. That is deliberate: a script's permission
must be reviewable in config. A script's grant is a rule in the agent's or the session's config, or a Jobs run session.
For a one-off that needs an approval-bound grant, use Jobs's `jobs_run_script`.

Create the session once, with the agent the script runs as, and keep its id. Never reuse a session found through
history or a list: the script would run as that session's agent, under its rules.

```sh
opencode api post /api/session -d '{"title":"weekly interviews","agent":"build"}'
```

Session rules come after the agent's, so a session can narrow what its script may do. This one can search
conversations and resolve people, and nothing else in Metaview:

```sh
opencode api post /api/session -d '{"title":"weekly interviews","agent":"build","permissions":[
  {"action":"metaview_*","resource":"*","effect":"deny"},
  {"action":"metaview_search_conversations","resource":"*","effect":"allow"},
  {"action":"metaview_list_field_values","resource":"*","effect":"allow"}
]}'
```

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed. Every Metaview tool requires a `rationale` inside the tool's input: a short, generic sentence that
Metaview receives with the call, so keep names and candidate details out of it.

```sh
opencode api post /api/rpc/metaview.workspace.tools/search_conversations \
  -H "x-opencode-directory:$PWD" -d '{"input":{
  "sessionID":"ses_…",
  "input":{"rationale":"weekly interview list","limit":20}
}}'
```

**Send the call to the location you mean.** Without the header the call goes to the OpenCode service's default
location, your home directory, and fails `rpc.unavailable` when the plugin is not loaded there. The HTTP equivalents
are the `location[directory]` query parameter and the same header. A project whose own config sets other options is
reached this way; the session may belong to another directory.

The tool's input is Metaview's, and Metaview defines its fields: `describe` shows each tool's schema as OpenCode lists
it now. Check it rather than guess a field name or a filter's shape.

```sh
opencode api post /api/rpc/metaview.workspace.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{}}'
```

`describe` takes nothing, or a session to resolve each method's permission for:

```sh
opencode api post /api/rpc/metaview.workspace.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…"}}'
```

A result is `{"output": {"output": <the tool's structured content, or its text when it has none>, "text": <the tool's
text>}}`, as plain JSON. Metaview content in it, such as transcripts and notes, is untrusted data, written by other
people, and Metaview's AI notes and summaries are Metaview's, not what was said.

A `get_user_context` call through a script also fills the workspace, role and plan that `/metaview-status` shows, as
the model's call does, unless a project uses its own `mcp.servers.metaview` with an API key: that may be another
person's account, so a script's read then updates no status.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`. `opencode api` exits with status 1 for any RPC error, after printing the error's JSON to standard output.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist in this location. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `PERMISSION_DENIED` | The rules ask or deny. An `ask` is refused before dispatch: the message says the action would ask, and the next step says to add an allow rule. A `deny` names the denied action, such as `metaview_search_conversations`, and its next step says to remove or narrow that deny rule, add a later allow rule to the session, or use a session whose agent allows it. |
| `SERVER_CONFLICT` | Your `opencode.json` defines its own `metaview` server at a URL other than Metaview's. `/metaview-status` names both. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `metaview` server needs a sign-in, is still connecting, could not connect, is disabled, or is missing. `/metaview-status` gives the details. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool: Metaview lists only the tools for the products your account has. |
| `UPSTREAM_ERROR` | Metaview answered with an error, such as an invalid input or an item that does not exist. The message holds the first line of Metaview's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |

OpenCode itself answers `rpc.method_not_found` for a method that does not exist, such as a tool Metaview adds later,
`rpc.unavailable` when the plugin did not register the tools RPC or the call reached another location, and
`rpc.invalid_input` for a body that is not the envelope above, with one message per problem:

| Problem | Message |
| --- | --- |
| The envelope is not an object | `the envelope must be an object, such as {"sessionID":"<session>","input":<the tool's input>}` |
| A key other than `sessionID` and `input` | `"extra" is not allowed`, naming the key |
| `sessionID` missing, not a string, or empty | `"sessionID" must be a non-empty string` |
| `input` missing | `"input" is missing` |
| `input` not an object | `"input" must be an object` |
| `describe` given anything but `{}`, a session or nothing | `describe takes nothing, or {"sessionID":"<session>"}` |

## What scripts cannot do

- Change anything in Metaview without a prior allow rule: a write needs one, and an `ask` is refused.
- Send feedback to Metaview, record an application review decision or start outreach unless the user has opted that
  exact denied tool in: its rule resolves to `deny`, and a deny cannot be granted by a script.
- Call a tool that Metaview adds later, even with an allow rule, until this plugin classifies it.
- Rely on a past "Always allow": it does not authorize an ad-hoc script.
- Use a token or key: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from
any plugin, do not run for them. The account read still records the workspace, role and plan for `/metaview-status`:
the tools RPC's `shapeResult` runs the same capture as the model path's `execute.after` hook. Metaview's model path
changes no arguments, so `shapeInput` is the identity.
