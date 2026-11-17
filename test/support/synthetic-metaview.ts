// A synthetic Metaview, for the conformance kit and the events tests: get_user_context and search_conversations as
// Metaview's server answers them (test/fixtures/conformance.json holds the account and its conversations), behind a
// fake of OpenCode's executor that asserts `metaview_<tool>` first, as the host does. No live call is made.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import type { EventsContext } from "../../src/events/index.js"

export const ROOT = join(import.meta.dir, "..", "..")

export interface SyntheticPerson {
  readonly id: string
  readonly name: string
  readonly email?: string
  readonly phone?: string
}

export interface SyntheticConversation {
  readonly id: number
  /** Metaview's start, "YYYY-MM-DD HH:MM:SS+HH:MM"; absent when Metaview gives none. */
  readonly start?: string
  readonly title: string
  readonly type?: string
  /** False for a call that was never recorded, which only_show_recorded_conversations leaves out. */
  readonly recorded?: boolean
  /** True for a conversation without a link (no transcript). */
  readonly noUrl?: boolean
  readonly candidates: readonly SyntheticPerson[]
  readonly interviewers: readonly SyntheticPerson[]
}

export interface Fixture {
  readonly now: string
  readonly since: string
  readonly user: Readonly<Record<string, unknown>>
  readonly conversations: readonly SyntheticConversation[]
}

export const FIXTURE = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "conformance.json"), "utf8")) as Fixture
export const NOW = Date.parse(FIXTURE.now)
export const SINCE = FIXTURE.since
/** The fixture's account, as probe names it. */
export const ACCOUNT = `${String(FIXTURE.user["organization_id"])}/${String(FIXTURE.user["user_id"])}`

/** A cursor of this source for the fixture's account at a start, as events_list writes one: no id yet, no lookback. */
export const cursorAt = (time: number, extra: Readonly<Record<string, unknown>> = {}) =>
  encodeBoundCursor({ plugin: "metaview", source: "metaview", account: ACCOUNT }, { a: ACCOUNT, t: time, i: "", l: time, n: "", ...extra })

/** Metaview's field definitions, for the fields a search asks for. */
const DEFINITIONS: Readonly<Record<string, { name: string; type: string }>> = {
  "default:start_time": { name: "Date", type: "date" },
  "default:calendar_event_title": { name: "Event Name", type: "string" },
  "default:candidate": { name: "Candidate", type: "participant_list" },
  "default:interviewer": { name: "Interviewer", type: "participant_list" },
  "default:conversation_type": { name: "Conversation Type", type: "string" },
}

const startOf = (conversation: SyntheticConversation) => (conversation.start === undefined ? undefined : Date.parse(conversation.start.replace(" ", "T")))

const participant = (person: SyntheticPerson) => ({
  value: person.id,
  label: person.name,
  details: { name: person.name, emails: person.email ? [person.email] : [], phone_numbers: person.phone ? [person.phone] : [] },
})

/** One conversation as Metaview writes it, with only the fields asked for. */
function conversationAnswer(conversation: SyntheticConversation, fields: readonly string[]) {
  const all: Record<string, unknown[]> = {
    "default:start_time": conversation.start === undefined ? [] : [{ value: conversation.start, label: conversation.start }],
    "default:calendar_event_title": [{ value: conversation.title, label: conversation.title }],
    "default:candidate": conversation.candidates.map(participant),
    "default:interviewer": conversation.interviewers.map(participant),
    "default:conversation_type": conversation.type === undefined ? [] : [{ value: `t-${conversation.type.toLowerCase().replace(/\W+/g, "-")}`, label: conversation.type }],
  }
  return {
    id: conversation.id,
    url: conversation.noUrl ? null : `https://app.metaview.ai/notes/${conversation.id}`,
    fields: Object.fromEntries(fields.filter((field) => field in all).map((field) => [field, all[field]])),
    has_transcript: !conversation.noUrl,
  }
}

/** Metaview's answer to search_conversations: the date filter (between, both ends included), sorted, offset and limit (at most 50). */
/** A stable order for conversations that share a start, other than by id: Metaview gives no order within a start. */
const shuffle = (id: number) => (id * 2_654_435_761) % 4_294_967_291

