// The conversations source over time, from the independent review of #22: late arrivals (uploads days after their
// start), a busy account over the cursor's capacity, the gap answered once per read (a drain, a pause in the middle of
// one, a pause after one), a burst at one start, lost access, the window's bounds, and contact details in titles and
// participants. Every conversation is invented; the synthetic Metaview answers as test/support/synthetic-metaview.ts.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { EVENT_LIMITS } from "@we-the-rebel-alliance/source-contract/events"
import type { ToolCall } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { eventsMethod, seenKey } from "../../src/events/index.js"
import { holdsContact, maskContacts } from "../../src/events/metaview.js"
import { ACCOUNT, FIXTURE, ME, NOW, cursorAt, syntheticContext, type Call, type SyntheticConversation } from "../support/synthetic-metaview.js"

// Each case reads days of hourly polls, or a burst of 1,100 a page at a time.
setDefaultTimeout(120_000)

const call = (): ToolCall => ({ sessionID: "s", agent: "build", messageID: "m", id: "c", signal: new AbortController().signal, progress: async () => {} })
const H = 3_600_000
const D = 24 * H
const metaviewTime = (t: number) => new Date(t).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "+00:00")
const conv = (id: number, t: number, title = `Interview ${id}`): SyntheticConversation => ({ id, start: metaviewTime(t), title, candidates: [], interviewers: [ME] })
const startOf = (c: SyntheticConversation) => Date.parse(c.start!.replace(" ", "T"))

interface World {
  readonly conversations: readonly SyntheticConversation[]
  readonly calls?: Call[]
  /** Metaview's between leaving out its end, which the plugin must not depend on. */
  readonly exclusiveEnd?: boolean
  readonly tieOrder?: "id" | "shuffled"
}

async function list(input: Record<string, unknown>, now: number, world: World) {
  const ctx = syntheticContext(async () => {}, { conversations: world.conversations, ...(world.calls ? { calls: world.calls } : {}), ...(world.tieOrder ? { tieOrder: world.tieOrder } : {}) })
  if (world.exclusiveEnd) {
    const tools = await ctx.tool.list()
    const shifted = tools.map((tool) =>
      tool.id !== "metaview_search_conversations"
        ? tool
        : {
            ...tool,
            execute: (inp: Record<string, any>, c: unknown) => {
              const filters = inp["filters"].map((x: any) => (x.field_id === "default:start_time" ? { ...x, value: { ...x.value, value: [x.value.value[0], new Date(Date.parse(x.value.value[1]) - 1).toISOString()] } } : x))
              return tool.execute({ ...inp, filters } as never, c as never)
            },
          },
    )
    return (await eventsMethod({ ...ctx, tool: { list: async () => shifted as never } }, () => now).run(input, call())) as Record<string, any>
  }
  return (await eventsMethod(ctx, () => now).run(input, call())) as Record<string, any>
}
const ids = (p: Record<string, any>) => (p["events"] as { external_id: string }[]).map((e) => e.external_id)

/** A consumer reading every `step` from `since` to `until`, over a world where each conversation appears at its own time. */
async function poll(all: { c: SyntheticConversation; visibleAt: number }[], since: number, until: number, step: number, limit = 100) {
  const listed: string[] = []
  const gaps: { reason: string; since: string; at: number }[] = []
  let cursor: string | undefined
  for (let now = since + step; now <= until; now += step) {
    const conversations = all.filter((x) => x.visibleAt <= now).map((x) => x.c)
    for (let k = 0; k < 50; k++) {
      const page = await list(cursor ? { account: ACCOUNT, cursor, limit } : { account: ACCOUNT, since: new Date(since).toISOString(), limit }, now, { conversations })
      listed.push(...ids(page))
      if (page["gap"]) gaps.push({ ...page["gap"], at: now })
      cursor = page["cursor"]
      expect(cursor!.length).toBeLessThanOrEqual(EVENT_LIMITS.cursor)
      if (!page["more"]) break
    }
  }
  return { listed, gaps }
}

