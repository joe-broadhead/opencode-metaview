# Scripting

A script can call every tool this plugin knows with no model: a cron job, a shell script, or any program that can reach
the OpenCode server. It uses the tools RPC, `metaview.workspace.tools`, through `opencode api` or an OpenCode client.

| Class | Methods |
| --- | --- |
| read | one per known read, named after Metaview's tool: `search_conversations`, `list_field_values`, `fetch_candidates`, `get_user_context` and the others, the tools the default rules allow (`READ_TOOLS` in `src/metaview-tools.ts`) |
| send | `send_job_post_message`, `send_sourcing_message`: they send a message to a person |
| write | every other known write, from `create_snippet` to `update_screen_plan` (`WRITE_TOOLS`) |
| destructive | `give_application_review_candidate_feedback`, `manage_candidate_sequence`, `submit_feedback` (`DESTRUCTIVE_TOOLS` in `src/metaview-tools.ts`): the three Metaview marks destructive, because each changes something that cannot be undone once sent |
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

Every call names a session, and the session must name an agent. Create it for the script once, with the agent the script
runs as, and keep its id (`data.id` in the reply). Give the project as the session's `location`: a session made without one belongs to the service's default location, where the project's agents may not exist, and each call then fails `Agent not found`. For example:

```sh
opencode api post /api/session -d '{"title":"weekly interviews","agent":"build","location":{"directory":"/path/to/project"}}'
```

Never borrow a session found through history or a list: the script would run as that session's agent, under its rules.
The script then runs as that agent, with exactly the access its model would have:

- The rule for the tool's permission name, such as `metaview_search_conversations`, on resource `*` is resolved
  **before** the tool runs, in OpenCode's own order: the agent's rules, then the session's, the last match winning.
- **A script gets the same default as the model: every tool is allowed.** At the default `access: "all"`, the plugin's
  block allows every known tool and the `metaview_*` namespace, so a script can read candidates, write, and send. To
  restrict a script, set the plugin option `"access": "ask-changes"` (an ask is refused, because no one can answer a
  prompt for a script) or `"access": "read-only"` (everything but the reads is denied), or give the script's agent or
  session a later rule. Only an `allow` runs; an `ask` and a `deny` are refused, with no tool call and no prompt left
  waiting. An agent defined only in your config gets no default rules; `/metaview-status` names it.
- OpenCode then checks the call itself, as it does for the model: the agent's rules, the session's rules, then saved
  approvals.

**A saved "Always allow" approval does not authorize an ad-hoc script.** It lives outside the agent's and the
session's rules, so the resolve refuses an `ask` even after a past approval. That is deliberate: a script's permission
must be reviewable in config. A script's grant is a rule in the agent's or the session's config, or a Jobs run session.
For a one-off that needs an approval-bound grant, use Jobs's `jobs_run_script`.

Session rules come after the agent's, so a session can narrow what its script may do. This one can search
conversations and resolve people, and nothing else in Metaview:

```sh
opencode api post /api/session -d '{"title":"weekly interviews","agent":"build","location":{"directory":"/path/to/project"},"permissions":[
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
opencode api post /api/rpc/metaview.workspace.tools/search_conversations -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…","input":{"rationale":"weekly interview list","limit":20}}}'
```

The tool's input is Metaview's, and Metaview defines its fields: `describe` shows each tool's schema as OpenCode lists
it now. Check it rather than guess a field name or a filter's shape.

`describe` takes nothing, or a session to resolve each method's permission for:

```sh
opencode api post /api/rpc/metaview.workspace.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{}}'
opencode api post /api/rpc/metaview.workspace.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…"}}'
```

## The location

Run the command in the project whose agent you mean, and send the call to that location explicitly:

```sh
opencode api post /api/rpc/metaview.workspace.tools/<method> -H "x-opencode-directory:$PWD" -d '{…}'
```

Without it the call goes to the service's default location and fails `rpc.unavailable` if the plugin is not loaded
there. The HTTP equivalents are the `location[directory]` query parameter and the same header. `describe` reports the
`location` that answered and a `locationHint`.

A location unloads after OpenCode's idle timeout. If a scheduled script gets `rpc.unavailable` from a location that was
loaded before, send the call again once: the request loads the location. Jobs keeps its own location loaded.

## Results

A result comes back as `{ output?, text }`: the tool's structured content when it has any, and its text parts joined by
newlines. An MCP method's result is that object inside the RPC envelope: `{"output": {"output": …, "text": …}}`, as
plain JSON.

Metaview content in it, such as transcripts and notes, is untrusted data, written by other people, and Metaview's AI
notes and summaries are Metaview's, not what was said.

A `get_user_context` call through a script also fills the workspace, role and plan that `/metaview-status` shows, as
the model's call does, unless a project uses its own `mcp.servers.metaview` with an API key: that may be another
person's account, so a script's read then updates no status.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`. `opencode api` exits with status 1 for any RPC error, after printing the error's JSON to
standard output.

| Code | When |
| --- | --- |
| `PERMISSION_DENIED` | The rules ask or deny. An `ask` is refused before dispatch: the message says the action would ask, and the next step says to add an allow rule. A `deny` names the denied action, such as `metaview_search_conversations`, and its next step says to remove or narrow that deny rule, add a later allow rule to the session, or use a session whose agent allows it. |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist in this location. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool: Metaview lists only the tools for the products your account has. |
| `SERVER_CONFLICT` | Your `opencode.json` defines its own `metaview` server at a URL other than Metaview's. `/metaview-status` names both. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `metaview` server needs a sign-in, is still connecting, could not connect, is disabled, or is missing. `/metaview-status` gives the details. |
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

- Call a tool that Metaview adds later, even with an allow rule, until this plugin classifies it.
- Run a write, a send or a destructive tool under a restricted `access`, or after you add a rule for it.
- Rely on a past "Always allow": it does not authorize an ad-hoc script.
- Use a token or key: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from
any plugin, do not run for them. The account read still records the workspace, role and plan for `/metaview-status`:
the tools RPC's `shapeResult` runs the same capture as the model path's `execute.after` hook. Metaview's model path
changes no arguments, so `shapeInput` is the identity.
