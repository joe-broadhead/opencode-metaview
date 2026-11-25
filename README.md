# Metaview for OpenCode

Read a recruiting workspace's Metaview conversations, candidates, notes and reports from OpenCode. The plugin registers
Metaview's official MCP server, one server per account alias, so every tool Metaview serves is available to the agent,
and adds the contract's own reads: `status`, `probe` and `events_list` for the conversations source. It adds no tool of
its own beyond those reads: every Metaview call is one of the vendor's own MCP tools, executed through OpenCode.

Unofficial; not affiliated with Metaview. Metaview is a trademark of Metaview Labs Inc.; this plugin is not endorsed by
them.

## Requirements

- OpenCode `>=2.4.1 <2.5.0`, tested on 2.4.1 only. Outside that range the plugin refuses to start, unless you set
  `allowUntestedHost`.
- A Metaview account in a workspace where an admin has turned on **MCP integration**. Members also need **MCP for
  non-admins** (Metaview: Workspace settings).
- What you can read follows your Metaview role: admins see every conversation in the workspace, members their own and
  those shared with them. Which tools appear depends on the Metaview products you have, and reports, AI fields and full
  transcripts may need a paid Metaview plan.

## Install

Install from a release tag. Releases start at `v0.0.0`; the first tag is cut once this repository's release pull request
is merged.

```sh
opencode plugin add github:we-the-rebel-alliance/metaview-plugin#v<version>
```

