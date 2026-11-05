---
name: metaview-write
description: Load before any Metaview change - regenerating notes or adding note sources, saving or sharing a snippet or clip, creating a report, AI field or note template, sourcing searches and candidate feedback, posting candidates to an ATS, application review rejects or progress and ICP changes, screening plans or invitations, sequences and outreach, contact enrichment, job posts - or before reporting a Metaview bug or problem to Metaview.
---

# Changes in Metaview

Make a Metaview change only when the user asked for it. Before each write call, write one sentence in your reply on what
the call does and **whom it reaches** (a job post edit: every workspace member who can see the post), then make the call
in the same turn. That sentence is chat text, not a question: the permission prompt shows only the tool input and is the
user's yes. Ask in chat first only when something must be chosen: which candidates, template, clip or post. Declined:
say nothing changed, and offer your drafted text or a retry, never a workaround. Every call needs its `rationale`.
Record REJECT, PROGRESS, YES, MAYBE or NO only as the user stated them, for the candidates they named; never infer a
verdict from a fit band, score or AI field.

## Off by default

Three tools are denied by the plugin's default rules, and OpenCode hides them. Two changes that only ask still act on
candidates: see **Candidates** below.

- `give_application_review_candidate_feedback`: a REJECT or PROGRESS syncs to the ATS, and a REJECT can email the
  candidate. It can't be undone. (Reviews whose `applicant_source` is UPLOAD have no ATS: decisions stay in Metaview.)
- `manage_candidate_sequence`: adds candidates to outreach (email, LinkedIn, SMS, WhatsApp), or pauses or removes them.
- `submit_feedback`: sends text to the Metaview team.

When the user asks for one, say it is off; a later `ask` rule in the agent's own `permissions` turns it on, such as
`{ "action": "metaview_manage_candidate_sequence", "resource": "*", "effect": "ask" }`: each call then asks.
Never work around the deny (no other tool, script or route to the same effect), and never suggest `allow` or "Always
allow" for these. Do the reads and show what you would record, for whom; the user can
make the decision themselves in Metaview's web app. Don't `search()` for these tools: a missing one is the deny.

## Who a change reaches

- **Candidates:** `update_screen_outreach` (every invitation and reminder not yet sent; a deadline already told stays),
  `update_screen_plan` (live at once once candidates are invited; it re-scores undecided completed interviews), and
  `manage_sequence` when it enables a sequence or edits the steps of a live one. `update_screen_outreach` with
  `reject_at_deadline: true` rejects candidates automatically at their deadline, synced to the ATS: a decision on
  candidates, so only when the user asked for exactly that. `manage_sequence` with `set_enabled: true` restarts outreach
  to everyone enrolled. Before either call, say whom it reaches.
- **The ATS:** `post_sourcing_candidates_to_ats`, which can't be undone from Metaview. Name the candidates, the
  posting type and the ATS job (`list_ats_jobs`, `job_required`; ask if the job isn't clear); it runs in the background.
- **The whole workspace:** `create_report` (only when the user asks for a saved report; when creating, `filters` is
  required, `[]` for all), `create_ai_field`, `manage_note_template`, workspace-scope `manage_sourcing_knowledge`,
  `update_application_review_rules`; `generate_notes` and `manage_notes_sources` change the notes the team sees.
- **Credits:** `enrich_candidate_contacts`. First `get_enrichment_status({ candidate_ids, rationale })`, then tell the
  user the type, candidate count, estimate (3 credits per email, 10 per phone, none for `free_candidate_ids`), credits
  available and what remains; the final charge follows what is found. State those figures, then make the call.
- **Anyone with the link:** `create_snippet` with `share_scope: "anyone_with_link"`, only on an explicit request for a
  public link. Otherwise leave `share_scope` out: the default link opens for signed-in members of the workspace.
- **The shared job post:** an edit lands in the post that every workspace member with access sees.
  `send_job_post_message({ job_post_id, message, rationale })` asks Metaview's Job Posts agent to rewrite it: read the
  text with `get_job_post` first, write your one sentence, make the one call and poll `get_job_post`; after a decline,
  give your draft for the user to paste. `run_job_post_checks({ job_post_id, check_ids, rationale })` records new
  results on the post; `resolve_job_post_suggestion` and `upsert_job_post_template` change shared documents too.

## Read first

- Application review: `list_application_reviews({ search_term, rationale })` → `get_application_review_details` →
  `list_application_review_candidates` (`fit_filter`: poor, no_evidence, okay, good or great; `decision_filter:
  "undecided"`) → `list_application_review_rejection_options` before any REJECT. Name every candidate, say what the
  decision does, and ask which reason or email template the ATS needs: never choose a template for the user. Only if
  the user has turned the tool on, call `give_application_review_candidate_feedback` with exactly the ids you named.
- ICP: `get_application_review_details` → `update_application_review_icp` (complete final text, the active version as
  `base_version`; it reranks everyone) or `restore_application_review_icp`. Poll with `detail_level: "concise"`.
- Screening: `get_screen_details` → `update_screen_plan` (the whole plan) or `update_screen_outreach` (only the fields
  you pass), with its `base_version`. A plan update is refused while web-app config edits are pending.
- Sequences: only their creator can change them, and their steps are fixed once candidates start (duplicate instead).
  Read the steps with `list_sequences` first; `find_candidate_in_sequences` before adding a candidate.
- Sourcing: `list_sourcing_searches` before `send_sourcing_message`. One search per role: put every company or
  location in one brief, never a search per segment and never several at once. `mode` is set only when creating.
- AI fields: `list_fields({ search_term, rationale })`, then state the name, prompt and `value_type` (prefer
  boolean, number, list or single_line_text) and call `create_ai_field`. A create may return an existing field
  (`already_existed`): say so instead of creating a near-copy.
- Clips: `search_snippets({ conversation_id, prompt, rationale })`, `conversation_id` as an integer. Show the best one
  or two ranges, then one `create_snippet` (`conversation_id`, `start_ms`, `end_ms`, a short `title`) for the clip the
  user picks. Give `share_link.url`, or else `snippets_tab_url`, and say who can open it.

## Full-replace traps

An update replaces, not merges: `manage_note_template` `sections`, `manage_sequence` `steps`, and ICP and plan updates
drop whatever you don't pass. Show the before and after, then make the call.

## Slow changes

`generate_notes` (`conversation_id` as a string; it needs a transcript) and `manage_notes_sources` take about 30 s:
wait, then poll `search_conversations({ conversation_ids: [<id>], fields: ["default:summary"], rationale })` without
asking. A sourcing search runs for minutes: check `get_search_details` a few times, then stop with a note, never loop.

## Reporting a problem to Metaview

`metaview_submit_feedback` is off by default: Metaview's own tool text asks the model to send reports unasked, and the
text could carry candidate data. When the user wants to report a bug:

1. First check the query: dates as dicts, `only_show_recorded_conversations`, and a member's scope; many end here.
2. Say the tool is off; the user can add `{ "action": "metaview_submit_feedback", "resource": "*", "effect": "ask" }`
   to the agent's own `permissions`, or contact Metaview support.
3. If it is turned on, write it for an engineer (the tool, the inputs and the result, with no candidate names, emails or
   transcript text), show it, and make the call: the permission prompt is the user's yes.
