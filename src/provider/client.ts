/**
 * The provider: Metaview's own MCP tools, executed through OpenCode's tool domain.
 *
 * The plugin owns no Metaview call of its own: the vendor's MCP server holds the credentials and the tools. This module
 * is the only place that names the server URL and the two tools the declared source reads
 * (`get_user_context` and `search_conversations`). It executes each through OpenCode's own executor, so the MCP
 * tool's permission rule applies too, and normalises the answers into the contract's events and probe shapes.
 *
 * The source is metadata only: a conversation becomes a `meeting` event with its start, its candidate and
 * interviewers by name and Metaview id, and a link into Metaview. Never a transcript, a summary, an email or a phone
 * number: candidate data is personal data, and an event's text stays empty.
 */
import type { Plugin } from "@opencode/plugin"
import { accountLabel, accountName, redactReason } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { decodeBoundCursor, encodeBoundCursor } from "@we-the-rebel-alliance/plugin-contract/cursor"
import {
  eventsListResult,
  fitPage,
  makeEvent,
  MAX_PAGE_BYTES,
  probeResult,
  screenEvents,
  SourceError,
  startTime,
  type EventActor,
  type EventsListRequest,
  type EventsListResult,
  type ProbeResult,
  type SourceEvent,
} from "@we-the-rebel-alliance/plugin-contract/events"
import type { Scope } from "@we-the-rebel-alliance/plugin-contract/cursor"
import type { Owner } from "@we-the-rebel-alliance/plugin-contract/manifest"

/** Metaview's MCP server. The one endpoint string: everything else in this repository names no URL. */
export const MCP_URL = "https://mcp.metaview.ai/mcp"

/** The one source the plugin declares, and the `source` input that selects it. */
export const SOURCE = "conversations"
export const SOURCE_ID = "metaview.conversations"

/** The scope keys the source reads: the saved reports whose conversations a person confirms. */
export const SCOPE_KEYS = ["reports"] as const

/** The two Metaview MCP tools this plugin reads, without the server prefix. */
export const CONTEXT_TOOL = "get_user_context"
export const SEARCH_TOOL = "search_conversations"

/** Metaview requires a rationale on every tool call. It names no person and no conversation. */
const RATIONALE = "List the recruiting conversations this signed-in account may read for its own timeline."

/** One page of the vendor API, and the most pages one call scans. */
const RAW_LIMIT = 50
const MAX_PAGES = 10
const MAX_SCOPE_REPORTS = 20

/** The MCP server URL for one account. Metaview serves every alias at the same endpoint. */
export function mcpServerUrl(): string {
  return MCP_URL
}

/** What one provider call knows about its caller, as `register` gives a handler. */
export interface ProviderCall {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
  readonly progress: (update?: Readonly<Record<string, unknown>>) => Promise<void>
}

/** The host domains the provider reads: the tool executor and the MCP server list. */
export type ProviderHost = Pick<Plugin.Context, "tool" | "mcp">

/** The signed-in account, as `get_user_context` names it. */
export interface Identity {
  readonly owner: Owner
}

/** One page's inputs: the resolved account, the parsed request, the clock and the caller. */
export interface PageRequest {
  readonly account: string
  readonly request: EventsListRequest
  readonly now: number
  readonly call: ProviderCall
}

/** What the plugin asks its provider for. */
export interface Provider {
  /** The signed-in owner of one alias. It reads no content. */
  identity(account: string, call: ProviderCall): Promise<Identity>
  /** The account's owner and scopes, and no content. */
  probe(account: string, call: ProviderCall): Promise<ProbeResult>
  /** One account's conversations as contract events, oldest first, with a cursor bound to the account and scope. */
  page(input: PageRequest): Promise<EventsListResult>
}

type Row = Record<string, unknown>

const plain = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value)

const rowsOf = (value: unknown): Row[] => (Array.isArray(value) ? value.filter(plain) : plain(value) ? [value] : [])

