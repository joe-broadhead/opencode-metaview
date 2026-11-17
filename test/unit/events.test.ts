// events_list and probe, the metaview.conversations source's reads, against the synthetic Metaview
// (test/support/synthetic-metaview.ts): the events and what they leave out, paging (the plugin's cursor and Metaview's
// offset), an empty page, an old cursor, Metaview's failures, the sign-in, and another account. Every name is invented.
import { describe, expect, test } from "bun:test"
import { encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { probeResultProblems, resultProblems } from "@we-the-rebel-alliance/source-contract/events"
import type { ToolCall } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { EventsFailure } from "../../src/events/errors.js"
import { EVENTS_ACTION, MAX_BYTES, PROBE_ACTION, RATIONALE, SEARCH_LIMIT, SETTLE_MS, WINDOW_MS, eventsMethod, probeMethod, registerEvents } from "../../src/events/index.js"
import { FIELDS, timeOf } from "../../src/events/metaview.js"
import { pluginError } from "../../src/tools-rpc.js"
import { ACCOUNT, FIXTURE, NOW, SINCE, syntheticContext, type Call, type SyntheticConversation, type SyntheticOptions } from "../support/synthetic-metaview.js"

const call = (): ToolCall => ({ sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal, progress: async () => {} })

interface Setup extends SyntheticOptions {
  readonly now?: number
  readonly asserted?: string[]
}

function list(input: Record<string, unknown>, setup: Setup = {}) {
  const ctx = syntheticContext(async ({ action }) => void setup.asserted?.push(action), setup)
  return eventsMethod(ctx, () => setup.now ?? NOW).run(input, call()) as Promise<Record<string, any>>
}

function probe(input: Record<string, unknown>, setup: Setup = {}) {
  const ctx = syntheticContext(async ({ action }) => void setup.asserted?.push(action), setup)
  return probeMethod(ctx).run(input, call()) as Promise<Record<string, any>>
}

const ids = (page: Record<string, any>) => (page["events"] as { external_id: string }[]).map((event) => event.external_id)
const OWNER = { id: "metaview:4100/77", label: "Metaview user 77 in organization 4100" }
const OTHER_USER = { ...FIXTURE.user, user_id: 78 }

describe("events_list", () => {
  test("lists the recorded conversations since a time, oldest first, as metadata-only meeting events", async () => {
    const page = await list({ account: ACCOUNT, since: SINCE })
    expect(resultProblems(page, 100, MAX_BYTES)).toEqual([])
    expect(page).toMatchObject({ source: "metaview", account: ACCOUNT, owner: OWNER, more: false, trust: "untrusted", plugin: "@joe-broadhead/opencode-metaview", asOf: FIXTURE.now })
    // 9001 started before since, 9006 has no start, 9007 was never recorded, 9009 started less than 3 hours ago; 9004
    // and 9010 start together and are listed by id; 9005's title holds a password, so it is refused for good.
    expect(ids(page)).toEqual(["9002", "9003", "9004", "9010", "9008"])
    expect(page["refused"]).toEqual([{ external_id: "9005", reason: "secret", detail: expect.any(String) }])
    const byId = Object.fromEntries((page["events"] as Record<string, any>[]).map((event) => [event["external_id"], event]))
    expect(byId["9003"]).toMatchObject({
      kind: "meeting",
      // Metaview's "2026-11-10 15:30:00+01:00".
      occurred_at: "2026-11-10T14:30:00.000Z",
      thread: null,
      title: "Technical interview: Backend Engineer",
      text: "",
      url: "https://app.metaview.ai/notes/9003",
      labels: ["Technical-Interview"],
      actors: [
        { role: "candidate", id: "metaview-participant:c0000000-0000-4000-8000-000000000002", name: "Kofi Example" },
        { role: "interviewer", id: "metaview-participant:i0000000-0000-4000-8000-000000000002", name: "Linus Placeholder" },
        { role: "interviewer", id: "metaview-participant:i0000000-0000-4000-8000-000000000003", name: "Mae Fixture" },
      ],
    })
    // A conversation without a transcript has no link.
    expect(byId["9008"]!["url"]).toBeNull()
  })

  test("carries no contact detail and no content, and sends Metaview only fixed rationales and the metadata fields", async () => {
    const calls: Call[] = []
    const page = await list({ account: ACCOUNT, since: "2026-11-01T00:00:00Z" }, { calls })
    const text = JSON.stringify(page)
    for (const person of FIXTURE.conversations.flatMap((conversation) => [...conversation.candidates, ...conversation.interviewers])) {
      if (person.email) expect(text).not.toContain(person.email)
      if (person.phone) expect(text).not.toContain(person.phone)
    }
    // No address of any kind in an event, and no field for one.
    expect(JSON.stringify(page["events"])).not.toMatch(/@|\+1 555|email|phone_numbers/i)
    expect((page["events"] as { text: string }[]).every((event) => event.text === "")).toBe(true)
    // One read: search_conversations. The account is the one the consumer bound with probe.
    expect(calls.map((entry) => entry.tool)).toEqual(["search_conversations"])
    expect(calls.map((entry) => entry.input["rationale"])).toEqual([RATIONALE.list])
    expect(calls[0]!.input).toMatchObject({ fields: Object.values(FIELDS), only_show_recorded_conversations: true, sort_by: "default:start_time", sort_ascending: true, offset: 0, limit: SEARCH_LIMIT })
    // The rationale never names a candidate, an interviewer or a title.
    const names = FIXTURE.conversations.flatMap((conversation) => [conversation.title, ...[...conversation.candidates, ...conversation.interviewers].map((person) => person.name)])
    for (const rationale of Object.values(RATIONALE)) for (const name of names) expect(rationale).not.toContain(name)
  })

  test("pages with its cursor: two at a time, every conversation once, then nothing new", async () => {
    const all = ids(await list({ account: ACCOUNT, since: SINCE }))
    const seen: string[] = []
    const refused: string[] = []
    let input: Record<string, unknown> = { account: ACCOUNT, since: SINCE, limit: 2 }
    for (let page = 0; page < 10; page++) {
      const result = await list(input)
      seen.push(...ids(result))
      refused.push(...((result["refused"] ?? []) as { external_id: string }[]).map((entry) => entry.external_id))
      input = { account: ACCOUNT, cursor: result["cursor"], limit: 2 }
      if (!result["more"]) break
    }
    expect(seen).toEqual(all)
    expect(refused).toEqual(["9005"])
    const after = await list(input)
    expect(after).toMatchObject({ events: [], more: false })
    expect(typeof after["cursor"]).toBe("string")
  })

  test("reads Metaview's pages by offset, 50 at a time, until it has a page", async () => {
    const start = Date.parse("2026-11-12T00:00:00Z")
    const many: SyntheticConversation[] = Array.from({ length: 120 }, (_, index) => ({
      id: 20_000 + index,
      start: new Date(start + index * 60_000).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "+00:00"),
      title: `Interview ${index}`,
      candidates: [],
      interviewers: [],
    }))
    const calls: Call[] = []
    const page = await list({ account: ACCOUNT, since: "2026-11-11T00:00:00Z", limit: 500 }, { conversations: many, calls })
    expect(ids(page)).toEqual(many.map((conversation) => String(conversation.id)))
    expect(calls.filter((entry) => entry.tool === "search_conversations").map((entry) => entry.input["offset"])).toEqual([0, 50, 100])
    // A smaller page stops reading once it has one more than it lists, and says there is more.
    calls.length = 0
    const small = await list({ account: ACCOUNT, since: "2026-11-11T00:00:00Z", limit: 60 }, { conversations: many, calls })
    expect(ids(small)).toHaveLength(60)
    expect(small["more"]).toBe(true)
    expect(calls.filter((entry) => entry.tool === "search_conversations")).toHaveLength(2)
    const rest = await list({ account: ACCOUNT, cursor: small["cursor"], limit: 500 }, { conversations: many })
    expect([...ids(small), ...ids(rest)]).toEqual(many.map((conversation) => String(conversation.id)))
  })

  test("an empty page still carries a cursor, and a start after the settling window reads nothing", async () => {
    const calls: Call[] = []
    const empty = await list({ account: ACCOUNT, since: new Date(NOW - SETTLE_MS + 60_000).toISOString() }, { calls })
    expect(empty).toMatchObject({ events: [], more: false, owner: OWNER })
    expect(typeof empty["cursor"]).toBe("string")
    expect(calls).toEqual([])
  })

  test("lists a conversation once it started 3 hours ago", async () => {
    expect(ids(await list({ account: ACCOUNT, since: "2026-11-13T00:00:00Z" }))).toEqual([])
    expect(ids(await list({ account: ACCOUNT, since: "2026-11-13T00:00:00Z" }, { now: Date.parse("2026-11-13T13:31:00Z") }))).toEqual(["9009"])
  })

  test("a cursor older than 30 days answers an expired gap once, and restarts a day inside the window", async () => {
    expect(WINDOW_MS).toBe(30 * 86_400_000)
    const restart = "2026-10-15T12:00:00.000Z"
    const old = encodeBoundCursor({ plugin: "metaview", source: "metaview", account: ACCOUNT }, { a: ACCOUNT, t: NOW - 100 * 86_400_000, i: "" })
    const page = await list({ account: ACCOUNT, cursor: old, limit: 2 })
    // 8001 started 85 days ago, before the restart: Metaview's retention may already have deleted such a conversation.
    expect(page["gap"]).toEqual({ reason: "expired", since: restart })
    expect(ids(page)).toEqual(["9001", "9002"])
    expect(page["more"]).toBe(true)
    // The pages that follow do not repeat it, a day later too.
    const next = await list({ account: ACCOUNT, cursor: page["cursor"], limit: 2 }, { now: NOW + 86_400_000 - 60_000 })
    expect(next).not.toHaveProperty("gap")
    expect(ids(next)).toEqual(["9003", "9004"])
    // A cursor just inside the window reads on with no gap.
    const recent = encodeBoundCursor({ plugin: "metaview", source: "metaview", account: ACCOUNT }, { a: ACCOUNT, t: NOW - 29 * 86_400_000, i: "" })
    expect(await list({ account: ACCOUNT, cursor: recent })).not.toHaveProperty("gap")
  })

  test("a first listing older than 30 days answers a window-truncated gap, and reads from inside the window", async () => {
    const page = await list({ account: ACCOUNT, since: "2026-08-01T00:00:00Z" })
    expect(page["gap"]).toEqual({ reason: "window-truncated", since: "2026-10-15T12:00:00.000Z" })
    expect(ids(page)).toEqual(["9001", "9002", "9003", "9004", "9010", "9008"])
    expect(resultProblems(page, 100, MAX_BYTES)).toEqual([])
    expect(await list({ account: ACCOUNT, cursor: page["cursor"] })).toMatchObject({ events: [], more: false })
  })

  test("Metaview's own failure is UNAVAILABLE with the next step, and the tools RPC reads its code", async () => {
    const failing = list({ account: ACCOUNT, since: SINCE }, { failing: { search_conversations: "Internal error: the search timed out" } })
    await expect(failing).rejects.toThrow(/^UNAVAILABLE: Metaview's search_conversations failed: Internal error: the search timed out\. Next step: Call events_list again with the same cursor/)
    const error = await failing.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(EventsFailure)
    expect(pluginError(error)).toMatchObject({ code: "UNAVAILABLE", what: "Metaview's search_conversations failed: Internal error: the search timed out" })
  })

  test("an answer it cannot read is UNAVAILABLE, never an empty page", async () => {
    const ctx = syntheticContext(async () => {})
    const tools = await ctx.tool.list()
    const broken = { ...ctx, tool: { list: async () => tools.map((tool) => (tool.id === "metaview_search_conversations" ? { ...tool, execute: async () => ({ content: [{ type: "text", text: "Unrecognized field IDs" }] }) } : tool)) as never } }
    await expect(eventsMethod(broken, () => NOW).run({ account: ACCOUNT, since: SINCE }, call())).rejects.toThrow(/^UNAVAILABLE: Metaview's search_conversations answered in a shape this plugin does not read\./)
  })

  test("names the sign-in Metaview needs, and a server that is not connected", async () => {
    await expect(list({ account: ACCOUNT, since: SINCE }, { state: "needs_auth" })).rejects.toThrow(/^NEEDS_SIGN_IN: Metaview needs a sign-in\. Next step: Run \/connect/)
    await expect(list({ account: ACCOUNT, since: SINCE }, { state: "pending" })).rejects.toThrow(/^UNAVAILABLE: Metaview's server is still connecting\./)
  })

  test("refuses another account's cursor before it reads, and labels a page with the account it names", async () => {
    const calls: Call[] = []
    const cursor = (await list({ account: ACCOUNT, since: SINCE, limit: 1 }))["cursor"]
    await expect(list({ account: "4100/78", cursor }, { calls })).rejects.toThrow(/^ACCOUNT_MISMATCH: The cursor is for another Metaview account than 4100\/78\./)
    expect(calls).toEqual([])
    // The page's owner is the named account's, as probe names it: the same id and label.
    expect((await list({ account: ACCOUNT, since: SINCE, limit: 1 }))["owner"]).toEqual((await probe({}))["owner"])
  })

  test("checks its input before any read", async () => {
    const calls: Call[] = []
    for (const [input, code] of [
      [{ since: SINCE }, "INPUT_INVALID"],
      [{ account: "ana@example.test", since: SINCE }, "INPUT_INVALID"],
      [{ account: ACCOUNT, since: "yesterday" }, "INPUT_INVALID"],
      [{ account: ACCOUNT, limit: 501 }, "INPUT_INVALID"],
      [{ account: ACCOUNT, source: "ashby" }, "SOURCE_UNKNOWN"],
      [{ account: ACCOUNT, cursor: "not-a-cursor" }, "CURSOR_INVALID"],
    ] as const) {
      await expect(list(input, { calls })).rejects.toThrow(new RegExp(`^${code}: `))
    }
    expect(calls).toEqual([])
  })

  test("asserts its own action, then search_conversations, and nothing else", async () => {
    const asserted: string[] = []
    await list({ account: ACCOUNT, since: SINCE }, { asserted })
    // Not get_user_context: a content read that asserts the identity operation needs permission.readsIdentity, which
    // consumers on source-contract 0.1.x refuse.
    expect(asserted).toEqual([EVENTS_ACTION, "metaview_search_conversations"])
  })

  test("is a tool in the metaview namespace, whose failure is a Tool.Error with the code", async () => {
    const added: { name: string; options: { namespace: string }; execute: (input: unknown, context: unknown) => Promise<{ output: unknown; content: string }> }[] = []
    const ctx = { ...syntheticContext(async () => {}), tool: { ...syntheticContext(async () => {}).tool, transform: async (callback: (editor: unknown) => void) => (callback({ add: (info: never) => added.push(info) }), { dispose: async () => {} }) } }
    await registerEvents(ctx as never, () => NOW)
    expect(added.map((tool) => [tool.name, tool.options.namespace])).toEqual([["events_list", "metaview"]])
    const result = await added[0]!.execute({ account: ACCOUNT, since: SINCE }, call())
    expect(result.content).toStartWith("5 Metaview conversations, oldest first. 1 conversation was refused for good")
    const failure = (await added[0]!.execute({ since: SINCE }, call()).then(
      () => undefined,
      (error: unknown) => error,
    )) as { _tag?: string; message: string }
    expect(failure).toMatchObject({ _tag: "Tool.Error" })
    expect(failure.message).toStartWith("INPUT_INVALID: ")
  })
})

describe("probe", () => {
  test("names the account and its owner from one get_user_context read, and nothing else", async () => {
    const asserted: string[] = []
    const calls: Call[] = []
    const answer = await probe({}, { asserted, calls })
    expect(answer).toEqual({ source: "metaview", account: ACCOUNT, owner: OWNER, trust: "untrusted" })
    expect(probeResultProblems(answer, { source: "metaview", account: ACCOUNT })).toEqual([])
    expect(asserted).toEqual([PROBE_ACTION, "metaview_get_user_context"])
    expect(calls).toEqual([{ tool: "get_user_context", input: { rationale: RATIONALE.identity } }])
    expect(await probe({ source: "metaview", account: ACCOUNT })).toEqual(answer)
  })

  test("refuses another account, another source and other input", async () => {
    await expect(probe({ account: "4100/78" })).rejects.toThrow(/^ACCOUNT_MISMATCH: Metaview is signed in to another account than 4100\/78\./)
    await expect(probe({ account: ACCOUNT }, { user: OTHER_USER })).rejects.toThrow(/^ACCOUNT_MISMATCH: /)
    await expect(probe({ source: "ashby" })).rejects.toThrow(/^SOURCE_UNKNOWN: /)
    await expect(probe({ scope: {} })).rejects.toThrow(/^INPUT_INVALID: /)
  })

  test("is UNAVAILABLE when Metaview names no user or fails, and NEEDS_SIGN_IN before a sign-in", async () => {
    await expect(probe({}, { user: { workspace_name: "Example Talent" } })).rejects.toThrow(/^UNAVAILABLE: Metaview's get_user_context did not name the signed-in user and organization\./)
    await expect(probe({}, { failing: { get_user_context: "Unauthorized" } })).rejects.toThrow(/^UNAVAILABLE: Metaview's get_user_context failed: Unauthorized\. Next step: Call probe again;/)
    await expect(probe({}, { state: "needs_auth" })).rejects.toThrow(/^NEEDS_SIGN_IN: /)
  })
})

describe("Metaview's start times", () => {
  test("reads Metaview's form and ISO times with a zone, and nothing else", () => {
    expect(timeOf("2026-11-10 15:30:00+01:00")).toBe(Date.parse("2026-11-10T14:30:00Z"))
    expect(timeOf("2026-11-10T14:30:00Z")).toBe(Date.parse("2026-11-10T14:30:00Z"))
    expect(timeOf("2026-11-10T14:30:00.250-0500")).toBe(Date.parse("2026-11-10T19:30:00.250Z"))
    for (const value of ["2026-11-10", "2026-11-10 14:30:00", "yesterday", 1_794_000_000, null]) expect(timeOf(value)).toBeUndefined()
  })
})