describe("late arrivals", () => {
  const D0 = Date.parse("2026-11-01T00:00:00Z")
  const arrivals = [
    { c: conv(101, D0 + 2 * H), visibleAt: D0 + 2 * H + 10 * 60_000 },
    { c: conv(102, D0 + 4 * D), visibleAt: D0 + 4 * D + 20 * H }, // 20 hours late
    { c: conv(103, D0 + 2 * D + 10 * H), visibleAt: D0 + 4 * D + 10 * H }, // uploaded 2 days late
    { c: conv(104, D0 + 3 * D + 9 * H), visibleAt: D0 + 8 * D + 9 * H }, // uploaded 5 days late
    { c: conv(105, D0 + 6 * D), visibleAt: D0 + 6 * D + 30 * 60_000 },
  ]

  test("uploads 2 and 5 days after their start are listed once, read hourly, with no gap", async () => {
    const r = await poll(arrivals, D0, D0 + 12 * D, H)
    expect([...r.listed].sort()).toEqual(["101", "102", "103", "104", "105"])
    expect(r.gaps).toEqual([])
  })

  test("the same, read once a day", async () => {
    const r = await poll(arrivals.slice(1, 4), D0, D0 + 12 * D, D)
    expect([...r.listed].sort()).toEqual(["102", "103", "104"])
    expect(r.gaps).toEqual([])
  })

  test("an upload 10 days after its start is past the 7-day lookback: not listed (a Known limit)", async () => {
    const r = await poll([arrivals[0]!, { c: conv(106, D0 + D), visibleAt: D0 + 11 * D }], D0, D0 + 12 * D, D)
    expect(r.listed).toEqual(["101"])
  })

  test("25 a day fits the lookback: a 5-day-late upload is listed, with no gap", async () => {
    const busy = Array.from({ length: 250 }, (_, k) => ({ c: conv(41_000_000 + k * 37, D0 + k * (D / 25)), visibleAt: D0 + k * (D / 25) + 10 * 60_000 }))
    const upload = { c: conv(49_999_999, D0 + 3 * D), visibleAt: D0 + 8 * D }
    const r = await poll([...busy, upload], D0, D0 + 10 * D, 6 * H, 200)
    expect(r.listed).toContain("49999999")
    expect(r.listed.length).toBe(new Set(r.listed).size)
    expect(r.gaps).toEqual([])
  })

  test("300 a day is more than the cursor holds: one window-truncated gap says so, and nothing is listed twice", async () => {
    const busy = Array.from({ length: 900 }, (_, k) => ({ c: conv(41_000_000 + k * 37, D0 + k * (D / 300)), visibleAt: D0 + k * (D / 300) + 10 * 60_000 }))
    const late = { c: conv(49_999_999, D0 + 2 * D + 2 * H), visibleAt: D0 + 2 * D + 22 * H }
    const r = await poll([...busy, late], D0, D0 + 3 * D, H, 200)
    expect(r.listed.length).toBe(new Set(r.listed).size)
    expect(r.gaps).toHaveLength(1)
    expect(r.gaps[0]!.reason).toBe("window-truncated")
    // Every on-time conversation that settled is listed; the late one is listed, or lies before the gap's line.
    const settled = busy.filter((x) => startOf(x.c) <= D0 + 3 * D - 3 * H).map((x) => String(x.c.id))
    for (const id of settled) expect(r.listed).toContain(id)
    if (!r.listed.includes("49999999")) expect(Date.parse(r.gaps[0]!.since)).toBeGreaterThan(startOf(late.c))
  })
})