/** A non-empty string, or a finite number as a string. */
function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/** The data of a tool result: its structured output, or its text content parsed as JSON. */
export function resultData(result: { readonly output?: unknown; readonly content?: unknown }): unknown {
  if (plain(result.output) || Array.isArray(result.output)) return result.output
  const body =
    typeof result.output === "string"
      ? result.output
      : typeof result.content === "string"
        ? result.content
        : Array.isArray(result.content)
          ? result.content.flatMap((part) => (plain(part) && part["type"] === "text" && typeof part["text"] === "string" ? [part["text"]] : [])).join("\n")
          : ""
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

/** The one-line reason of a tool failure, redacted and cut to 160 characters. */
function reasonOf(error: unknown): string {
  const record = plain(error) ? error : undefined
  const message = error instanceof Error ? error.message : typeof record?.["message"] === "string" ? record["message"] : String(error)
  return redactReason(message.split(/\r?\n/, 1)[0] ?? message)
}

function refuse(code: string, what: string, next: string): never {
  throw new SourceError({ code, what, next })
}

function signInNext(alias: string): string {
  return `Run /connect and choose ${accountLabel("Metaview", alias)} to sign in, then try again.`
}

/** Why a tool is missing: its server's state, as a contract refusal. */
async function missingTool(host: ProviderHost, alias: string, tool: string): Promise<SourceError> {
  const server = accountName("metaview", alias)
  let state: string | undefined
  let reason: string | undefined
  try {
    const entry = (await host.mcp.list()).data.find((candidate) => candidate.name === server)
    state = entry?.status.status
    if (entry?.status.status === "failed" || entry?.status.status === "needs_auth") reason = entry.status.error
  } catch {
    // An unreadable server list is unknown: the refusal below names the missing tool, not a guessed state.
  }
  if (state === "needs_auth") return new SourceError({ code: "NEEDS_SIGN_IN", what: `The ${server} server needs a sign-in`, next: signInNext(alias) })
  if (state === "pending") return new SourceError({ code: "UNAVAILABLE", what: `The ${server} server is still connecting`, next: "Try again in a few seconds." })
  if (state === "disabled") return new SourceError({ code: "UNAVAILABLE", what: `The ${server} server is disabled`, next: `Enable ${accountLabel("Metaview", alias)} in /mcps, then try again.` })
  const detail = reason === undefined ? "" : `: ${reasonOf(reason)}`
  return new SourceError({ code: "UNAVAILABLE", what: `Metaview's ${tool} is not available on the ${server} server${detail}`, next: `Check the ${server} server in /mcps, then try again.` })
}

/** The contract refusal for a tool failure. */
function toolFailure(error: unknown, alias: string, tool: string): SourceError {
  const message = reasonOf(error)
  if (/needs? (?:a )?sign.?in|not authenticated|unauthori[sz]ed|\b401\b/i.test(message)) {
    return new SourceError({ code: "NEEDS_SIGN_IN", what: `Metaview's ${tool} could not sign in`, next: signInNext(alias) })
  }
  if (/rate.?limit|too many requests|\b429\b/i.test(message)) {
    return new SourceError({ code: "RATE_LIMITED", what: `Metaview's ${tool} asked to slow down`, next: "Wait a minute, then try again." })
  }
  return new SourceError({ code: "UNAVAILABLE", what: `Metaview's ${tool} failed: ${message}`, next: "Try again; if it keeps failing, check the plugin's status." })
}

/** Run one Metaview tool as the caller, through OpenCode's own executor. */
async function runTool(host: ProviderHost, alias: string, tool: string, input: Row, call: ProviderCall): Promise<unknown> {
  call.signal.throwIfAborted()
  const id = `${accountName("metaview", alias)}_${tool}`
  const found = (await host.tool.list()).find((entry) => entry.id === id)
  if (found === undefined) throw await missingTool(host, alias, tool)
  try {
    const result = await found.execute(
      input as never,
      {
        sessionID: call.sessionID,
        agent: call.agent,
        messageID: call.messageID,
        id: call.id,
        signal: call.signal,
        progress: call.progress,
      } as never,
    )
    return resultData(result)
  } catch (error) {
    if (call.signal.aborted) throw error
    throw toolFailure(error, alias, tool)
  }
}

/** The owner `get_user_context` names: its participant, else its user, else its organization. */
function ownerOf(data: unknown, alias: string): Owner {
  if (!plain(data)) refuse("UNAVAILABLE", "Metaview did not answer get_user_context with an object", signInNext(alias))
  const participant = text(data["participant_id"])
  const user = text(data["user_id"])
  const organization = text(data["organization_id"])
  const id =
    participant !== undefined ? `metaview:participant:${participant}` : user !== undefined ? `metaview:user:${user}` : organization !== undefined ? `metaview:organization:${organization}` : undefined
  if (id === undefined) refuse("UNAVAILABLE", "Metaview did not name the signed-in user", signInNext(alias))
  return { id, label: text(data["workspace_name"]) ?? "Metaview" }
}

/** One field's entries on a conversation row. */
function fieldRows(row: Row, field: string): Row[] {
  const fields = row["fields"]
  return plain(fields) ? rowsOf(fields[field]) : []
}

/** The label a person reads for a field, else its value. */
function fieldLabel(row: Row, field: string): string | undefined {
  const entry = fieldRows(row, field)[0]
  return entry === undefined ? undefined : (text(entry["label"]) ?? text(entry["value"]))
}

/** A conversation's start, as epoch milliseconds: `default:start_time` in its value, or a nested value. */
function timeOf(row: Row): number | undefined {
  const entry = fieldRows(row, "default:start_time")[0]
  if (entry === undefined) return undefined
  const raw = entry["value"] ?? entry["label"]
  const value = plain(raw) ? raw["value"] : raw
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : undefined
}

/** A URL-safe id segment for a person or contact. */
function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200) || "unknown"
}

