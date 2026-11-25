/**
 * A faithful fake of Metaview's MCP server, for the unit tests and the recorded conformance fixture.
 *
 * The wire shapes are the ones Metaview's `get_user_context` and `search_conversations` document in the recorded tool
 * list (`test/fixtures/live-tools.json`): an identity object, and conversations with `fields` holding `value`/`label`
 * entries. Every person, conversation and workspace is invented and deterministic.
 */
import type { ProviderHost } from "../../src/provider/client.ts"

export const NOW = Date.parse("2026-11-25T09:00:00.000Z")

export interface FakeOptions {
  /** The aliases the fake server serves. */
  readonly accounts?: readonly string[]
  /** The MCP server's state, as `ctx.mcp.list()` reports it. */
  readonly serverState?: "connected" | "needs_auth" | "pending" | "disabled" | "failed"
  /** Tool ids to leave out, as `metaview-work_search_conversations`. */
  readonly omit?: readonly string[]
  /** The tool list itself, and the MCP server list, may not be read. */
  readonly unreadable?: boolean
  /** `search_conversations` fails with this message. */
  readonly failSearch?: string
  /** Serve two conversations that share one start, for the cursor's total order. */
  readonly sameTimestamp?: boolean
  /** Serve 999 and 1000 at one start, whose ids sort in the opposite order as text. */
  readonly tieText?: boolean
  /** Serve two reports whose events interleave, for the multi-report merge. */
  readonly multiReport?: boolean
  /** Refuse this tool id as the host's permission deny. */
  readonly denyTool?: string
  /** Refuse this tool id as a rejected permission ask. */
  readonly askTool?: string
}

const REDACTED = "<redacted:personal>"

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

interface Person {
  readonly value: string
  readonly label: string
}

interface Conversation {
  readonly id: number
  readonly start: string
  readonly candidate: Person
  readonly interviewer: Person
  readonly report?: string
  readonly url?: string
}

const IDENTITIES: Readonly<Record<string, Record<string, unknown>>> = {
  default: {
    organization_id: 1,
    workspace_name: "Northwind Recruiting",
    user_id: 100,
    participant_id: "8d1f5c7e-0000-4000-8000-000000000100",
    is_admin: false,
    is_paying_plan: true,
    data_access: "You can see all conversations in the organization.",
  },
  work: {
    organization_id: 1,
    workspace_name: "Northwind Recruiting",
    user_id: 101,
    participant_id: "8d1f5c7e-0000-4000-8000-000000000101",
    is_admin: true,
    is_paying_plan: true,
    data_access: "You can see all conversations in the organization.",
  },
  personal: {
    organization_id: 1,
    workspace_name: "Northwind Recruiting (personal)",
    user_id: 102,
    participant_id: "8d1f5c7e-0000-4000-8000-000000000102",
    is_admin: false,
    is_paying_plan: false,
    data_access: "You can see the conversations you joined or that were shared with you.",
  },
}

const WORK: readonly Conversation[] = [
  {
    id: 9001,
    start: "2026-11-18T10:15:00.000Z",
    candidate: { value: "candidate-9001", label: REDACTED },
    interviewer: { value: "user-101", label: REDACTED },
    report: "rpt-research",
    url: "https://app.metaview.ai/conversations/9001?t=12",
  },
  {
    id: 9002,
    start: "2026-11-19T08:40:00.000Z",
    candidate: { value: "candidate-9002", label: REDACTED },
    interviewer: { value: "user-101", label: REDACTED },
    report: "rpt-research",
    url: "https://app.metaview.ai/conversations/9002",
  },
  {
    id: 9003,
    start: "2026-11-20T14:05:00.000Z",
    candidate: { value: "candidate-9003", label: REDACTED },
    interviewer: { value: "user-102", label: REDACTED },
    url: "https://app.metaview.ai/conversations/9003",
  },
  {
    id: 9004,
    start: "2026-11-21T09:00:00.000Z",
    candidate: { value: "candidate-9004", label: REDACTED },
    interviewer: { value: "user-101", label: REDACTED },
    url: "https://app.metaview.ai/conversations/9004",
  },
]