describe("over capacity, and back", () => {
  const D0 = Date.parse("2026-11-01T00:00:00Z")
  /** `perDay` conversations a day for `days` days from `from`, each appearing 10 minutes after its start. */
  const steady = (perDay: number, from: number, days: number, base: number) =>
    Array.from({ length: Math.round(perDay * days) }, (_, k) => ({ c: conv(base + k * 37, from + k * (D / perDay)), visibleAt: from + k * (D / perDay) + 10 * 60_000 }))
  /**
   * Listed once, or covered by the gap that said the lookback is shorter: one answered before it arrived, while the
   * shortening that gap announced still held (the gap-once rule).
   */
  const accounted = (r: { listed: string[]; gaps: { at: number }[] }, x: { c: SyntheticConversation; visibleAt: number }) =>
    r.listed.includes(String(x.c.id)) || r.gaps.some((gap) => gap.at <= x.visibleAt)

  test("300 a day for 10 days, read hourly: one window-truncated gap, not one per read", async () => {
    const r = await poll(steady(300, D0, 10, 41_000_000), D0, D0 + 10 * D, H, 200)
    expect(r.gaps).toHaveLength(1)
    expect(r.listed.length).toBe(new Set(r.listed).size)
  })

  test("300 a day with uploads 2 and 5 days late: each is listed, or lies behind the gap that said the lookback shrank", async () => {
    const late = [
      { c: conv(99_000_001, D0 + 6 * D + 10 * H), visibleAt: D0 + 8 * D + 10 * H },
      { c: conv(99_000_002, D0 + 5 * D + 9 * H), visibleAt: D0 + 10 * D + 9 * H },
    ]
    const r = await poll([...steady(300, D0, 12, 41_000_000), ...late], D0, D0 + 12 * D, H, 200)
    for (const x of late) expect(accounted(r, x)).toBe(true)
    expect(r.listed.length).toBe(new Set(r.listed).size)
  })

  test("busy, then quiet for two weeks, then busy again: each shortening answers its own gap, and a late upload is accounted for", async () => {
    const busy1 = steady(300, D0, 3, 41_000_000)
    const quiet = steady(5, D0 + 3 * D, 14, 42_000_000)
    const busy2 = steady(300, D0 + 17 * D, 4, 43_000_000)
    const late = { c: conv(99_000_003, D0 + 18 * D + 10 * H), visibleAt: D0 + 20 * D + 10 * H }
    const r = await poll([...busy1, ...quiet, ...busy2, late], D0, D0 + 21 * D, 2 * H, 200)
    // One gap in the first busy spell, one in the second: the flag cleared while it was quiet.
    expect(r.gaps.filter((gap) => gap.at < D0 + 3 * D)).toHaveLength(1)
    expect(r.gaps.filter((gap) => gap.at >= D0 + 17 * D)).toHaveLength(1)
    expect(r.gaps).toHaveLength(2)
    // The second gap came before the upload arrived, and after the quiet spell.
    expect(accounted(r, late)).toBe(true)
    expect(r.gaps.some((gap) => gap.at >= D0 + 17 * D && gap.at <= late.visibleAt)).toBe(true)
    // While it was quiet, with the whole 7 days held again, nothing was lost.
    for (const x of quiet) if (startOf(x.c) <= D0 + 21 * D - 3 * H) expect(r.listed).toContain(String(x.c.id))
  })

  test("a late upload whose key equals a listed conversation's is taken for it: the stated limit, about 1 in 168,000", async () => {
    // 60318349 and 41000000 share a 25-bit key: found by search, as the measured rate says such pairs are rare.
    expect(seenKey("60318349")).toBe(seenKey("41000000"))
    const all = [{ c: conv(41_000_000, D0 + 2 * H), visibleAt: D0 + 2 * H }, { c: conv(60_318_349, D0 + 3 * H), visibleAt: D0 + 2 * D }]
    const r = await poll(all, D0, D0 + 4 * D, H)
    expect(r.listed).toEqual(["41000000"])
    expect(r.gaps).toEqual([])
  })
})

