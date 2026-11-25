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
}

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
    candidate: { value: "candidate-9001", label: "Ana Silva" },
    interviewer: { value: "user-101", label: "Kai Mensah" },
    report: "rpt-research",
    url: "https://app.metaview.ai/conversations/9001?t=12",
  },
  {
    id: 9002,
    start: "2026-11-19T08:40:00.000Z",
    candidate: { value: "candidate-9002", label: "Rowan Vale" },
    interviewer: { value: "user-101", label: "Kai Mensah" },
    report: "rpt-research",
    url: "https://app.metaview.ai/conversations/9002",
  },
  {
    id: 9003,
    start: "2026-11-20T14:05:00.000Z",
    candidate: { value: "candidate-9003", label: "Mira Chen" },
    interviewer: { value: "user-102", label: "Ana Duarte" },
    url: "https://app.metaview.ai/conversations/9003",
  },
  {
    id: 9004,
    start: "2026-11-21T09:00:00.000Z",
    candidate: { value: "candidate-9004", label: "Theo Park" },
    interviewer: { value: "user-101", label: "Kai Mensah" },
    url: "https://app.metaview.ai/conversations/9004",
  },
]

const PERSONAL: readonly Conversation[] = [
  {
    id: 9101,
    start: "2026-11-17T19:05:00.000Z",
    candidate: { value: "candidate-9101", label: "Sam Okafor" },
    interviewer: { value: "user-103", label: "Rowan Vale" },
    url: "https://app.metaview.ai/conversations/9101",
  },
  {
    id: 9102,
    start: "2026-11-22T11:30:00.000Z",
    candidate: { value: "candidate-9102", label: "Lee Gomez" },
    interviewer: { value: "user-103", label: "Rowan Vale" },
    url: "https://app.metaview.ai/conversations/9102",
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

/** One `search_conversations` answer: newest first, filtered by report, paged by offset and limit. */
function search(account: string, input: Record<string, unknown>): unknown {
  const report = typeof input["report_id"] === "string" ? input["report_id"] : undefined
  const limit = typeof input["limit"] === "number" ? input["limit"] : 20
  const offset = typeof input["offset"] === "number" ? input["offset"] : 0
  const ascending = input["sort_ascending"] === true
  const all = (CONVERSATIONS[account] ?? []).filter((conversation) => report === undefined || conversation.report === report)
  const ordered = [...all].sort((left, right) => (ascending ? Date.parse(left.start) - Date.parse(right.start) : Date.parse(right.start) - Date.parse(left.start)))
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
      execute: async (input: Record<string, unknown>) => ({ output: execute(input) }),
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
              return search(account, input)
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