const PERSONAL: readonly Conversation[] = [
  {
    id: 9101,
    start: "2026-11-17T19:05:00.000Z",
    candidate: { value: "candidate-9101", label: REDACTED },
    interviewer: { value: "user-103", label: REDACTED },
    url: "https://app.metaview.ai/conversations/9101",
  },
  {
    id: 9102,
    start: "2026-11-22T11:30:00.000Z",
    candidate: { value: "candidate-9102", label: REDACTED },
    interviewer: { value: "user-103", label: REDACTED },
    url: "https://app.metaview.ai/conversations/9102",
  },
]

const SAME_TIME: readonly Conversation[] = [
  {
    id: 9201,
    start: "2026-11-23T10:00:00.000Z",
    candidate: { value: "candidate-9201", label: REDACTED },
    interviewer: { value: "user-101", label: REDACTED },
    url: "https://app.metaview.ai/conversations/9201",
  },
  {
    id: 9202,
    start: "2026-11-23T10:00:00.000Z",
    candidate: { value: "candidate-9202", label: REDACTED },
    interviewer: { value: "user-101", label: REDACTED },
    url: "https://app.metaview.ai/conversations/9202",
  },
]

const TEXT_TIE: readonly Conversation[] = [
  {
    id: 999,
    start: "2026-11-23T10:00:00.000Z",
    candidate: { value: "candidate-999", label: REDACTED },
    interviewer: { value: "user-101", label: REDACTED },
    url: "https://app.metaview.ai/conversations/999",
  },
  {
    id: 1000,
    start: "2026-11-23T10:00:00.000Z",
    candidate: { value: "candidate-1000", label: REDACTED },
    interviewer: { value: "user-101", label: REDACTED },
    url: "https://app.metaview.ai/conversations/1000",
  },
]

const MULTI_REPORT: readonly Conversation[] = [
  {
    id: 2,
    start: "2026-11-20T10:00:00.000Z",
    candidate: { value: "candidate-2", label: REDACTED },
    interviewer: { value: "user-101", label: REDACTED },
    report: "rpt-a",
  },
  {
    id: 3,
    start: "2026-11-20T11:00:00.000Z",
    candidate: { value: "candidate-3", label: REDACTED },
    interviewer: { value: "user-101", label: REDACTED },
    report: "rpt-a",
  },
  {
    id: 1,
    start: "2026-11-20T09:00:00.000Z",
    candidate: { value: "candidate-1", label: REDACTED },
    interviewer: { value: "user-101", label: REDACTED },
    report: "rpt-b",
  },
]

const CONVERSATIONS: Readonly<Record<string, readonly Conversation[]>> = { default: [], work: WORK, personal: PERSONAL }

const row = (conversation: Conversation): Record<string, unknown> => ({
  id: conversation.id,
  url: conversation.url ?? null,
  has_transcript: true,
  fields: {
    "default:start_time": [{ value: conversation.start, label: conversation.start.slice(0, 10) }],
    "default:candidate": [{ value: conversation.candidate.value, label: conversation.candidate.label }],
    "default:interviewer": [{ value: conversation.interviewer.value, label: conversation.interviewer.label }],
  },
})