export function searchAnswer(conversations: readonly SyntheticConversation[], input: Record<string, unknown>, tieOrder: "id" | "shuffled" = "id") {
  const filters = (input["filters"] ?? []) as { field_id: string; operation: string; value: { scope: string; value: [string, string] } }[]
  const between = filters.find((filter) => filter.field_id === "default:start_time" && filter.operation === "between")
  const [from, to] = between ? between.value.value.map((value) => Date.parse(value)) : [-Infinity, Infinity]
  const recordedOnly = input["only_show_recorded_conversations"] !== false
  const ascending = input["sort_ascending"] === true
  const matching = conversations
    .filter((conversation) => !recordedOnly || conversation.recorded !== false)
    .filter((conversation) => {
      const start = startOf(conversation)
      // Metaview's date filter cannot match a conversation without a start, unless there is no filter.
      return between ? start !== undefined && start >= from! && start <= to! : true
    })
    .sort((a, b) => ((startOf(a) ?? 0) - (startOf(b) ?? 0)) * (ascending ? 1 : -1) || (tieOrder === "id" ? a.id - b.id : shuffle(a.id) - shuffle(b.id)))
  const offset = Number(input["offset"] ?? 0)
  const limit = Math.min(Number(input["limit"] ?? 20), 50)
  const fields = (input["fields"] as string[] | undefined) ?? ["default:start_time", "default:calendar_event_title", "default:conversation_type"]
  const page = matching.slice(offset, offset + limit)
  return {
    access_scope: "You can see all conversations in the organization (admin access).",
    field_definitions: fields.filter((field) => field in DEFINITIONS).map((field) => ({ field_id: field, ...DEFINITIONS[field] })),
    conversations: page.map((conversation) => conversationAnswer(conversation, fields)),
    total_count: matching.length,
    has_more: offset + page.length < matching.length,
    ...(offset + page.length < matching.length ? { message: `Showing ${page.length} of ${matching.length}. Use offset=${offset + page.length} to see more.` } : {}),
  }
}

/** A call the synthetic Metaview received: the tool and its input. */
export interface Call {
  readonly tool: string
  readonly input: Record<string, unknown>
}

export interface SyntheticOptions {
  readonly conversations?: readonly SyntheticConversation[]
  /** The signed-in user get_user_context names. */
  readonly user?: Readonly<Record<string, unknown>>
  /** Tools that fail as Metaview's own failure does: a Tool.Error without a cause. */
  readonly failing?: Readonly<Record<string, string>>
  /** The server's state; a tool is not listed unless it is connected. */
  readonly state?: "connected" | "needs_auth" | "pending" | "failed"
  /** Every call, in order. */
  readonly calls?: Call[]
  /** How conversations that share a start are ordered: by id, or in an order of Metaview's own. */
  readonly tieOrder?: "id" | "shuffled"
}

/** The permission assert a read runs under: the kit's recording session, or one that allows everything. */
export type Assert = (input: { action: string; resources: string[] }) => Promise<void>

/** OpenCode's context for the events module, answering from the synthetic Metaview. */
export function syntheticContext(assert: Assert, options: SyntheticOptions = {}): EventsContext {
  const conversations = options.conversations ?? FIXTURE.conversations
  const user = options.user ?? FIXTURE.user
  const state = options.state ?? "connected"
  const answers: Record<string, (input: Record<string, unknown>) => unknown> = {
    get_user_context: () => user,
    search_conversations: (input) => searchAnswer(conversations, input, options.tieOrder),
  }
  const tools = Object.entries(answers).map(([name, answer]) => ({
    id: `metaview_${name}`,
    execute: async (input: Record<string, unknown>) => {
      // OpenCode's executor asserts the tool's own action before it calls Metaview.
      await assert({ action: `metaview_${name}`, resources: ["*"] })
      options.calls?.push({ tool: name, input })
      const failure = options.failing?.[name]
      if (failure !== undefined) throw Object.assign(new Error(failure), { _tag: "Tool.Error" })
      return { content: [{ type: "text", text: JSON.stringify(answer(input)) }] }
    },
  }))
  return {
    tool: { list: async () => (state === "connected" ? tools : []) as never },
    mcp: { list: async () => ({ data: [{ name: "metaview", status: { status: state } }] }) as never },
    permission: { assert: async (input: { action: string; resources: readonly string[] }) => assert({ action: input.action, resources: [...input.resources] }) } as never,
  }
}
