import type { Plugin, Rpc } from "@opencode/plugin"
import type { Account } from "./account.js"
import { PLUGIN_ID, SERVER_NAME, TESTED_HOSTS } from "./constants.js"
import { isSupportedHost, type HostCheck } from "./host-version.js"
import { classify } from "./metaview-tools.js"
import type { Access } from "./options.js"
import { defaultRules, unguardedAgents, type Rule } from "./permissions.js"
import { shortReason } from "./redact.js"
import { VERSION } from "./version.js"

export { shortReason }

/** The shared status labels in machine form; `/metaview-status` shows them as `sign-in required` and so on. */
type State = "connected" | "sign_in_required" | "connecting" | "disabled" | "failed" | "not_configured" | "conflict"
/**
 * Who owns the `metaview` server: this plugin, the user's own config (adopted unchanged), or a server at another URL
 * (`expected` is Metaview's). URLs are shown as origin and path only. `signIn` is `own` for an adopted entry with
 * `oauth: false`, which signs in with its own headers and has no `/connect` entry.
 */
export type ServerSource =
  | { readonly type: "plugin"; readonly url: string; readonly signIn: "oauth" }
  | { readonly type: "adopted"; readonly url: string; readonly signIn: "oauth" | "own" }
  | { readonly type: "conflict"; readonly url: string; readonly expected: string }

interface SkillPath {
  readonly id: string
  readonly path: string
}

/** What status is built from. The TUI fills what it can see; fields it cannot see stay undefined. */
export interface StatusFacts {
  readonly server?: { readonly status: "connected" | "pending" | "disabled" | "failed" | "needs_auth"; readonly error?: string }
  readonly source?: ServerSource
  readonly account?: Account
  /** What the default rules allow: the `access` option, `all` when the plugin options were not read. */
  readonly access?: Access
  readonly host: HostCheck
  /** The names of the tools the `metaview` server serves, without the `metaview_` prefix. */
  readonly tools?: readonly string[]
  /**
   * The server's status changed moments ago: a server that just connected lists its tools shortly after, so no tools
   * yet means "still listing", not "none for this account".
   */
  readonly settling?: boolean
  readonly agents?: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]
  readonly problems?: readonly string[]
  /** The plugin's own skills, and the skills OpenCode lists; the listed one wins when both have an id. */
  readonly skills?: { readonly own: readonly SkillPath[]; readonly listed: readonly SkillPath[] }
}

/**
 * One status model for `/metaview-status`, the `/metaview` dialog and the status RPC. `version`, `host`, `state`,
 * `unguardedAgents` and `nextStep` are the fields every plugin of this family shares; the rest are Metaview's own.
 */
export interface Status {
  /** The plugin's version. */
  readonly version: string
  readonly state: State
  /** For a failed connection only: OpenCode's reason, on one line of at most 160 characters, URLs without their query. */
  readonly error?: string
  readonly source?: ServerSource
  /** The workspace's name from the last account read since OpenCode started, or null before one. */
  readonly workspace: string | null
  /** `admin` sees every conversation in the workspace; `member` their own and those shared with them. */
  readonly role: "admin" | "member" | null
  /** A free plan may limit transcripts, summaries and AI fields; `credits` unlocks conversations on shared credits. */
  readonly plan: "paid" | "free" | "credits" | null
  /** What the default rules allow: `all`, `ask-changes` or `read-only`. */
  readonly access: Access
  /** How many Metaview tools OpenCode lists: every one the default rules let run or ask. */
  readonly tools: number
  /** True while a server that just connected may still be listing its tools. */
  readonly listing: boolean
  /** How many of them the plugin does not know. */
  readonly unknownCount: number
  /** Up to 20 of the unknown tools' names, only those made of lowercase letters, digits and `_`. */
  readonly unknownTools: readonly string[]
  /** Agents where a new Metaview tool would run without asking; empty when there are none. */
  readonly unguardedAgents: readonly string[]
  /** The plugin's skills that OpenCode loads from another file of the same id instead. */
  readonly shadowedSkills?: readonly SkillPath[]
  readonly host: HostCheck
  readonly problems: readonly string[]
  /** The one next step: the `Next step` row, "Nothing to do." when nothing is needed. */
  readonly nextStep: string
}

const SIGN_IN = `Run /connect and choose Metaview, then press o or Enter to open the link (in a terminal, opencode mcp auth ${SERVER_NAME} opens it automatically).`