Run `opencode reload`, or restart OpenCode. Then ask for a read; `status` shows whether the account is signed in.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:we-the-rebel-alliance/metaview-plugin#v<version>" }] }
```

## Sign in

The first account is the MCP server `metaview`; every other alias gets its own server, `metaview-<alias>`. Run
`/connect` and choose the server for the account, then open the link with `o` or Enter. In a terminal, run
`opencode mcp auth metaview` (or `opencode mcp auth metaview-work`). No key is needed.

Configure several aliases in `opencode.json`:

```json
{ "accounts": { "work": {}, "personal": {} } }
```

Each alias signs in separately. Methods that take an account accept `account: "work"` or `account: "personal"`. With
two aliases and no account, a call is refused with `ACCOUNT_REQUIRED`.

## Access

`access` is `all` (the default), `ask-changes` or `read-only`. Metaview's own tools and the plugin's reads are separate
permission actions, so a person can narrow either.

| Value | Reads | Writes and sends |
|---|---|---|
| `"all"` (the default) | run | run |
| `"ask-changes"` | run | ask first |
| `"read-only"` | run | are off |

The classes come from the manifest: a Metaview tool that sends or deletes something is `send` or `delete`, and asks
under `"ask-changes"`. A rule of your own in an agent's `permissions` still wins for one tool.

## Capabilities

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | `get_user_context` |
| `events_list` | read | optional | `get_user_context`, `search_conversations` |
| `mcp:fetch_candidates` | read | none | `fetch_candidates` |
| `mcp:find_candidate_in_sequences` | read | none | `find_candidate_in_sequences` |
| `mcp:get_application_review_details` | read | none | `get_application_review_details` |
| `mcp:get_application_review_rules` | read | none | `get_application_review_rules` |
| `mcp:get_chart_data` | read | none | `get_chart_data` |
| `mcp:get_enrichment_status` | read | none | `get_enrichment_status` |
| `mcp:get_job_post` | read | none | `get_job_post` |
| `mcp:get_job_post_template` | read | none | `get_job_post_template` |
| `mcp:get_job_post_thread` | read | none | `get_job_post_thread` |
| `mcp:get_note_template` | read | none | `get_note_template` |
| `mcp:get_platform_credits` | read | none | `get_platform_credits` |
| `mcp:get_screen_details` | read | none | `get_screen_details` |
| `mcp:get_screen_interview` | read | none | `get_screen_interview` |
| `mcp:get_search_details` | read | none | `get_search_details` |
| `mcp:get_sourcing_analytics` | read | none | `get_sourcing_analytics` |
| `mcp:get_sourcing_messages` | read | none | `get_sourcing_messages` |
| `mcp:get_user_context` | read | none | `get_user_context` |
| `mcp:group_conversations` | read | none | `group_conversations` |
| `mcp:list_application_review_candidates` | read | none | `list_application_review_candidates` |
| `mcp:list_application_review_rejection_options` | read | none | `list_application_review_rejection_options` |
| `mcp:list_application_reviews` | read | none | `list_application_reviews` |
| `mcp:list_ats_jobs` | read | none | `list_ats_jobs` |
| `mcp:list_ats_stages` | read | none | `list_ats_stages` |
| `mcp:list_connectors` | read | none | `list_connectors` |
| `mcp:list_field_values` | read | none | `list_field_values` |
| `mcp:list_fields` | read | none | `list_fields` |
| `mcp:list_job_post_checks` | read | none | `list_job_post_checks` |
| `mcp:list_job_post_templates` | read | none | `list_job_post_templates` |
| `mcp:list_job_post_threads` | read | none | `list_job_post_threads` |
| `mcp:list_job_posts` | read | none | `list_job_posts` |
| `mcp:list_mailboxes` | read | none | `list_mailboxes` |
| `mcp:list_note_template_groups` | read | none | `list_note_template_groups` |
| `mcp:list_note_templates` | read | none | `list_note_templates` |
| `mcp:list_screen_candidates` | read | none | `list_screen_candidates` |
| `mcp:list_screens` | read | none | `list_screens` |
| `mcp:list_sequence_candidates` | read | none | `list_sequence_candidates` |
| `mcp:list_sequences` | read | none | `list_sequences` |
| `mcp:list_sourcing_candidates` | read | none | `list_sourcing_candidates` |
| `mcp:list_sourcing_knowledge` | read | none | `list_sourcing_knowledge` |
| `mcp:list_sourcing_searches` | read | none | `list_sourcing_searches` |
| `mcp:search_conversations` | read | none | `search_conversations` |
| `mcp:search_reports` | read | none | `search_reports` |
| `mcp:search_snippets` | read | none | `search_snippets` |
| `mcp:create_ai_field` | write | none | `create_ai_field` |
| `mcp:create_job_post_check` | write | none | `create_job_post_check` |
| `mcp:create_report` | write | none | `create_report` |
| `mcp:enrich_candidate_contacts` | write | none | `enrich_candidate_contacts` |
| `mcp:generate_notes` | write | none | `generate_notes` |
| `mcp:give_sourcing_feedback` | write | none | `give_sourcing_feedback` |
| `mcp:manage_notes_sources` | write | none | `manage_notes_sources` |
| `mcp:resolve_job_post_suggestion` | write | none | `resolve_job_post_suggestion` |
| `mcp:restore_application_review_icp` | write | none | `restore_application_review_icp` |
| `mcp:run_job_post_checks` | write | none | `run_job_post_checks` |
| `mcp:update_application_review_icp` | write | none | `update_application_review_icp` |
| `mcp:update_application_review_rules` | write | none | `update_application_review_rules` |
| `mcp:update_screen_plan` | write | none | `update_screen_plan` |
| `mcp:upsert_job_post_template` | write | none | `upsert_job_post_template` |
| `mcp:give_application_review_candidate_feedback` | send | none | `give_application_review_candidate_feedback` |
| `mcp:manage_candidate_sequence` | send | none | `manage_candidate_sequence` |
| `mcp:post_sourcing_candidates_to_ats` | send | none | `post_sourcing_candidates_to_ats` |
| `mcp:send_job_post_message` | send | none | `send_job_post_message` |
| `mcp:send_sourcing_message` | send | none | `send_sourcing_message` |
| `mcp:submit_feedback` | send | none | `submit_feedback` |
| `mcp:update_screen_outreach` | send | none | `update_screen_outreach` |
| `mcp:create_snippet` | share | none | `create_snippet` |
| `mcp:manage_note_template` | delete | none | `manage_note_template` |
| `mcp:manage_sequence` | delete | none | `manage_sequence` |
| `mcp:manage_sourcing_knowledge` | delete | none | `manage_sourcing_knowledge` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `metaview.conversations` | events | `meeting` | `events_list` | free |

### Actions

None.

### Bus events

None.
<!-- /generated:capabilities -->

## Errors

<!-- generated:errors -->
| Code | Meaning |
|---|---|
| `NEEDS_SIGN_IN` | the account is not signed in |
| `SCOPE_MISSING` | the call needs a scope the person has not confirmed |
| `ACCOUNT_REQUIRED` | the plugin serves several accounts and the call names none |
| `ACCOUNT_UNKNOWN` | the call names an alias the plugin does not serve |
| `ACCOUNT_MISMATCH` | the item belongs to another account |
| `CURSOR_INVALID` | the cursor is malformed, or belongs to another source, account or scope |
| `CURSOR_EXPIRED` | the provider no longer keeps the history the cursor names |
| `RATE_LIMITED` | the provider asked the plugin to slow down |
| `BUDGET_EXCEEDED` | the read would cost more than the person allows |
| `SOURCE_DISABLED` | the person turned this source or action off |
| `TOO_LARGE` | the answer is larger than the source's maxBytes |
| `INPUT_INVALID` | the input does not match the method's schema |
| `SOURCE_UNKNOWN` | the plugin declares no such source |
| `SCHEMA_VIOLATION` | an answer does not keep the contract's shape |
| `PERMISSION_DENIED` | the person's grant does not cover the call |
| `PLAN_INVALID` | the plan is missing, or belongs to another method |
| `PLAN_USED` | the plan was already used by an earlier commit |
| `GRANT_INVALID` | the action grant did not verify, or was already spent |
| `HOST_UNTESTED` | OpenCode is outside the plugin's tested range |
| `OPTIONS_INVALID` | the plugin's options do not match their schema |
| `UNAVAILABLE` | the provider could not be reached |
<!-- /generated:errors -->

## Docs

- [Capabilities](docs/capabilities.md)
- [Configuration](docs/configuration.md)
- [Accounts](docs/accounts.md)
- [Automations](docs/automations.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
