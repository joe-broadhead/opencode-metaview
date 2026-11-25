# Capabilities

Every method, source, action and bus event the manifest declares.

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

## Notes

- **`status`** reads no account. It reports the plugin's version, the OpenCode host, the state of every alias and any
  next step. It carries no conversation and no credential.
- **`probe`** reads one account's signed-in Metaview owner, from `get_user_context`, and nothing else.
- **`events_list`** reads the `conversations` source for one account, oldest first. A page is metadata only: each
  conversation is a `meeting` event with its start, its candidate and interviewers by name and Metaview id, and a link
  into Metaview. A transcript, a summary, an email or a phone number is never in a page.
- **The source** is `metaview.conversations`: private, free, 256 KB per answer, with URLs on `app.metaview.ai`. Its
  `reports` scope narrows a read to the saved reports a person confirms. A cursor is bound to the plugin, source,
  account and scope; another account's cursor is `CURSOR_INVALID`.
- **The 68 `mcp:` rows** are Metaview's own MCP tools, passed through from one server per alias. The plugin does not
  proxy or re-implement them; each row's class and `operations` tell a consumer how risky the call is before it runs.
  `mcp:create_snippet` is `share` because every snippet gets a share link, and `share_scope: "anyone_with_link"` opens it
  without a sign-in; a workspace-only scope is the narrower case, and the class stays `share`.
- **No actions and no bus events.** The plugin makes no Metaview write of its own: every write is the vendor's MCP tool,
  with its own permission action. A `changed` nudge belongs after a write the plugin makes, so the manifest declares
  none. A consumer that wants a write confirmation gets it from the vendor tool's own permission rule.