/** The default rules to paste into an agent's own permissions, one rule a line, as a JSON array body. */
const agentRulesText = (access: Access) =>
  defaultRules(access)
    .map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`)
    .join("\n")

/** The next step while agents lack the rules: the family's one fixed sentence. */
const AGENTS_NEXT_STEP =
  "Put the default rules shown by /metaview-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Metaview tools."

const NOTHING_TO_DO = "Nothing to do."

const TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`
const LISTED_UNKNOWN = 20
// A tool name comes from the server; list only plain names.
const SAFE_NAME = /^[a-z][a-z0-9_]{0,63}$/

/** The plugin's skills that OpenCode lists from another file: a skill with the same id, such as a user's, replaced it. */
function shadowedOf(facts: StatusFacts): SkillPath[] {
  return (facts.skills?.own ?? []).flatMap((own) => {
    const listed = facts.skills?.listed.find((skill) => skill.id === own.id)
    return listed && listed.path !== own.path ? [{ id: own.id, path: listed.path }] : []
  })
}

const STATE_OF = { connected: "connected", pending: "connecting", needs_auth: "sign_in_required", failed: "failed", disabled: "disabled" } as const

export function buildStatus(facts: StatusFacts): Status {
  const state: State = facts.source?.type === "conflict" ? "conflict" : facts.server ? STATE_OF[facts.server.status] : "not_configured"
  const access = facts.access ?? "all"
  const listed = facts.tools ?? []
  const unknown = listed.filter((tool) => classify(tool) === "unknown")
  // OpenCode's text for a needed sign-in can hold an authorization URL, so only a failure's reason is kept.
  const error = facts.server?.status === "failed" && facts.server.error ? shortReason(facts.server.error) : undefined
  const shadowed = shadowedOf(facts)
  const status = {
    version: VERSION,
    state,
    ...(error ? { error } : {}),
    ...(facts.source ? { source: facts.source } : {}),
    workspace: facts.account?.workspace ?? null,
    role: facts.account?.role ?? null,
    plan: facts.account?.plan ?? null,
    access,
    tools: listed.length,
    listing: state === "connected" && listed.length === 0 && facts.settling === true,
    unknownCount: unknown.length,
    unknownTools: unknown.filter((name) => SAFE_NAME.test(name)).slice(0, LISTED_UNKNOWN),
    unguardedAgents: unguardedAgents(facts.agents ?? [], access),
    ...(shadowed.length ? { shadowedSkills: shadowed } : {}),
    host: facts.host,
    problems: facts.problems ?? [],
  }
  return { ...status, nextStep: nextStepOf(status) }
}

function nextStepOf(status: Omit<Status, "nextStep">): string {
  const { source } = status
  switch (status.state) {
    case "conflict": {
      const { url, expected } = source as Extract<ServerSource, { type: "conflict" }>
      return `Your OpenCode config defines mcp.servers.${SERVER_NAME} with ${url}, but the plugin uses ${expected}. Point it at ${expected} or remove it, then restart OpenCode.`
    }
    case "not_configured":
      return `OpenCode has no ${SERVER_NAME} MCP server. Check that no organisation policy (mcp.use) or other plugin removes it, then restart OpenCode.`
    case "disabled":
      return `The ${SERVER_NAME} MCP server is disabled. Enable it in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`
    case "connecting":
      return "Metaview is still connecting. Run /metaview-status again in a few seconds."
    case "sign_in_required":
      return SIGN_IN
    case "failed":
      // An entry with its own sign-in sends an API key in its headers, which the plugin never reads.
      if (source?.type === "adopted" && source.signIn === "own") {
        return `Check your network and the API key in the headers of your own mcp.servers.${SERVER_NAME} (Metaview: Settings, MCP), then restart OpenCode.`
      }
      return "Check your network, then run /metaview-status again."
  }
  if (status.listing) return "Metaview is still listing its tools. Run /metaview-status again in a few seconds."
  if (status.tools === 0) {
    return 'Metaview lists no tools for this account. Ask a Metaview workspace admin to turn on "MCP integration", and "MCP for non-admins" if you are a member, in Workspace settings.'
  }
  if (status.unguardedAgents.length) return AGENTS_NEXT_STEP
  // A problem reads `CODE: What happened. Next step: What to do.`; its own next step becomes the status's.
  const problem = status.problems[0]?.split(" Next step: ")[1]
  if (problem) return problem
  if (status.shadowedSkills?.length) {
    return `Rename or move ${status.shadowedSkills.map((skill) => `the "${skill.id}" skill at ${skill.path}`).join(" and ")}, which OpenCode loads instead of the plugin's skill of the same name.`
  }
  // An untested host changes no next step: the OpenCode row says it is untested.
  return NOTHING_TO_DO
}