describe("one gap per read", () => {
  test("a 100-day-old cursor read one page at a time, minutes then days apart: one gap, nothing skipped at the edge", async () => {
    const edge = Date.parse("2026-10-14T12:00:00Z")
    const conversations = [conv(7001, edge + 5 * 60_000), conv(7002, edge + H), conv(7003, edge + 2 * D), ...FIXTURE.conversations]
    const first = await list({ account: ACCOUNT, cursor: cursorAt(NOW - 100 * D), limit: 1 }, NOW, { conversations })
    const gaps = [first["gap"]]
    const seen = [...ids(first)]
    let cursor = first["cursor"]
    const times = [NOW + 5 * 60_000, NOW + 10 * 60_000, NOW + 2 * D, NOW + 3 * D, NOW + 3 * D + 60_000]
    for (let k = 0; k < 40; k++) {
      const p = await list({ account: ACCOUNT, cursor, limit: 1 }, times[Math.min(k, times.length - 1)]!, { conversations })
      if (p["gap"]) gaps.push(p["gap"])
      seen.push(...ids(p))
      cursor = p["cursor"]
      if (!p["more"]) break
    }
    expect(gaps.filter(Boolean)).toHaveLength(1)
    expect(seen.slice(0, 3)).toEqual(["7001", "7002", "7003"])
    expect(new Set(seen).size).toBe(seen.length)
  })

  test("a 31-day pause after a finished read answers one gap, then drains without another", async () => {
    const done = await list({ account: ACCOUNT, since: "2026-11-09T00:00:00Z" }, NOW, { conversations: [...FIXTURE.conversations] })
    expect(done["more"]).toBe(false)
    const later = NOW + 31 * D
    const extra = Array.from({ length: 12 }, (_, k) => conv(8100 + k, NOW + 1 * D + k * 2.5 * D))
    const conversations = [...FIXTURE.conversations, ...extra]
    const gaps: unknown[] = []
    const seen: string[] = []
    let cursor = done["cursor"]
    for (let k = 0; k < 40; k++) {
      const p = await list({ account: ACCOUNT, cursor, limit: 1 }, later + k * 7 * 60_000, { conversations })
      if (p["gap"]) gaps.push(p["gap"])
      seen.push(...ids(p))
      cursor = p["cursor"]
      if (!p["more"]) break
    }
    expect(gaps).toHaveLength(1)
    const edge = later - 30 * D
    expect(seen).toEqual(extra.filter((c) => startOf(c) >= edge && startOf(c) <= later - 3 * H).map((c) => String(c.id)))
  })

  test("a 31-day pause in the middle of a read that answered a gap answers another, from the new edge", async () => {
    const conversations = [...FIXTURE.conversations, ...Array.from({ length: 12 }, (_, k) => conv(8200 + k, NOW + 1 * D + k * 2.5 * D))]
    const first = await list({ account: ACCOUNT, cursor: cursorAt(NOW - 100 * D), limit: 1 }, NOW, { conversations })
    expect(first["gap"]).toMatchObject({ reason: "expired" })
    expect(first["more"]).toBe(true)
    const later = NOW + 31 * D
    const p = await list({ account: ACCOUNT, cursor: first["cursor"], limit: 1 }, later, { conversations })
    expect(p["gap"]).toEqual({ reason: "expired", since: new Date(Math.floor((later - 30 * D) / 1000) * 1000).toISOString() })
    // 9002 started on 10 November, before the new edge: Metaview's retention may have deleted it.
    expect(ids(p)).not.toContain("9002")
  })
})

