# Security

## Supported versions

Fixes go into the newest release. Older releases are not patched.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub private vulnerability reporting: open the repository's **Security**
tab and choose **Report a vulnerability**. Do not open a public issue. Include the plugin version, the OpenCode
version, your plugin options and the steps to reproduce. Never include tokens, API keys, candidate data or other
Metaview content.

Vulnerabilities in Metaview's service or in OpenCode itself are out of scope. Report those to Metaview or to the
OpenCode project.

## Data handling

- The plugin holds no credential and runs no network request of its own. It registers Metaview's MCP server with
  OpenCode, and OpenCode connects, signs in and stores the credentials. The tools RPC for scripts (see
  [Scripts](#scripts)) runs Metaview's tools through OpenCode's own connection, too.
- The plugin never reads tokens. Of a user's own `mcp.servers.metaview` entry it reads only the type, the URL and
  whether `oauth` is `false`; it never reads, copies or reports its `headers`, where an API key may be. Status shows
  server URLs without their query strings, never OpenCode's text for a needed sign-in, which can hold an authorization
  URL, and cuts a connection failure's reason to one line with no URL query.
- The account capture keeps three fields of a `get_user_context` result in memory only: the workspace's name, whether
  the user is an admin, and whether the plan is paid (or runs on shared credits, from the presence of
  `notes_on_platform_credits`). It never reads IDs, names, emails or the `data_access` text, and
  forgets the three when the server is no longer connected, or the account is switched. The plugin never calls
  Metaview itself.
- **Candidate data is personal data.** Interview transcripts, AI notes, resumes, scorecards and contact details reach
  the model as tool results, and the agent sends them to your model provider, like any other tool result in the
  session. Your organisation's own approval of AI tools applies; Metaview recommends checking with your legal or data
  protection team before you turn on MCP.
- Every Metaview tool takes a `rationale` that Metaview receives with the call. The skills tell the model to keep it
  short and free of candidate details.
- Metaview content is untrusted. Transcripts, resumes and notes come from other people and can contain instructions
  aimed at the model. The skills tell the model to treat them as data, to label Metaview's AI output as Metaview's, and
  never to infer protected characteristics.
- Three tools are denied by default: `metaview_submit_feedback`, which sends text to the Metaview team and whose
  description invites unasked calls after an error, and the two that act on candidates and can't be undone,
  `metaview_give_application_review_candidate_feedback` (a REJECT syncs to the ATS and can email the candidate) and
  `metaview_manage_candidate_sequence` (adding candidates to outreach). Turning one on takes an `ask` rule in an
  agent's own `permissions`, so each call still asks, in that agent only.

## Permissions

What the model can do in Metaview is limited by these layers, in this order:

1. **Metaview's server and your role.** The sign-in is your own Metaview account: admins see every conversation in the
   workspace, members their own and those shared with them. Metaview lists only the tools for the products your account
   has. A workspace admin can turn MCP off for the workspace, or for members.
2. **Default permission rules.** Every Metaview tool asks before it runs, except Metaview's read tools listed in
   `src/metaview-tools.ts`, which run without a prompt. Application review decisions, adding candidates to sequences
   and `metaview_submit_feedback` are denied. Some changes that ask still reach candidates: screening plans and
   invitations, `metaview_update_screen_outreach` with `reject_at_deadline`, which rejects candidates automatically at
   their deadline, and `metaview_manage_sequence`, which can restart or edit a live sequence. Posting sourced candidates
   reaches your ATS.
3. **Your OpenCode permissions.** Your `permissions` rules and saved "Always allow" answers override the default
   rules. A `deny` you configure always wins.

Things to know:

- **Saved approvals are broad.** "Always allow" on a Metaview tool saves the pattern `*` for that tool's action. It
  applies to every agent in the OpenCode project, Plan included, until you remove it. Think twice before saving one
  for a tool that reaches candidates or your ATS. OpenCode identifies a project by its git repository. A folder outside
  any git repository with a commit may belong to OpenCode's shared `global` project, so an approval saved there may
  apply in other such folders too.
- **Some agents get no default rules.** Agents defined only in your own config, and agents added by plugins that load
  after this one, are created after the plugin inserts its rules, and agents without a base allow get none. Metaview
  tools may run there without asking. `/metaview-status` names these agents and gives the fix: put the default rules
  it shows first in that agent's own `permissions`, followed by your top-level rules for Metaview tools. Do not put
  them in the top-level `permissions`, which would loosen Explore.
- **Unattended runs refuse prompts.** In `opencode run`, a Metaview tool that would ask is refused.
- **The `metaview_*` rule also matches other servers** whose names start with `metaview_`. For their tools it only
  adds prompts.
- **The rules follow the name, not the server.** When your own `mcp.servers.metaview` points at another URL, status
  reports a conflict and the plugin adds no server, but the default rules still allow the known read names, so a tool
  of that server with such a name runs without asking. Point the entry at Metaview's URL, or remove it.

## Scripts

The tools RPC (`metaview.workspace.tools`, see
[docs/scripting.md](https://github.com/joe-broadhead/opencode-metaview/blob/HEAD/docs/scripting.md)) runs Metaview's
every known tool for a script, with no model. It adds no authority:

- A script names a session that names an agent, and runs as them. The rule for the tool's permission action is resolved
  before it runs, in OpenCode's own order (the agent's rules, then the session's, the last match winning). Only an
  `allow` runs; an `ask` and a `deny` are refused with no tool call.
- An ask is refused, not prompted: no one is there to answer it. A saved "Always allow" approval is not part of the
  agent's and the session's rules, so it does not authorize an ad-hoc script. The plugin's permission hook changes only
  an ask on one of its own script calls in flight, only to a deny, and leaves every other call alone.
- Every known tool is a method, with its class (read, send, write or destructive) shown by `describe`. The three denied
  tools stay refused unless the user opts one in; a tool that Metaview adds later is not a method until this plugin
  classifies it.
- OpenCode's own executor then checks the call against the agent's rules, the session's rules and saved approvals, as
  it does for the model.
- The call goes through OpenCode's own MCP connection and sign-in. The plugin never sees the token, and returns none.
- Metaview's error text reaches the script only as the first line, at most 300 characters, with tokens and URL query
  strings removed.
- OpenCode's `execute.before` and `execute.after` tool hooks, from any plugin, do not run for a script's call, so
  another plugin's policy hook does not see it. A script's calls are not recorded in the session.
- The RPC is reachable only by callers of the OpenCode server API, who already hold the server's full authority. The
  session is not a login: it scopes a script to what its agent may do.