const STATE_TEXT: Record<State, string> = {
  connected: "connected",
  connecting: "connecting",
  sign_in_required: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
}

const NOT_READ = "not read yet"
const ROLE_TEXT = { admin: "admin: every conversation in the workspace", member: "member: your own conversations and those shared with you" } as const
const PLAN_TEXT = {
  paid: "paid",
  free: "free: transcripts, summaries and AI fields may be limited",
  credits: "shared credits: conversations unlock on the workspace's platform credits",
} as const
/** The permission posture, which the default rules fix. */
const RULES_NOT_ADDED = "RULES_NOT_ADDED:"

/** The server's address and owner, after the state label. */
function serverText(source: ServerSource) {
  if (source.type === "plugin") return `${source.url}, registered by this plugin`
  if (source.type === "adopted") return `${source.url}, your own mcp.servers.${SERVER_NAME}${source.signIn === "own" ? " without OAuth" : ""}, used unchanged`
  return `your mcp.servers.${SERVER_NAME} points at ${source.url}`
}

function toolsText(status: Status) {
  const { tools, unknownCount, unknownTools, listing } = status
  if (listing) return "none listed yet (Metaview is still listing them)"
  if (unknownCount === 0) return `${tools} available, 0 unknown`
  const more = unknownCount - unknownTools.length
  const names = unknownTools.length ? `: ${unknownTools.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : ""
  return `${tools} available, ${unknownCount} unknown${names} (${unknownPosture(status)})`
}

/** What a tool the plugin does not know does, which follows the `access` option. */
const unknownPosture = ({ access }: Status) =>
  access === "all" ? "new tools run too" : access === "read-only" ? "new tools are denied" : "unknown tools ask before running"

/** The permission posture for the `access` value, then the role, if read, and whether the default rules are in place. */
function accessText({ role, problems, unguardedAgents, access }: Status) {
  const posture =
    access === "all"
      ? "every tool runs without asking, reads and new tools included"
      : access === "read-only"
        ? "reads run without asking; every other tool is denied"
        : "reads run without asking; changes and new tools ask first"
  const rules = problems.some((problem) => problem.startsWith(RULES_NOT_ADDED))
    ? "default rules not added (see the OpenCode row)"
    : unguardedAgents.length
      ? "default rules missing in the agents listed below"
      : "no agent runs new Metaview tools unasked"
  return `${posture}; ${role ? ROLE_TEXT[role] : `role ${NOT_READ}`}; ${rules}`
}

/** The OpenCode row: the version, whether it is tested, the supported range, then any setup problems. */
function hostText({ host, problems }: Status) {
  const { version, range, tested } = host
  const outside = version === null || !isSupportedHost(version)
  const notes = [
    ...(outside ? [`It is outside the supported range; the plugin runs because allowUntestedHost is true. If Metaview misbehaves, use OpenCode ${TESTED_TEXT}.`] : []),
    ...problems,
  ]
  return `${version ?? "unknown version"} (${tested ? "tested" : "untested"}; supported range ${range})${notes.length ? `. ${notes.join(" ")}` : ""}`
}

export function formatStatus(status: Status) {
  const { source, unguardedAgents: agents } = status
  const details = [status.error, source && serverText(source), status.listing && "still listing its tools"].filter(Boolean).join("; ")
  return [
    "Metaview status",
    `- Connection: ${STATE_TEXT[status.state]}${details ? ` (${details})` : ""}`,
    `- Account: ${status.workspace ?? `${NOT_READ} (it appears after the first ${SERVER_NAME}_get_user_context call since OpenCode started)`}`,
    `- Access: ${accessText(status)}`,
    `- Plan: ${status.plan ? PLAN_TEXT[status.plan] : NOT_READ}`,
    `- Tools: ${toolsText(status)}`,
    `- Agents without default rules: ${agents.length ? `${agents.join(", ")}\n${agentRulesText(status.access)}` : "none"}`,
    `- OpenCode: ${hostText(status)}`,
    `- Next step: ${status.nextStep}`,
  ].join("\n")
}

export interface StatusContext {
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
  readonly agent: Pick<Plugin.Context["agent"], "list">
  readonly tool: Pick<Plugin.Context["tool"], "list">
  readonly skill: Pick<Plugin.Context["skill"], "list">
}

/** The captured account: what the last account read said, and a way to forget it once the user is signed out. */
interface AccountState {
  readonly current: () => Account | undefined
  readonly forget: () => void
  /** When the server's status last changed, or the watcher started, in milliseconds since the epoch. */
  readonly changedAt: () => number
}

/** How long after a status change no tools still means "listing". */
const LISTING_MS = 15_000

/** Reads the live facts through public host APIs. Optional lookups that fail leave their field empty. */
export async function readStatus(
  ctx: StatusContext,
  facts: Pick<StatusFacts, "source" | "host" | "problems" | "access"> & { readonly skills?: readonly SkillPath[]; readonly account?: AccountState },
) {
  const [servers, agents, tools, listed] = await Promise.all([
    ctx.mcp.list(),
    ctx.agent.list(),
    ctx.tool.list(),
    // The skill check is advice; a failed list must not hide the rest of the status.
    ctx.skill.list().then(
      (result) => result.data,
      () => undefined,
    ),
  ])
  const server = servers.data.find((entry) => entry.name === SERVER_NAME)
  // A server that needs a new sign-in may come back as another account.
  if (server?.status.status === "needs_auth") facts.account?.forget()
  const account = facts.account?.current()
  const { skills: own, account: watched, ...rest } = facts
  const settling = watched !== undefined && Date.now() - watched.changedAt() < LISTING_MS
  return buildStatus({
    ...rest,
    ...(server ? { server: server.status } : {}),
    ...(account ? { account } : {}),
    tools: tools.filter((tool) => tool.options?.namespace === SERVER_NAME).map((tool) => tool.name),
    settling,
    agents: agents.data,
    ...(own && listed ? { skills: { own, listed } } : {}),
  })
}

/** Why status could not be read: a coded message and its next step. The reason is cut like a failure's. */
function unavailable(error: unknown) {
  const reason = shortReason(error instanceof Error ? error.message : String(error))
  return {
    message: `STATUS_UNAVAILABLE: Could not read Metaview's status${reason ? ` (${reason})` : ""}.`,
    nextStep: "Restart OpenCode, then run /metaview-status again.",
  }
}