/** One person on a conversation, as an event actor: a Metaview id and a name, never an email. */
function personActor(entry: Row, role: string): EventActor | undefined {
  const value = text(entry["value"])
  const label = text(entry["label"])
  const name = label ?? value
  if (name === undefined) return undefined
  const id = value !== undefined ? `metaview:contact:${slug(value)}` : `metaview:person:${slug(name)}`
  return { role, id, name }
}

/** A link into Metaview, https on the app host, without a query or fragment that could carry a token. */
function appUrl(value: unknown): string | undefined {
  const raw = text(value)
  if (raw === undefined) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" || url.hostname !== "app.metaview.ai" || url.username !== "" || url.password !== "") return undefined
    return `${url.origin}${url.pathname}`
  } catch {
    return undefined
  }
}

/** One conversation as a contract event: metadata only, its text empty. */
function conversationEvent(row: Row, account: string, owner: Owner): SourceEvent | undefined {
  const external = text(row["id"])
  const time = timeOf(row)
  if (external === undefined || time === undefined) return undefined
  const candidate = fieldLabel(row, "default:candidate")
  const actors: EventActor[] = [{ role: "participant", id: owner.id, name: owner.label, self: true }]
  for (const entry of fieldRows(row, "default:candidate")) {
    const actor = personActor(entry, "candidate")
    if (actor !== undefined) actors.push(actor)
  }
  for (const entry of fieldRows(row, "default:interviewer")) {
    const actor = personActor(entry, "interviewer")
    if (actor !== undefined) actors.push(actor)
  }
  const url = appUrl(row["url"])
  return makeEvent({
    source: SOURCE,
    account,
    external_id: external,
    kind: "meeting",
    occurred_at: time,
    thread: null,
    actors,
    title: candidate === undefined ? `Metaview conversation ${external}` : `${candidate} interview`,
    text: "",
    ...(url === undefined ? {} : { url }),
    labels: [],
  })
}

/** The conversations an answer holds, whichever envelope Metaview uses. */
function conversationsOf(answer: unknown): Row[] {
  if (!plain(answer)) return []
  const direct = rowsOf(answer["conversations"])
  if (direct.length > 0) return direct
  const data = answer["data"]
  return plain(data) ? rowsOf(data["conversations"]) : []
}

/** The report ids a scope confirms, deduplicated. */
function reportIds(scope: Scope | undefined): string[] {
  const value = scope?.["reports"]
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : []
  return [...new Set(values.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== ""))].slice(0, MAX_SCOPE_REPORTS)
}

/** A cursor's position in the source's total order: the event's start and its Metaview id. */
interface Position {
  readonly time: number
  readonly id: string
}

interface Found {
  readonly position: Position
  readonly row: Row
}

interface Scan {
  readonly found: readonly Found[]
  readonly more: boolean
}

/** The position of a conversation row: its start and its Metaview id, or undefined when it has no start. */
function positionOf(row: Row): Position | undefined {
  const id = text(row["id"])
  const time = timeOf(row)
  return id === undefined || time === undefined ? undefined : { time, id }
}

/** The source's total order: start ascending, then the Metaview id as text. */
function comparePositions(left: Position, right: Position): number {
  return left.time - right.time || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
}

/** True when a position comes after the cursor's pair in the total order. */
function afterPosition(position: Position, after: Position): boolean {
  return position.time > after.time || (position.time === after.time && position.id > after.id)
}

/**
 * One report's conversations in the window, oldest first from the vendor: after the cursor's pair, or since the
 * window's start. Metaview filters `default:start_time` with a relative `after`; the window starts one second before
 * the boundary, so a conversation at the cursor's own start is returned and the pair filter decides it.
 */