describe("bursts, lost access and the window's bounds", () => {
  test("a burst at one start, shuffled, read a minute apart, is listed once each: 130 with no gap, 1,100 with one", async () => {
    for (const [n, limit, gapsWanted] of [[130, 7, 0], [1100, 50, 1]] as const) {
      const at = Date.parse("2026-11-12T09:00:00Z")
      const burst = Array.from({ length: n }, (_, k) => conv(60_000_000 + ((k * 7_919) % n) * 13, at))
      const conversations = [...burst, conv(59_999_999, at + 1000)]
      const seen: string[] = []
      const gaps: unknown[] = []
      let cursor: string | undefined
      for (let k = 0; k < 400; k++) {
        const p = await list(cursor ? { account: ACCOUNT, cursor, limit } : { account: ACCOUNT, since: "2026-11-12T00:00:00Z", limit }, NOW + k * 60_000, { conversations, tieOrder: "shuffled" })
        seen.push(...ids(p))
        if (p["gap"]) gaps.push(p["gap"])
        cursor = p["cursor"]
        expect(cursor!.length).toBeLessThanOrEqual(EVENT_LIMITS.cursor)
        if (!p["more"]) break
      }
      expect(new Set(seen).size).toBe(seen.length)
      expect(seen.length).toBe(n + 1)
      expect(gaps).toHaveLength(gapsWanted)
    }
  })

  test("a conversation the user loses access to after it was listed gives no gap, and the next one is listed", async () => {
    const done = await list({ account: ACCOUNT, since: "2026-11-09T00:00:00Z" }, NOW, { conversations: [...FIXTURE.conversations] })
    const without = FIXTURE.conversations.filter((c) => c.id !== 9008)
    const p = await list({ account: ACCOUNT, cursor: done["cursor"] }, NOW + H, { conversations: [...without, conv(9200, NOW - 2 * H - 30 * 60_000)] })
    expect(p["gap"]).toBeUndefined()
    expect(ids(p)).toEqual(["9200"])
  })

  test("a start exactly at the window's end is listed once, whether Metaview's between includes its end or not", async () => {
    const now = Date.parse("2026-11-13T12:00:00.000Z") // the end is 09:00:00.000Z exactly
    for (const exclusiveEnd of [false, true]) {
      const x: SyntheticConversation = { id: 9300, start: "2026-11-13 14:30:00+05:30", title: "Boundary", candidates: [], interviewers: [ME] }
      const calls: Call[] = []
      const conversations = [...FIXTURE.conversations.filter((c) => c.id !== 9009), x]
      const a = await list({ account: ACCOUNT, since: "2026-11-09T00:00:00Z" }, now, { conversations, calls, exclusiveEnd })
      const b = await list({ account: ACCOUNT, cursor: a["cursor"] }, now + 60_000, { conversations, exclusiveEnd })
      const c = await list({ account: ACCOUNT, cursor: b["cursor"] }, now + 2 * H, { conversations, exclusiveEnd })
      // Each filter is a dict of UTC instants.
      expect(calls.find((entry) => entry.tool === "search_conversations")!.input["filters"]).toEqual([
        { field_id: "default:start_time", operation: "between", value: { scope: "absolute", value: [expect.stringMatching(/Z$/), expect.stringMatching(/Z$/)] } },
        { field_id: "default:interviewer", operation: "includes_one_of", value: ["$self"] },
      ])
      expect([...ids(a), ...ids(b), ...ids(c)].filter((i) => i === "9300")).toHaveLength(1)
    }
  })
})

describe("contact details", () => {
  test("titles have email addresses and phone numbers masked, and dates and URLs left alone", () => {
    expect(maskContacts("Screen: ana.example@mail.example.com / +44 20 7946 0958")).toBe("Screen: [email] / [phone]")
    expect(maskContacts("Call (555) 010-0199 or 5550100199")).toBe("Call [phone] or [phone]")
    for (const plain of ["Interview 2026-11-12 10:00", "Panel 3 of 4, room 1203", "https://app.metaview.ai/notes/123456789"]) expect(maskContacts(plain)).toBe(plain)
    expect(holdsContact("Ana Example")).toBe(false)
    expect(holdsContact("ana@example.test")).toBe(true)
  })

  test("an event's title and actors carry no address or number: a non-UUID participant is dropped, an address label is no name", async () => {
    const at = "2026-11-12 10:00:00+00:00"
    const conversation: SyntheticConversation = {
      id: 9400,
      start: at,
      title: "Phone screen with ana@example.test, call +1 415 555 0100",
      candidates: [
        { id: "0c0c0c0c-0000-4000-8000-000000000009", name: "ana@example.test" },
        { id: "ana@example.test", name: "Ana Example" },
      ],
      interviewers: [ME, { id: "0e0e0e0e-0000-4000-8000-000000000009", name: "+44 20 7946 0958" }],
    }
    const page = await list({ account: ACCOUNT, since: "2026-11-12T00:00:00Z" }, NOW, { conversations: [conversation] })
    expect(page["events"]).toEqual([
      expect.objectContaining({
        title: "Phone screen with [email], call [phone]",
        actors: [
          { role: "candidate", id: "metaview-participant:0c0c0c0c-0000-4000-8000-000000000009" },
          { role: "interviewer", id: `metaview-participant:${ME.id}`, name: ME.name },
          { role: "interviewer", id: "metaview-participant:0e0e0e0e-0000-4000-8000-000000000009" },
        ],
      }),
    ])
    expect(JSON.stringify(page["events"])).not.toMatch(/@|555|7946/)
  })
})
