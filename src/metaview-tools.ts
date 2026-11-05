// Every fact the plugin keeps about Metaview's tools: their names, without the `metaview_` server prefix, sorted by
// what they do. The default rules, the tools RPC's methods, status's unknown tools and the tests all derive from
// these lists; `jelly.tools` in package.json and the skills' call examples are checked against them. Keep this file
// free of runtime imports.
//
// Metaview lists only the tools for the products an account has (Sourcing, Screening, Sequences, Job Posts), so a
// known tool missing from a live list is normal and never reported.
//
// The names and PARAMETERS match what OpenCode lists for Metaview's server, recorded in
// test/unit/metaview-live-tools.json (2026-11-05); the drift test pins them to it. That list carries no annotations,
// so each tool's class comes from its own description.

/** Known reads: each only reads, by its description, and sends nothing beyond its query. They run without asking. */
export const READ_TOOLS: readonly string[] = [
  "fetch_candidates",
  "find_candidate_in_sequences",
  "get_application_review_details",
  "get_application_review_rules",
  "get_chart_data",
  "get_enrichment_status",
  "get_job_post",
  "get_job_post_template",
  "get_job_post_thread",
  "get_note_template",
  "get_platform_credits",
  "get_screen_details",
  "get_screen_interview",
  "get_search_details",
  "get_sourcing_analytics",
  "get_sourcing_messages",
  // The account read: workspace name, role and plan, which status shows once the model or a script has called it.
  "get_user_context",
  "group_conversations",
  "list_application_review_candidates",
  "list_application_review_rejection_options",
  "list_application_reviews",
  "list_ats_jobs",
  "list_ats_stages",
  "list_field_values",
  "list_fields",
  "list_job_post_checks",
  "list_job_post_templates",
  "list_job_post_threads",
  "list_job_posts",
  "list_mailboxes",
  "list_note_template_groups",
  "list_note_templates",
  "list_screen_candidates",
  "list_screens",
  "list_sequence_candidates",
  "list_sequences",
  "list_sourcing_candidates",
  "list_sourcing_knowledge",
  "list_sourcing_searches",
  "search_conversations",
  "search_reports",
  "search_snippets",
]

/**
 * Known writes: they ask before they run. Some reach candidates (screening invitations, a live sequence's steps), the
 * ATS, the whole workspace or paid credits. Metaview marks the three noted here, and the two denied below, as
 * destructive (`destructiveHint`).
 */
export const WRITE_TOOLS: readonly string[] = [
  "create_ai_field", // destructive: an update clears every existing value
  "create_job_post_check",
  "create_report",
  "create_snippet",
  "enrich_candidate_contacts",
  "generate_notes",
  "give_sourcing_feedback",
  "manage_note_template", // destructive: an update replaces every section
  "manage_notes_sources",
  "manage_sequence", // destructive: an update deletes the steps it does not list
  "manage_sourcing_knowledge",
  "post_sourcing_candidates_to_ats",
  "resolve_job_post_suggestion",
  "restore_application_review_icp",
  "run_job_post_checks",
  "send_job_post_message",
  "send_sourcing_message",
  "update_application_review_icp",
  "update_application_review_rules",
  "update_screen_outreach",
  "update_screen_plan",
  "upsert_job_post_template",
]

/**
 * Off by default; a deny also hides them. A user or organisation turns one back on with a later `ask` rule for it.
 * - `give_application_review_candidate_feedback` (destructive): a REJECT or PROGRESS syncs to the ATS, and a REJECT can
 *   email the candidate. A hiring decision on a person, which can't be undone once sent.
 * - `manage_candidate_sequence` (destructive): starts or stops email, LinkedIn, SMS or WhatsApp outreach to candidates.
 * - `submit_feedback`: sends text to the Metaview team, and its own description asks the model to call it after any
 *   tool error, unasked.
 */
export const DENIED_TOOLS: readonly string[] = ["give_application_review_candidate_feedback", "manage_candidate_sequence", "submit_feedback"]

/**
 * Each known tool's input parameters, as `name:type`, with `*` after a required name, in the input schema's order.
 * Types read as the schema gives them: `array<object>|null` is an optional list of objects. Every tool takes a required
 * `rationale`. The drift script compares a saved tool list with this record, and the skills test checks every literal
 * call in a skill against it.
 */