async function scan(
  host: ProviderHost,
  alias: string,
  report: string | undefined,
  after: Position | undefined,
  since: number | undefined,
  now: number,
  wanted: number,
  call: ProviderCall,
): Promise<Scan> {
  const floor = after?.time ?? since
  const seconds = floor === undefined ? 86_400 : Math.max(1, Math.ceil((now - floor) / 1000) + 1)
  const found: Found[] = []
  let more = false
  let offset = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    const answer = await runTool(
      host,
      alias,
      SEARCH_TOOL,
      {
        ...(report === undefined ? {} : { report_id: report }),
        filters: [{ field_id: "default:start_time", operation: "after", value: { scope: "relative", value: -seconds } }],
        only_show_recorded_conversations: true,
        sort_by: "default:start_time",
        sort_ascending: true,
        limit: RAW_LIMIT,
        offset,
        rationale: RATIONALE,
      },
      call,
    )
    const rows = conversationsOf(answer)
    if (rows.length === 0) break
    const hasMore = plain(answer) && answer["has_more"] === true
    let stopped = false
    for (const [index, row] of rows.entries()) {
      const position = positionOf(row)
      if (position === undefined) continue
      if (after !== undefined && !afterPosition(position, after)) continue
      if (since !== undefined && position.time < since) continue
      found.push({ position, row })
      if (found.length >= wanted) {
        stopped = true
        more = hasMore || index < rows.length - 1
        break
      }
    }
    if (stopped) break
    const short = rows.length < RAW_LIMIT
    if (short && !hasMore) break
    offset += rows.length
    if (page === MAX_PAGES - 1) more = hasMore || !short
  }
  return { found, more }
}

/** The source's total order, with one row per conversation. */
function ordered(found: readonly Found[]): Found[] {
  const byId = new Map<string, Found>()
  for (const entry of found) {
    const held = byId.get(entry.position.id)
    if (held === undefined || comparePositions(entry.position, held.position) < 0) byId.set(entry.position.id, entry)
  }
  return [...byId.values()].sort((left, right) => comparePositions(left.position, right.position))
}

/** The provider for `plugin`, whose id binds every cursor. `package` names the page's plugin and `maxBytes` its limit. */
export function createProvider(host: ProviderHost, options: { readonly plugin: string; readonly package: string; readonly maxBytes?: number }): Provider {
  return {
    async identity(account, call) {
      const data = await runTool(host, account, CONTEXT_TOOL, { rationale: RATIONALE }, call)
      return { owner: ownerOf(data, account) }
    },

    async probe(account, call) {
      const identity = await this.identity(account, call)
      return probeResult({ source: SOURCE, account, owner: identity.owner })
    },

    async page({ account, request, now, call }) {
      const binding = { plugin: options.plugin, source: SOURCE, account, ...(request.scope === undefined ? {} : { scope: request.scope }) }
      let after: Position | undefined
      if (request.cursor !== undefined) {
        const decoded = decodeBoundCursor(binding, request.cursor)
        if (!decoded.ok) {
          refuse(
            "CURSOR_INVALID",
            decoded.reason === "foreign" ? "the cursor belongs to another plugin, source, account or scope" : "the cursor is not one this plugin issued",
            "Read again without the cursor to start a fresh window.",
          )
        }
        const held = decoded.state["after"]
        const time = plain(held) ? held["time"] : undefined
        const id = plain(held) ? held["id"] : undefined
        if (typeof time !== "string" || typeof id !== "string" || !Number.isFinite(Date.parse(time))) {
          refuse("CURSOR_INVALID", "the cursor holds no position this source can read", "Read again without the cursor to start a fresh window.")
        }
        after = { time: Date.parse(time), id }
      }
      const since = request.cursor === undefined ? startTime(request, now) : undefined
      const identity = await this.identity(account, call)
      const wanted = request.limit
      const reports = reportIds(request.scope)
      const scans: Found[] = []
      let more = false
      for (const report of reports.length === 0 ? [undefined] : reports) {
        const scanned = await scan(host, account, report, after, since, now, wanted, call)
        scans.push(...scanned.found)
        more = more || scanned.more
        if (ordered(scans).length >= wanted) break
      }
      const chosen = ordered(scans)
      const events: SourceEvent[] = []
      for (const entry of chosen) {
        const event = conversationEvent(entry.row, account, identity.owner)
        if (event === undefined) continue
        events.push(event)
        if (events.length >= wanted) break
      }
      // One answer stays inside the source's maxBytes. A page that does not fit lists fewer events and says more.
      const fit = fitPage(events, wanted, options.maxBytes ?? MAX_PAGE_BYTES)
      const listed = events.slice(0, fit)
      // Provider text is data, never instructions: a secret in an event is refused for good.
      const screened = screenEvents(listed)
      // A refused event is accounted for: the cursor moves past everything the page listed, as a (start, id) pair.
      const last = listed.at(-1)
      const position = last === undefined ? (after ?? { time: now, id: "" }) : { time: Date.parse(last.occurred_at), id: last.external_id }
      const cursor = encodeBoundCursor(binding, { after: { time: new Date(position.time).toISOString(), id: position.id } })
      return eventsListResult({ source: SOURCE, account, owner: identity.owner }, screened.events, cursor, more || fit < events.length || chosen.length > wanted, {
        ...(request.scope === undefined ? {} : { scope: request.scope }),
        ...(screened.refused.length === 0 ? {} : { refused: screened.refused }),
        plugin: options.package,
        asOf: new Date(now).toISOString(),
      })
    },
  }
}
