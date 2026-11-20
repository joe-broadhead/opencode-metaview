// events_list and probe, the metaview.conversations source's reads, against the synthetic Metaview
// (test/support/synthetic-metaview.ts): the events and what they leave out, paging (the plugin's cursor and Metaview's
// offset), an empty page, an old cursor, Metaview's failures, the sign-in, and another account. Every name is invented.
import { beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { probeResultProblems, resultProblems } from "@we-the-rebel-alliance/source-contract/events"
import type { ToolCall } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { EventsFailure } from "../../src/events/errors.js"
import { EVENT_LIMITS } from "@we-the-rebel-alliance/source-contract/events"
import { EVENTS_ACTION, LOOKBACK_MS, listEvents, signIns, type SignIns, MAX_BYTES, PROBE_ACTION, RATIONALE, SEARCH_LIMIT, SETTLE_MS, WINDOW_MS, eventsMethod, probeMethod } from "../../src/events/index.js"
import { FIELDS, LINK_HOST, linkOf, timeOf } from "../../src/events/metaview.js"
import { pluginError } from "../../src/tools-rpc.js"
import { ACCOUNT, FIXTURE, ME, NOW, SINCE, cursorAt, syntheticContext, type Call, type SyntheticConversation, type SyntheticOptions } from "../support/synthetic-metaview.js"

const call = (): ToolCall => ({ sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal, progress: async () => {} })

interface Setup extends SyntheticOptions {
  readonly now?: number
  readonly asserted?: string[]
}

function list(input: Record<string, unknown>, setup: Setup = {}) {
  const ctx = syntheticContext(async ({ action }) => void setup.asserted?.push(action), setup)
  return eventsMethod(ctx, () => setup.now ?? NOW, memo).run(input, call()) as Promise<Record<string, any>>
}

function probe(input: Record<string, unknown>, setup: Setup = {}) {
  const ctx = syntheticContext(async ({ action }) => void setup.asserted?.push(action), setup)
  return probeMethod(ctx, memo).run(input, call()) as Promise<Record<string, any>>
}

// Each case is a process of its own: what a case's probe read for a session is not another case's.
let memo: SignIns
beforeEach(() => { memo = signIns() })

const ids = (page: Record<string, any>) => (page["events"] as { external_id: string }[]).map((event) => event.external_id)
const OWNER = { id: "metaview:4100/77", label: "Metaview user 77 in organization 4100" }
const OTHER_USER = { ...FIXTURE.user, user_id: 78 }

describe("events_list", () => {
  test("lists the recorded conversations since a time, oldest first, as metadata-only meeting events", async () => {
    const page = await list({ account: ACCOUNT, since: SINCE })
    expect(resultProblems(page, 100, MAX_BYTES)).toEqual([])
    expect(page).toMatchObject({ source: "metaview", account: ACCOUNT, owner: OWNER, more: false, trust: "untrusted", plugin: "@joe-broadhead/opencode-metaview", asOf: FIXTURE.now })
    // Only the user's own: 9001 started before since, 9009 started less than 3 hours ago, 9005's title holds a password
    // (refused for good); 9003, 9004 and 9010 are other interviewers' and 9006 and 9007 have no interviewer or start.
    expect(ids(page)).toEqual(["9002", "9008"])
    expect(page["refused"]).toEqual([{ external_id: "9005", reason: "secret", detail: expect.any(String) }])
    const byId = Object.fromEntries((page["events"] as Record<string, any>[]).map((event) => [event["external_id"], event]))
    expect(byId["9002"]).toMatchObject({
      kind: "meeting",
      occurred_at: "2026-11-10T09:00:00.000Z",
      thread: null,
      title: "Phone screen: Backend Engineer",
      text: "",
      url: "https://app.metaview.ai/notes/9002",
      labels: ["Phone-Screen"],
      actors: [
        { role: "candidate", id: "metaview-participant:c0000000-0000-4000-8000-000000000002", name: "Kofi Example" },
        { role: "interviewer", id: `metaview-participant:${ME.id}`, name: "Grace Sample" },
      ],
    })
    // Another interviewer on the same panel is named, by id and name only: the panel is the user's own interview.
    expect(byId["9008"]!["actors"]).toContainEqual({ role: "interviewer", id: "metaview-participant:e0000000-0000-4000-8000-000000000002", name: "Linus Placeholder" })
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
    // The identity read, then search_conversations, each with its own fixed rationale.
    expect(calls.map((entry) => entry.tool)).toEqual(["get_user_context", "search_conversations"])
    expect(calls.map((entry) => entry.input["rationale"])).toEqual([RATIONALE.identity, RATIONALE.list])
    expect(calls[1]!.input).toMatchObject({ fields: Object.values(FIELDS), only_show_recorded_conversations: true, sort_by: "default:start_time", sort_ascending: true, offset: 0, limit: SEARCH_LIMIT })
    // The rationale never names a candidate, an interviewer or a title.
    const names = FIXTURE.conversations.flatMap((conversation) => [conversation.title, ...[...conversation.candidates, ...conversation.interviewers].map((person) => person.name)])
    for (const rationale of Object.values(RATIONALE)) for (const name of names) expect(rationale).not.toContain(name)
  })

  test("is metadata only whatever Metaview's answer holds: no transcript, summary, note, score, feedback, email or phone", async () => {
    const me = { value: ME.id, label: ME.name, details: { name: ME.name, emails: ["grace@talent.example.test"], phone_numbers: ["+1 555 0199"], notes: "NOTE-TEXT" } }
    const hostile = {
      id: 9901,
      url: "https://app.metaview.ai/notes/9901?t=30&token=TOKEN-9901",
      has_transcript: true,
      transcript: "TRANSCRIPT-TEXT",
      summary: "SUMMARY-TEXT",
      score: 4,
      scorecard: { overall: "SCORECARD-TEXT" },
      fields: {
        "default:start_time": [{ value: "2026-11-10 09:00:00+00:00", label: "10 Nov" }],
        "default:calendar_event_title": [{ value: "Screen for ana@example.test or +44 20 7946 0958", label: "t" }],
        "default:candidate": [{ value: "c0000000-0000-4000-8000-000000000099", label: "Casey Sample", details: { name: "Casey Sample", emails: ["casey@example.test"], phone_numbers: ["+1 555 0188"], resume: "RESUME-TEXT" } }],
        "default:interviewer": [me],
        "default:conversation_type": [{ value: "t-1", label: "Phone Screen" }],
        "default:transcript": [{ value: "TRANSCRIPT-TEXT" }],
        "default:summary": [{ value: "SUMMARY-TEXT" }],
        "default:feedback": [{ value: "FEEDBACK-TEXT" }],
        "AI:00000000-0000-4000-8000-000000000001": [{ value: "AI-SCORE-4" }],
      },
    }
    const read = async (name: string) => ({ output: name === "get_user_context" ? FIXTURE.user : { conversations: [hostile], total_count: 1, has_more: false } }) as never
    const page = await listEvents(read, { account: ACCOUNT, since: SINCE }, NOW)
    expect(ids(page)).toEqual(["9901"])
    const text = JSON.stringify(page.events)
    for (const absent of ["TRANSCRIPT-TEXT", "SUMMARY-TEXT", "SCORECARD-TEXT", "FEEDBACK-TEXT", "RESUME-TEXT", "NOTE-TEXT", "AI-SCORE-4", "TOKEN-9901", "token=", "@", "555", "7946", "emails", "phone_numbers"]) {
      expect({ absent, found: text.includes(absent) }).toEqual({ absent, found: false })
    }
    expect(Object.keys(page.events[0]!).sort()).toEqual(["account", "actors", "external_id", "hash", "kind", "labels", "occurred_at", "source", "text", "thread", "title", "url"])
    expect(page.events[0]).toMatchObject({ text: "", title: "Screen for [email] or [phone]", labels: ["Phone-Screen"], actors: [{ role: "candidate", name: "Casey Sample" }, { role: "interviewer", name: "Grace Sample" }] })
  })

  test("an event's link is a link into Metaview only: https on the declared host, with no credentials, query or fragment", () => {
    expect(linkOf("https://app.metaview.ai/notes/9002")).toBe("https://app.metaview.ai/notes/9002")
    expect(linkOf("https://app.metaview.ai/notes/9002?t=30&token=abc#frag")).toBe("https://app.metaview.ai/notes/9002")
    for (const other of ["http://app.metaview.ai/notes/1", "https://evil.example.test/notes/1", "https://app.metaview.ai.evil.example.test/notes/1", "https://user:pass@app.metaview.ai/notes/1", "notes/1", 7, undefined]) expect(linkOf(other)).toBeUndefined()
    expect(JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).sources.items[0].urlHosts).toEqual([LINK_HOST])
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
      interviewers: [ME],
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
    // Only who is signed in is read: there is nothing to search.
    expect(calls.map((entry) => entry.tool)).toEqual(["get_user_context"])
  })

  test("lists a conversation once it started 3 hours ago", async () => {
    expect(ids(await list({ account: ACCOUNT, since: "2026-11-13T00:00:00Z" }))).toEqual([])
    expect(ids(await list({ account: ACCOUNT, since: "2026-11-13T00:00:00Z" }, { now: Date.parse("2026-11-13T13:31:00Z") }))).toEqual(["9009"])
  })

  test("a cursor older than 30 days answers an expired gap once per read, from the line its cursor carries", async () => {
    expect(WINDOW_MS).toBe(30 * 86_400_000)
    const edge = "2026-10-14T12:00:00.000Z"
    const page = await list({ account: ACCOUNT, cursor: cursorAt(NOW - 100 * 86_400_000), limit: 1 })
    // 8001 started 85 days ago, before the edge: Metaview's retention may already have deleted such a conversation.
    expect(page["gap"]).toEqual({ reason: "expired", since: edge })
    expect(ids(page)).toEqual(["9001"])
    expect(page["more"]).toBe(true)
    // The read drains one small page at a time, days later: no page answers the gap again, and nothing is skipped.
    const seen = [...ids(page)]
    let cursor = page["cursor"]
    for (let day = 1; day < 20; day++) {
      const next = await list({ account: ACCOUNT, cursor, limit: 1 }, { now: NOW + day * 86_400_000 })
      expect(next).not.toHaveProperty("gap")
      seen.push(...ids(next))
      cursor = next["cursor"]
      if (!next["more"]) break
    }
    expect(seen).toEqual(["9001", "9002", "9008", "9009"])
    // A cursor just inside the window reads on with no gap.
    expect(await list({ account: ACCOUNT, cursor: cursorAt(NOW - 29 * 86_400_000) })).not.toHaveProperty("gap")
  })

  test("a first listing older than 30 days answers a window-truncated gap, and reads from the window's edge", async () => {
    const page = await list({ account: ACCOUNT, since: "2026-08-01T00:00:00Z" })
    expect(page["gap"]).toEqual({ reason: "window-truncated", since: "2026-10-14T12:00:00.000Z" })
    expect(ids(page)).toEqual(["9001", "9002", "9008"])
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

  test("drains a burst of one start larger than its pages, walking it by id, whatever order Metaview gives", async () => {
    const at = "2026-11-12 09:00:00+00:00"
    // 1,100 conversations share one start, more than one call's 20 pages of 50, and Metaview orders them as it likes.
    const burst: SyntheticConversation[] = Array.from({ length: 1_100 }, (_, index) => ({ id: 30_000 + ((index * 7_919) % 1_100), start: at, title: `Burst ${index}`, candidates: [], interviewers: [ME] }))
    const after: SyntheticConversation = { id: 29_999, start: "2026-11-12 10:00:00+00:00", title: "After the burst", candidates: [], interviewers: [ME] }
    const conversations = [...burst, after]
    const seen: string[] = []
    const gaps: unknown[] = []
    let input: Record<string, unknown> = { account: ACCOUNT, since: "2026-11-12T00:00:00Z", limit: 500 }
    for (let page = 0; page < 10; page++) {
      const result = await list(input, { conversations, tieOrder: "shuffled" })
      if (result["gap"]) gaps.push(result["gap"])
      seen.push(...ids(result))
      expect(result["cursor"].length).toBeLessThanOrEqual(EVENT_LIMITS.cursor)
      input = { account: ACCOUNT, cursor: result["cursor"], limit: 500 }
      if (!result["more"]) break
    }
    const burstIds = burst.map((conversation) => conversation.id).sort((a, b) => a - b).map(String)
    expect(seen).toEqual([...burstIds, "29999"])
    // 1,100 listed conversations are more keys than the cursor holds: the lookback shrinks, and one gap says so.
    expect(gaps).toEqual([{ reason: "window-truncated", since: expect.any(String) }])
  })

  test("a burst too large to read whole is passed with a gap, and the cursor still moves", async () => {
    const at = "2026-11-12 09:00:00+00:00"
    const burst: SyntheticConversation[] = Array.from({ length: 2_050 }, (_, index) => ({ id: 40_000 + index, start: at, title: `Burst ${index}`, candidates: [], interviewers: [ME] }))
    const after: SyntheticConversation = { id: 39_999, start: "2026-11-12 10:00:00+00:00", title: "After the burst", candidates: [], interviewers: [ME] }
    const first = await list({ account: ACCOUNT, since: "2026-11-12T00:00:00Z", limit: 10 }, { conversations: [...burst, after] })
    expect(first).toMatchObject({ events: [], more: true, gap: { reason: "window-truncated", since: "2026-11-12T09:00:01.000Z" } })
    const next = await list({ account: ACCOUNT, cursor: first["cursor"], limit: 10 }, { conversations: [...burst, after] })
    expect(next).not.toHaveProperty("gap")
    expect(ids(next)).toEqual(["39999"])
  })

  test("lists a conversation Metaview adds behind the cursor later once, within 7 days of it, and never twice", async () => {
    const done = await list({ account: ACCOUNT, since: SINCE })
    expect(done["more"]).toBe(false)
    // A long call processed late, an upload 30 hours behind the cursor, and one 8 days behind it, past the lookback.
    const late: SyntheticConversation = { id: 9100, start: "2026-11-12 20:00:00+00:00", title: "A call processed late", candidates: [], interviewers: [ME] }
    const upload: SyntheticConversation = { id: 9101, start: "2026-11-12 03:00:00+00:00", title: "A recording uploaded later", candidates: [], interviewers: [ME] }
    const tooLate: SyntheticConversation = { id: 9103, start: "2026-11-05 03:00:00+00:00", title: "Uploaded eight days on", candidates: [], interviewers: [ME] }
    const conversations = [...FIXTURE.conversations, late, upload, tooLate]
    expect(LOOKBACK_MS).toBe(7 * 86_400_000)
    const next = await list({ account: ACCOUNT, cursor: done["cursor"] }, { conversations })
    expect(ids(next)).toEqual(["9101", "9100"])
    expect(next).not.toHaveProperty("gap")
    const again = await list({ account: ACCOUNT, cursor: next["cursor"] }, { conversations })
    expect(ids(again)).toEqual([])
    // The page after a late one is still oldest first, and the cursor did not move back.
    const both = await list({ account: ACCOUNT, cursor: done["cursor"] }, { conversations: [...conversations, { id: 9102, start: "2026-11-13 08:30:00+00:00", title: "New", candidates: [], interviewers: [ME] }] })
    expect(ids(both)).toEqual(["9101", "9100", "9102"])
  })

  test("keeps its cursor within the contract's length when a day holds many conversations, and repeats none", async () => {
    const many: SyntheticConversation[] = Array.from({ length: 400 }, (_, index) => ({
      id: 5_000_000 + index * 9_973,
      start: new Date(Date.parse("2026-11-12T08:00:00Z") + index * 120_000).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "+00:00"),
      title: `Interview ${index}`,
      candidates: [],
      interviewers: [ME],
    }))
    // 400 events are more than one page's 64 KB, so the read takes more than one page.
    const seen: string[] = []
    let input: Record<string, unknown> = { account: ACCOUNT, since: "2026-11-12T00:00:00Z", limit: 500 }
    let cursor = ""
    for (let page = 0; page < 10; page++) {
      const result = await list(input, { conversations: many })
      seen.push(...ids(result))
      cursor = result["cursor"]
      expect(cursor.length).toBeLessThanOrEqual(EVENT_LIMITS.cursor)
      input = { account: ACCOUNT, cursor, limit: 500 }
      if (!result["more"]) break
    }
    expect(seen).toEqual(many.map((conversation) => String(conversation.id)))
    expect(ids(await list({ account: ACCOUNT, cursor }, { conversations: many }))).toEqual([])
  })

  test("an answer it cannot read is UNAVAILABLE, never an empty page", async () => {
    const ctx = syntheticContext(async () => {})
    const tools = await ctx.tool.list()
    const broken = { ...ctx, tool: { list: async () => tools.map((tool) => (tool.id === "metaview_search_conversations" ? { ...tool, execute: async () => ({ content: [{ type: "text", text: "Unrecognized field IDs" }] }) } : tool)) as never } }
    await expect(eventsMethod(broken, () => NOW).run({ account: ACCOUNT, since: SINCE }, call())).rejects.toThrow(/^UNAVAILABLE: Metaview's search_conversations answered in a shape this plugin does not read\./)
  })

  test("one conversation it cannot read fails the page, so the cursor is held, never moved past it", async () => {
    for (const bad of [{ url: "https://app.metaview.ai/notes/1", fields: {} }, { id: 9_999, fields: { "default:start_time": [{ value: "sometime", label: "sometime" }] } }, "not a conversation"]) {
      const answer = { conversations: [bad], total_count: 1, has_more: false }
      const ctx = syntheticContext(async () => {})
      const tools = await ctx.tool.list()
      const broken = { ...ctx, tool: { list: async () => tools.map((tool) => (tool.id === "metaview_search_conversations" ? { ...tool, execute: async () => ({ content: [{ type: "text", text: JSON.stringify(answer) }] }) } : tool)) as never } }
      await expect(eventsMethod(broken, () => NOW).run({ account: ACCOUNT, since: SINCE }, call())).rejects.toThrow(/^UNAVAILABLE: Metaview's search_conversations answered in a shape this plugin does not read\./)
    }
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

  test("after a restart it needs no probe: a listing with a session that never probed reads who is signed in itself, once, and reuses it", async () => {
    const asserted: string[] = []
    const calls: Call[] = []
    const page = await list({ account: ACCOUNT, since: SINCE }, { asserted, calls })
    expect(asserted).toEqual([EVENTS_ACTION, "metaview_get_user_context", "metaview_search_conversations"])
    expect(calls.map((entry) => entry.tool)).toEqual(["get_user_context", "search_conversations"])
    expect(calls[0]!.input).toEqual({ rationale: RATIONALE.identity })
    expect(ids(page)).toEqual(["9002", "9008"])
    // Kept for the session in this process: the next listing there reads nobody, and a new sign-in is a new process.
    calls.length = 0
    await list({ account: ACCOUNT, cursor: page["cursor"] }, { calls })
    expect(calls[0]!.tool).toBe("search_conversations")
  })

  test("in the session a probe ran in, a listing makes no identity read of its own: identity reads belong to probe", async () => {
    const asserted: string[] = []
    const calls: Call[] = []
    await probe({}, { asserted, calls })
    expect(asserted).toEqual([PROBE_ACTION, "metaview_get_user_context"])
    asserted.length = 0
    calls.length = 0
    const page = await list({ account: ACCOUNT, since: SINCE }, { asserted, calls })
    expect(asserted).toEqual([EVENTS_ACTION, "metaview_search_conversations"])
    expect(calls.map((entry) => entry.tool)).toEqual(["search_conversations"])
    // A new process knows nothing of that probe, and reads who is signed in itself.
    memo.forget()
    await list({ account: ACCOUNT, cursor: page["cursor"] }, { calls })
    expect(calls.map((entry) => entry.tool)).toEqual(["search_conversations", "get_user_context", "search_conversations"])
  })

  test("a different signed-in user than the account it is asked for is ACCOUNT_MISMATCH, and nothing is searched", async () => {
    const calls: Call[] = []
    // Another sign-in in this process is a new session or a restart: the memo of what the old one was is gone.
    await expect(list({ account: ACCOUNT, since: SINCE }, { calls, user: OTHER_USER })).rejects.toThrow(/^ACCOUNT_MISMATCH: Metaview is signed in to another account than 4100\/77\./)
    memo.forget()
    await expect(list({ account: ACCOUNT, since: SINCE }, { calls, user: { ...FIXTURE.user, organization_id: 4101 } })).rejects.toThrow(/^ACCOUNT_MISMATCH: /)
    expect(calls.map((entry) => entry.tool)).toEqual(["get_user_context", "get_user_context"])
  })

  test("lists only conversations where the signed-in person is an interviewer: Metaview is asked for them, and another interviewer's are never listed", async () => {
    const calls: Call[] = []
    const page = await list({ account: ACCOUNT, since: "2026-11-01T00:00:00Z" }, { calls })
    for (const search of calls.filter((entry) => entry.tool === "search_conversations")) {
      expect(search.input["filters"]).toContainEqual({ field_id: FIELDS.interviewer, operation: "includes_one_of", value: ["$self"] })
    }
    expect(ids(page)).toEqual(["9001", "9002", "9008"])
    expect(JSON.stringify(page)).not.toMatch(/Tech|Hiring manager|Portfolio|Mae Fixture|Linus Placeholder.*9003/)
    for (const other of ["9003", "9004", "9010"]) expect(ids(page)).not.toContain(other)
  })

  test("a conversation Metaview returns where the user is not an interviewer refuses the page, with its code: it is never dropped or listed", async () => {
    // Metaview ignores the filter and answers with everyone's: 9003 is another interviewer's, and it comes before the user's own.
    const refused = list({ account: ACCOUNT, since: "2026-11-01T00:00:00Z" }, { selfFilter: "ignored" })
    await expect(refused).rejects.toThrow(/^UNAVAILABLE: Metaview returned a conversation where the signed-in user is not an interviewer/)
    // Nothing of that page is listed, so no cursor could have moved past anything: the code and next step are the caller's.
    const error = await refused.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(EventsFailure)
    expect((error as EventsFailure).problem).toMatchObject({ code: "UNAVAILABLE" })
  })

  test("the same conversation on a later page refuses that page too: a page is never reported as shorter than it is", async () => {
    const all = ids(await list({ account: ACCOUNT, since: "2026-11-01T00:00:00Z" }))
    const first = await list({ account: ACCOUNT, since: "2026-11-01T00:00:00Z", limit: 2 })
    expect(ids(first)).toEqual(all.slice(0, 2))
    await expect(list({ account: ACCOUNT, cursor: first["cursor"], limit: 2 }, { selfFilter: "ignored" })).rejects.toThrow(/^UNAVAILABLE: Metaview returned a conversation where the signed-in user is not an interviewer/)
    // The cursor that was not refused still reads the same page as before, so nothing was skipped.
    expect(ids(await list({ account: ACCOUNT, cursor: first["cursor"], limit: 2 }))).toEqual(all.slice(2, 4))
  })

  test("and a participant id that never matches the interviewers refuses rather than listing nothing for ever", async () => {
    // The ids differ, as they would if get_user_context's participant_id were not the id on a conversation: loudly, not empty.
    const unmatched = { ...FIXTURE.user, participant_id: "e0000000-0000-4000-8000-0000000000ff" }
    await expect(list({ account: ACCOUNT, since: "2026-11-01T00:00:00Z" }, { user: unmatched, selfFilter: "ignored" })).rejects.toThrow(/^UNAVAILABLE: Metaview returned a conversation where the signed-in user is not an interviewer/)
    // With the filter honoured there is nothing to refuse, and no conversation of anyone else's is there to drop.
    const none = await list({ account: ACCOUNT, since: "2026-11-01T00:00:00Z" }, { user: unmatched })
    expect(none).toMatchObject({ events: [], more: false })
  })

  test("the person is whoever get_user_context names: another interviewer's conversations are theirs", async () => {
    const asOther = { ...FIXTURE.user, participant_id: "e0000000-0000-4000-8000-000000000004" }
    expect(ids(await list({ account: ACCOUNT, since: "2026-11-01T00:00:00Z" }, { user: asOther }))).toEqual(["9004", "9010"])
  })

  test("a get_user_context that names no participant UUID is UNAVAILABLE, and nothing is searched: it cannot say whose they are", async () => {
    for (const participant_id of [undefined, "p_fake_1", "", 7]) {
      const calls: Call[] = []
      const { participant_id: _own, ...rest } = FIXTURE.user
      const user = participant_id === undefined ? rest : { ...rest, participant_id }
      memo.forget()
      await expect(list({ account: ACCOUNT, since: SINCE }, { calls, user })).rejects.toThrow(/^UNAVAILABLE: Metaview's get_user_context did not name the signed-in participant/)
      expect(calls.map((entry) => entry.tool)).toEqual(["get_user_context"])
    }
  })

  test("an answer wrapped as { result: text }, which is not the shape Metaview answers in, fails loudly: never an empty page", async () => {
    const calls: string[] = []
    const ctx = syntheticContext(async () => {})
    const tools = await ctx.tool.list()
    const wrap = tools.map((tool) => ({
      ...tool,
      execute: async (input: never, context: never) => {
        calls.push(tool.id)
        const answer = (await tool.execute(input, context)) as { content: readonly { text: string }[] }
        return { output: { result: answer.content[0]!.text } }
      },
    }))
    const method = eventsMethod({ ...ctx, tool: { list: async () => wrap as never } }, () => NOW, memo)
    await expect(method.run({ account: ACCOUNT, since: SINCE }, call())).rejects.toThrow(/^UNAVAILABLE: Metaview's get_user_context did not name the signed-in user and organization\./)
    // It stopped at the identity read: nothing was searched, and no cursor moved.
    expect(calls).toEqual(["metaview_get_user_context"])
  })

  test("is a tools RPC method only, never a tool the model sees", async () => {
    const module = await import("../../src/events/index.js")
    expect(module).not.toHaveProperty("registerEvents")
    expect(module.eventsMethod(syntheticContext(async () => {}), () => NOW)).toMatchObject({ kind: "plugin", class: "read", name: "events_list", action: EVENTS_ACTION })
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