export const PARAMETERS: Readonly<Record<string, readonly string[]>> = {
  create_ai_field: ["name*:string", "prompt*:string", "value_type*:string", "field_id:string|null", "skip_similarity_check:boolean", "skip_improvement:boolean", "rationale*:string"],
  create_job_post_check: ["title*:string", "prompt*:string", "check_type:integer", "rationale*:string"],
  create_report: ["filters:array<object>|null", "report_id:string|null", "name:string|null", "description:string|null", "group:string|null", "remove_grouping:boolean", "field_ids:array<string>|null", "sort_field:string|null", "sort_ascending:boolean", "metrics:array<object>|null", "sort_metric:object|null", "sort_metric_ascending:boolean", "only_show_recorded_conversations:boolean|null", "expand_rows:boolean|null", "min_group_conversation_count:integer|null", "rationale*:string"],
  create_snippet: ["conversation_id*:integer", "start_ms*:integer", "end_ms*:integer", "title:string", "note:string", "share_scope:string", "rationale*:string"],
  enrich_candidate_contacts: ["candidate_ids*:array<string>", "enrichment_type*:string", "rationale*:string"],
  fetch_candidates: ["candidates*:array<object>", "rationale*:string"],
  find_candidate_in_sequences: ["candidate_id:string|null", "linkedin_url:string|null", "email:string|null", "phone_number:string|null", "rationale*:string"],
  generate_notes: ["conversation_id*:string", "template:string|null", "template_definition_id:string|null", "rationale*:string"],
  get_application_review_details: ["application_review_id*:string", "icp_version:integer|null", "detail_level:string", "rationale*:string"],
  get_application_review_rules: ["rationale*:string"],
  get_chart_data: ["chart_inputs*:array<object>", "report_id:string|null", "filters:array<object>|null", "only_show_recorded_conversations:boolean", "group:string|null", "min_count:integer", "timezone_offset_minutes:integer", "rationale*:string"],
  get_enrichment_status: ["person_id:integer|null", "month:string|null", "include_usage_by_user:boolean", "include_enrichment_attempts:boolean", "enrichment_type:string|null", "offset:integer", "limit:integer", "candidate_ids:array<string>|null", "rationale*:string"],
  get_job_post: ["job_post_id*:string", "message_limit:integer", "before:string|null", "content_offset:integer", "rationale*:string"],
  get_job_post_template: ["template_id*:string", "rationale*:string"],
  get_job_post_thread: ["job_post_id*:string", "thread_id*:string", "limit:integer", "offset:integer", "rationale*:string"],
  get_note_template: ["template_id*:string", "rationale*:string"],
  get_platform_credits: ["include_people:boolean", "rationale*:string"],
  get_screen_details: ["screen_id*:string", "detail_level:string", "plan_version:integer|null", "rationale*:string"],
  get_screen_interview: ["screen_id*:string", "candidate_id*:string", "rationale*:string"],
  get_search_details: ["search_id*:string", "icp_version:integer|null", "rationale*:string"],
  get_sourcing_analytics: ["metric*:string", "time_period:string|null", "start_date:string|null", "end_date:string|null", "group_by:string|null", "user_id:integer|null", "search_id:string|null", "include_archived:boolean", "limit:integer", "offset:integer", "rationale*:string"],
  get_sourcing_messages: ["search_id*:string", "limit:integer", "offset:integer", "rationale*:string"],
  get_user_context: ["rationale*:string"],
  give_application_review_candidate_feedback: ["application_review_id*:string", "candidate_ids*:array<string>", "decision*:string", "feedback_text:string|null", "rejection_reason_id:string|null", "rejection_email_template_id:string|null", "rationale*:string"],
  give_sourcing_feedback: ["search_id*:string", "feedbacks*:array<object>", "request_refinement:boolean", "rationale*:string"],
  group_conversations: ["group_by*:string", "report_id:string|null", "filters:array<object>|null", "only_show_recorded_conversations:boolean", "search_term:string|null", "min_conversation_count:integer", "offset:integer", "limit:integer", "metrics:array<object>|null", "sort_metric:object|null", "sort_ascending:boolean", "rationale*:string"],
  list_application_review_candidates: ["application_review_id*:string", "limit:integer", "offset:integer", "detail_level:string", "decision_filter:string", "fit_filter:string|null", "rationale*:string"],
  list_application_review_rejection_options: ["application_review_id*:string", "rationale*:string"],
  list_application_reviews: ["include_archived:boolean", "search_term:string|null", "limit:integer", "offset:integer", "rationale*:string"],
  list_ats_jobs: ["query:string|null", "limit:integer", "offset:integer", "posting_type:string|null", "rationale*:string"],
  list_ats_stages: ["job_id:string|null", "posting_type:string|null", "rationale*:string"],
  list_field_values: ["field_id*:string", "report_id:string|null", "filters:array<object>|null", "only_show_recorded_conversations:boolean", "search_term:string|null", "offset:integer", "limit:integer", "rationale*:string"],
  list_fields: ["report_id:string|null", "search_term:string|null", "field_ids:array<string>|null", "offset:integer", "limit:integer", "rationale*:string"],
  list_job_post_checks: ["job_post_id:string|null", "limit:integer", "offset:integer", "rationale*:string"],
  list_job_post_templates: ["offset:integer", "limit:integer", "rationale*:string"],
  list_job_post_threads: ["job_post_id*:string", "limit:integer", "offset:integer", "rationale*:string"],
  list_job_posts: ["search:string|null", "limit:integer", "offset:integer", "created_by_user_id:integer|null", "rationale*:string"],
  list_mailboxes: ["rationale*:string"],
  list_note_template_groups: ["rationale*:string"],
  list_note_templates: ["search_term:string|null", "include_detail:boolean", "offset:integer", "limit:integer", "rationale*:string"],
  list_screen_candidates: ["screen_id*:string", "stage:string|null", "detail_level:string", "limit:integer", "offset:integer", "rationale*:string"],
  list_screens: ["include_archived:boolean", "search_term:string|null", "limit:integer", "offset:integer", "rationale*:string"],
  list_sequence_candidates: ["sequence_id:string|null", "candidate_sequence_id:string|null", "include_detail:boolean", "include_messages:boolean", "status:string|null", "search_term:string|null", "offset:integer", "limit:integer", "rationale*:string"],
  list_sequences: ["sequence_id:string|null", "created_by_person_id:integer|null", "search_term:string|null", "include_detail:boolean", "include_disabled:boolean", "offset:integer", "limit:integer", "rationale*:string"],
  list_sourcing_candidates: ["search_id*:string", "pack:integer|null", "limit:integer", "offset:integer", "detail_level:string", "feedback_status:string", "rationale*:string"],
  list_sourcing_knowledge: ["rationale*:string"],
  list_sourcing_searches: ["limit:integer", "offset:integer", "rationale*:string"],
  manage_candidate_sequence: ["action*:string", "sequence_id:string|null", "candidate_ids:array<string>|null", "candidate_sequence_id:string|null", "candidate_sequence_step_id:string|null", "subject_override:string|null", "template_override:string|null", "clear_subject_override:boolean|null", "clear_template_override:boolean|null", "schedule_override:object|null", "clear_schedule_override:boolean|null", "context_source_type:string|null", "context_source_id:string|null", "rationale*:string"],
  manage_note_template: ["action*:string", "template_id:string|null", "name:string|null", "sections:array<object>|null", "group_name:string|null", "filters:array<object>|null", "apply_to_workspace:boolean", "rationale*:string"],
  manage_notes_sources: ["conversation_id*:string", "action*:string", "conversation_ids:array<string>|null", "documents:array<object>|null", "source_ids:array<string>|null", "rationale*:string"],
  manage_sequence: ["action*:string", "sequence_id:string|null", "name:string|null", "description:string|null", "set_enabled:boolean|null", "unsendable_step_behavior:string|null", "steps:array<object>|null", "rationale*:string"],
  manage_sourcing_knowledge: ["action*:string", "knowledge_id:string|null", "name:string|null", "content:string|null", "scope:string|null", "rationale*:string"],
  post_sourcing_candidates_to_ats: ["search_id*:string", "candidate_ids*:array<string>", "job_id:string|null", "stage_id:string|null", "posting_type:string|null", "rationale*:string"],
  resolve_job_post_suggestion: ["job_post_id*:string", "comment_id*:string", "action*:string", "base_version_id*:string", "base_version_operations_count*:integer", "request_id*:string", "rationale*:string"],
  restore_application_review_icp: ["application_review_id*:string", "version*:integer", "rationale*:string"],
  run_job_post_checks: ["job_post_id*:string", "check_ids*:array<string>", "rationale*:string"],
  search_conversations: ["report_id:string|null", "filters:array<object>|null", "fields:array<string>|null", "only_show_recorded_conversations:boolean", "sort_by:string|null", "sort_ascending:boolean", "offset:integer", "limit:integer", "conversation_ids:array<integer>|null", "rationale*:string"],
  search_reports: ["report_ids:array<string>|null", "include_detail:boolean", "search_term:string|null", "category:string|null", "sort_key:string|null", "sort_order:string|null", "offset:integer", "limit:integer", "rationale*:string"],
  search_snippets: ["conversation_id*:integer", "prompt*:string", "rationale*:string"],
  send_job_post_message: ["message*:string", "job_post_id:string|null", "template_id:string|null", "request_id:string|null", "rationale*:string"],
  send_sourcing_message: ["message*:string", "search_id:string|null", "mode:string", "rationale*:string"],
  submit_feedback: ["category*:string", "feedback*:string", "rationale*:string"],
  update_application_review_icp: ["application_review_id*:string", "icp_text*:string", "base_version*:integer", "rationale*:string"],
  update_application_review_rules: ["rules*:string", "rationale*:string"],
  update_screen_outreach: ["screen_id*:string", "base_version*:integer|null", "subject:string|null", "body_html:string|null", "cc:array<string>|null", "bcc:array<string>|null", "deadline_after_days:number|null", "deadline_day_kind:string|null", "clear_deadline:boolean", "reject_at_deadline:boolean|null", "include_opt_out_link:boolean|null", "rationale*:string"],
  update_screen_plan: ["screen_id*:string", "base_version*:integer|null", "sections:array<object>|null", "role_context:string|null", "company_context:string|null", "rationale*:string"],
  upsert_job_post_template: ["name*:string", "sections*:array<object>", "title:string|null", "template_id:string|null", "rationale*:string"],
}

type ToolClass = "read" | "write" | "denied" | "unknown"

export function classify(name: string): ToolClass {
  if (READ_TOOLS.includes(name)) return "read"
  if (WRITE_TOOLS.includes(name)) return "write"
  if (DENIED_TOOLS.includes(name)) return "denied"
  return "unknown"
}