const strings = { type: "array", items: { type: "string" } }
const count = { type: "integer", minimum: 0 }
const nullableString = { type: ["string", "null"] }

/**
 * One read-only method for the TUI view and scripts. The TUI part does not receive the plugin options on 2.2.x, and
 * cannot see the server's own findings, so it asks the server for the same status /metaview-status reports.
 */
export const StatusRpc = {
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
            properties: { type: { enum: ["plugin", "adopted", "conflict"] }, url: { type: "string" }, expected: { type: "string" }, signIn: { enum: ["oauth", "own"] } },
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
            items: { type: "object", required: ["id", "path"], properties: { id: { type: "string" }, path: { type: "string" } } },
          },
          host: {
            type: "object",
            required: ["version", "range", "tested"],
            properties: { version: nullableString, range: { type: "string" }, tested: { type: "boolean" } },
          },
          problems: strings,
          nextStep: { type: "string" },
        },
      },
      errors: { unavailable: { type: "object", required: ["nextStep"], properties: { nextStep: { type: "string" } } } },
    },
  },
  events: {},
} satisfies Rpc.PortableDefinition

export function registerStatusRpc(rpc: Pick<Plugin.Context["rpc"], "register">, read: () => Promise<Status>) {
  return rpc.register(StatusRpc, {
    status: (_input, { error }) =>
      read().catch((cause: unknown) => {
        const { message, nextStep } = unavailable(cause)
        return error("unavailable", message, { nextStep })
      }),
  })
}

export function registerStatusCommand(
  ctx: { readonly command: Pick<Plugin.Context["command"], "transform">; readonly session: Pick<Plugin.Context["session"], "synthetic"> },
  read: () => Promise<Status>,
) {
  return ctx.command.transform((editor) =>
    editor.add({
      name: "metaview-status",
      description: "Show Metaview's connection, sign-in, account, tools and the next step",
      execute: async ({ sessionID }) => {
        const text = await read().then(formatStatus, (cause: unknown) => {
          const { message, nextStep } = unavailable(cause)
          return `${message} Next step: ${nextStep}`
        })
        await ctx.session.synthetic({ sessionID, text, description: "Metaview status", resume: false })
      },
    }),
  )
}
