// src/tui.ts
import { Plugin } from "@opencode/plugin/tui";

// src/redact.ts
var SECRETS = [
  [/\b(bearer|basic|token)\s+[\w.~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\b([\w-]*(?:api[_-]?key|access[_-]?key|private[_-]?key|token|secret|password|signature|credential)["']?\s*[:=]\s*)["']?[^\s"'&,;]+["']?/gi, "$1[redacted]"],
  [/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g, "[redacted]"],
  [/\b(?:tvly|sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abposr]|lin_api|lin_oauth)[-_][\w-]{8,}/gi, "[redacted]"],
  [/[\w+=-]{40,}/g, "[redacted]"]
];
var REASON_LIMIT = 160;
var CONTROLS = /[\u0000-\u001f\u007f-\u009f]+/g;
var BIDI = /[‎‏‪-‮⁦-⁩]/g;
var withoutUrlSecrets = (text) => text.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => url.replace(/^(https?:\/\/)[^/?#@]*@/i, "$1").replace(/[?#].*$/s, ""));
var oneLine = (text) => text.replace(BIDI, "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
function cut(text, limit) {
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}\u2026` : text;
}
function shortReason(text) {
  const reason = oneLine(SECRETS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), withoutUrlSecrets(text))).replace(/[.\s]+$/, "");
  if (reason === "") return void 0;
  return cut(reason, REASON_LIMIT);
}

// src/tui.ts
import { createSignal } from "solid-js";

// src/constants.ts
var PLUGIN_ID = "metaview.workspace";
var SERVER_NAME = "metaview";
var SUPPORTED_HOST = ">=2.2.3 <2.3.0";
var TESTED_HOSTS = ["2.2.3", "2.2.4", "2.2.5", "2.2.6"];
var errorText = (code, message, nextStep) => `${code}: ${message} Next step: ${nextStep}`;

// src/host-version.ts
var RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;
var parse = (version) => RELEASE.exec(version)?.slice(1).map(Number);
var [LOWEST, ABOVE] = SUPPORTED_HOST.split(" ").map((bound) => parse(bound.replace(/^[<>]=?/, "")));
var compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function isSupportedHost(version) {
  const parts = parse(version);
  return parts !== void 0 && compare(parts, LOWEST) >= 0 && compare(parts, ABOVE) < 0;
}

// src/metaview-tools.ts
var READ_TOOLS = [
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
  "list_connectors",
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
  "search_snippets"
];
var WRITE_TOOLS = [
  "create_ai_field",
  // destructive: an update clears every existing value
  "create_job_post_check",
  "create_report",
  "create_snippet",
  "enrich_candidate_contacts",
  "generate_notes",
  "give_sourcing_feedback",
  "manage_note_template",
  // destructive: an update replaces every section
  "manage_notes_sources",
  "manage_sequence",
  // destructive: an update deletes the steps it does not list
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
  "upsert_job_post_template"
];
var DESTRUCTIVE_TOOLS = ["give_application_review_candidate_feedback", "manage_candidate_sequence", "submit_feedback"];

// src/permissions.ts
var actionOf = (tool) => `${SERVER_NAME}_${tool}`;
var rule = (tool, effect) => ({ action: actionOf(tool), resource: "*", effect });
var defaultRules = (access = "all") => {
  const other = access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny";
  return [
    rule("*", other),
    ...READ_TOOLS.map((tool) => rule(tool, "allow")),
    ...[...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].map((tool) => rule(tool, other))
  ];
};

// src/status.ts
var SIGN_IN = `Run /connect and choose Metaview, then press o or Enter to open the link (in a terminal, opencode mcp auth ${SERVER_NAME} opens it automatically).`;
var agentRulesText = (access) => defaultRules(access).map((rule2, index, rules) => `  ${JSON.stringify(rule2)}${index < rules.length - 1 ? "," : ""}`).join("\n");
var TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`;
var STATE_TEXT = {
  connected: "connected",
  connecting: "connecting",
  sign_in_required: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict"
};
var NOT_READ = "not read yet";
var ROLE_TEXT = { admin: "admin: every conversation in the workspace", member: "member: your own conversations and those shared with you" };
var PLAN_TEXT = {
  paid: "paid",
  free: "free: transcripts, summaries and AI fields may be limited",
  credits: "shared credits: conversations unlock on the workspace's platform credits"
};
var RULES_NOT_ADDED = "RULES_NOT_ADDED:";
function serverText(source) {
  if (source.type === "plugin") return `${source.url}, registered by this plugin`;
  if (source.type === "adopted") return `${source.url}, your own mcp.servers.${SERVER_NAME}${source.signIn === "own" ? " without OAuth" : ""}, used unchanged`;
  return `your mcp.servers.${SERVER_NAME} points at ${source.url}`;
}
function toolsText(status) {
  const { tools, unknownCount, unknownTools, listing } = status;
  if (listing) return "none listed yet (Metaview is still listing them)";
  if (unknownCount === 0) return `${tools} available, 0 unknown`;
  const more = unknownCount - unknownTools.length;
  const names = unknownTools.length ? `: ${unknownTools.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : "";
  return `${tools} available, ${unknownCount} unknown${names} (${unknownPosture(status)})`;
}
var unknownPosture = ({ access }) => access === "all" ? "new tools run too" : access === "read-only" ? "new tools are denied" : "unknown tools ask before running";
function accessText({ role, problems, unguardedAgents: unguardedAgents2, access }) {
  const posture = access === "all" ? "every tool runs without asking, reads and new tools included" : access === "read-only" ? "reads run without asking; every other tool is denied" : "reads run without asking; changes and new tools ask first";
  const rules = problems.some((problem) => problem.startsWith(RULES_NOT_ADDED)) ? "default rules not added (see the OpenCode row)" : unguardedAgents2.length ? "default rules missing in the agents listed below" : "no agent runs new Metaview tools unasked";
  return `${posture}; ${role ? ROLE_TEXT[role] : `role ${NOT_READ}`}; ${rules}`;
}
function hostText({ host, problems }) {
  const { version, range, tested } = host;
  const outside = version === null || !isSupportedHost(version);
  const notes = [
    ...outside ? [`It is outside the supported range; the plugin runs because allowUntestedHost is true. If Metaview misbehaves, use OpenCode ${TESTED_TEXT}.`] : [],
    ...problems
  ];
  return `${version ?? "unknown version"} (${tested ? "tested" : "untested"}; supported range ${range})${notes.length ? `. ${notes.join(" ")}` : ""}`;
}
function formatStatus(status) {
  const { source, unguardedAgents: agents } = status;
  const details = [status.error, source && serverText(source), status.listing && "still listing its tools"].filter(Boolean).join("; ");
  return [
    "Metaview status",
    `- Connection: ${STATE_TEXT[status.state]}${details ? ` (${details})` : ""}`,
    `- Account: ${status.workspace ?? `${NOT_READ} (it appears after the first ${SERVER_NAME}_get_user_context call since OpenCode started)`}`,
    `- Access: ${accessText(status)}`,
    `- Plan: ${status.plan ? PLAN_TEXT[status.plan] : NOT_READ}`,
    `- Tools: ${toolsText(status)}`,
    `- Agents without default rules: ${agents.length ? `${agents.join(", ")}
${agentRulesText(status.access)}` : "none"}`,
    `- OpenCode: ${hostText(status)}`,
    `- Next step: ${status.nextStep}`
  ].join("\n");
}
var strings = { type: "array", items: { type: "string" } };
var count = { type: "integer", minimum: 0 };
var nullableString = { type: ["string", "null"] };
var StatusRpc = {
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["version", "state", "workspace", "role", "plan", "access", "tools", "listing", "unknownCount", "unknownTools", "unguardedAgents", "host", "problems", "nextStep"],
        properties: {
          version: { type: "string" },
          state: { enum: ["connected", "sign_in_required", "connecting", "disabled", "failed", "not_configured", "conflict"] },
          error: { type: "string" },
          source: {
            type: "object",
            required: ["type", "url"],
            properties: { type: { enum: ["plugin", "adopted", "conflict"] }, url: { type: "string" }, expected: { type: "string" }, signIn: { enum: ["oauth", "own"] } }
          },
          workspace: nullableString,
          role: { enum: ["admin", "member", null] },
          plan: { enum: ["paid", "free", "credits", null] },
          access: { enum: ["all", "ask-changes", "read-only"] },
          tools: count,
          listing: { type: "boolean" },
          unknownCount: count,
          unknownTools: strings,
          unguardedAgents: strings,
          shadowedSkills: {
            type: "array",
            items: { type: "object", required: ["id", "path"], properties: { id: { type: "string" }, path: { type: "string" } } }
          },
          host: {
            type: "object",
            required: ["version", "range", "tested"],
            properties: { version: nullableString, range: { type: "string" }, tested: { type: "boolean" } }
          },
          problems: strings,
          nextStep: { type: "string" }
        }
      },
      errors: { unavailable: { type: "object", required: ["nextStep"], properties: { nextStep: { type: "string" } } } }
    }
  },
  events: {}
};

// src/tui.ts
var TUI_ID = "metaview.workspace.tui";
var TITLE = "Metaview status";
var KEYS = "r refresh \xB7 esc close";
function viewMessage(result) {
  return `${reportOf(result)}

${KEYS}`;
}
function reportOf(result) {
  if ("status" in result) return formatStatus(result.status).split("\n").slice(1).join("\n");
  const { error } = result;
  const type = typeof error === "object" && error !== null && "type" in error ? error.type : void 0;
  if (type === "unavailable") {
    const { message, data } = error;
    if (typeof message === "string" && typeof data?.nextStep === "string") return `${message} Next step: ${data.nextStep}`;
  }
  if (type === "rpc.unavailable" || type === "rpc.method_not_found") {
    return errorText("STATUS_UNAVAILABLE", "The Metaview plugin is not running on this OpenCode server.", "Run /plugins to see why it did not start.");
  }
  const reason = shortReason(typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error));
  return errorText("STATUS_UNAVAILABLE", `Could not read Metaview's status${reason ? ` (${reason})` : ""}.`, "Restart OpenCode, then run /metaview again.");
}
function setupView(context) {
  let open;
  let latest = 0;
  let stops = [];
  const unsubscribe = () => {
    for (const stop of stops.splice(0)) stop();
  };
  const subscribe = () => {
    if (stops.length) return;
    stops = [
      context.data.on("mcp.status.changed", (event) => {
        if (event.data.server === SERVER_NAME) refresh();
      }),
      // Status events can be missed while the TUI is reconnecting.
      context.data.on("server.connected", refresh),
      context.data.on("agent.updated", refresh),
      // Signing in, out or switching accounts changes the account and the sign-in state.
      context.data.on("integration.updated", refresh),
      context.data.on("credential.updated", refresh),
      context.data.on("credential.switched", refresh)
    ];
  };
  const [shown, setShown] = createSignal(false);
  const show = async (refresh2) => {
    if (refresh2 && open === void 0) return;
    const request = ++latest;
    const location = context.location;
    const result = await context.client.rpc(StatusRpc).status({}, location ? { location } : {}).then((status) => ({ status }), (error) => ({ error }));
    if (request !== latest || refresh2 && open === void 0) return;
    open = request;
    setShown(true);
    subscribe();
    void context.ui.dialog.alert({ title: TITLE, message: viewMessage(result) }).then(() => {
      if (open !== request) return;
      open = void 0;
      setShown(false);
      unsubscribe();
    });
    context.ui.dialog.set({ size: "large" });
  };
  const refresh = () => void show(true);
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "metaview.workspace.status",
        title: "Metaview: Status",
        description: "Sign-in, account, tools and the next step for Metaview",
        group: "Metaview",
        palette: true,
        slash: { name: "metaview" },
        run: () => show(false)
      },
      { id: "metaview.workspace.status.refresh", title: "Refresh Metaview status", group: "Metaview", bind: "r", enabled: shown, run: refresh }
    ]
  }));
  return () => {
    unsubscribe();
    if (open === void 0) return;
    open = void 0;
    setShown(false);
    context.ui.dialog.clear();
  };
}
var tui_default = Plugin.define({ id: TUI_ID, setup: setupView });
export {
  tui_default as default,
  setupView,
  viewMessage
};