/** One `search_conversations` answer: filtered by report, paged by offset and limit, with an id tie-breaker. */
function search(conversations: readonly Conversation[], input: Record<string, unknown>): unknown {
  const report = typeof input["report_id"] === "string" ? input["report_id"] : undefined
  const limit = typeof input["limit"] === "number" ? input["limit"] : 20
  const offset = typeof input["offset"] === "number" ? input["offset"] : 0
  const ascending = input["sort_ascending"] === true
  let all = conversations.filter((conversation) => report === undefined || conversation.report === report)
  // Apply the provider's default:start_time relative `after` filter. The fake uses the fixed test clock.
  for (const filter of Array.isArray(input["filters"]) ? input["filters"].filter(plain) : []) {
    if (filter["field_id"] !== "default:start_time" || filter["operation"] !== "after" || !plain(filter["value"])) continue
    const value = filter["value"]
    if (value["scope"] !== "relative" || typeof value["value"] !== "number" || value["value"] >= 0) continue
    const floor = NOW + value["value"] * 1000
    all = all.filter((conversation) => Date.parse(conversation.start) >= floor)
  }
  const ordered = [...all].sort((left, right) => {
    const time = Date.parse(left.start) - Date.parse(right.start)
    return (ascending ? time : -time) || left.id - right.id
  })
  const page = ordered.slice(offset, offset + limit)
  return {
    field_definitions: [
      { field_id: "default:start_time", name: "Start time", type: "date" },
      { field_id: "default:candidate", name: "Candidate", type: "contact" },
      { field_id: "default:interviewer", name: "Interviewer", type: "contact" },
    ],
    conversations: page.map(row),
    total_count: ordered.length,
    has_more: offset + page.length < ordered.length,
  }
}

/** The plugin's structural provider host, backed by the fake Metaview server. */
export function fakeHost(options: FakeOptions = {}): ProviderHost {
  const accounts = options.accounts ?? ["work", "personal"]
  const state = options.serverState ?? "connected"
  const omit = new Set(options.omit ?? [])

  // A server that is not connected lists no tools, as OpenCode lists an MCP server's tools only once it is connected.
  const tools = state === "connected" ? accounts.flatMap((account) => {
    const server = account === "default" ? "metaview" : `metaview-${account}`
    const tool = (name: string, execute: (input: Record<string, unknown>) => unknown) => ({
      id: `${server}_${name}`,
      name,
      description: `Fake Metaview ${name}`,
      input: { type: "object" },
      execute: async (input: Record<string, unknown>) => {
        if (options.denyTool === `${server}_${name}`) {
          throw Object.assign(new Error("Permission denied"), { _tag: "Tool.Error", error: { _tag: "Permission.BlockedError" } })
        }
        if (options.askTool === `${server}_${name}`) {
          throw Object.assign(new Error("Permission declined"), { _tag: "Tool.Error", error: { _tag: "Permission.DeclinedError" } })
        }
        return { output: execute(input) }
      },
    })
    return [
      ...(omit.has(`${server}_get_user_context`)
        ? []
        : [
            tool("get_user_context", () => {
              const identity = IDENTITIES[account]
              return identity ?? { workspace_name: `Fake ${account}`, participant_id: `fake-${account}` }
            }),
          ]),
      ...(omit.has(`${server}_search_conversations`)
        ? []
        : [
            tool("search_conversations", (input) => {
              if (options.failSearch !== undefined) throw new Error(options.failSearch)
              const dataset = options.sameTimestamp === true ? SAME_TIME : options.tieText === true ? TEXT_TIE : options.multiReport === true ? MULTI_REPORT : (CONVERSATIONS[account] ?? [])
              return search(dataset, input)
            }),
          ]),
    ]
  }) : []

  const host = {
    tool: {
      list: async () => {
        if (options.unreadable === true) throw new Error("the tool list is unreadable")
        return tools
      },
    },
    mcp: {
      list: async () => {
        if (options.unreadable === true) throw new Error("the server list is unreadable")
        return {
          data: accounts.map((account) => ({
            name: account === "default" ? "metaview" : `metaview-${account}`,
            status:
              state === "connected"
                ? { status: "connected" as const }
                : state === "needs_auth"
                  ? { status: "needs_auth" as const, error: "Sign in to Metaview." }
                  : state === "pending"
                    ? { status: "pending" as const }
                    : state === "disabled"
                      ? { status: "disabled" as const }
                      : { status: "failed" as const, error: "The connection failed." },
          })),
        }
      },
    },
  }
  return host as unknown as ProviderHost
}
