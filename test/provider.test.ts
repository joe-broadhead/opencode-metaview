import assert from "node:assert/strict"
import { test } from "node:test"
import { acceptAnswer } from "@we-the-rebel-alliance/plugin-contract/read"
import { SourceError, type EventsListRequest } from "@we-the-rebel-alliance/plugin-contract/events"
import { findSource } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { manifest, packageName } from "../src/manifest.ts"
import { createProvider, SOURCE, type ProviderCall, type ProviderHost } from "../src/provider/client.ts"
import { fakeHost } from "./support/fake-metaview.ts"
import { NOW, providerCall } from "./support/handlers.ts"

const provider = (host: ProviderHost = fakeHost()) => createProvider(host, { plugin: manifest.plugin.name, package: packageName })
const call: ProviderCall = providerCall()

const request = (overrides: Partial<EventsListRequest> = {}): EventsListRequest => ({ limit: 100, ...overrides })

/** The `SourceError` code a call refuses with, or undefined when it answers. */
async function refusalCode(action: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await action()
    return undefined
  } catch (error) {
    return error instanceof SourceError ? error.code : undefined
  }
}

const since = Date.parse("2026-11-01T00:00:00.000Z")

test("a page is metadata-only meetings, oldest first, marked untrusted", async () => {
  const page = await provider().page({ account: "work", request: request({ since }), now: NOW, call })
  assert.equal(page.source, SOURCE)
  assert.equal(page.account, "work")
  assert.equal(page.plugin, packageName)
  assert.equal(page.trust, "untrusted")
  assert.deepEqual(page.events.map((event) => event.external_id), ["9001", "9002", "9003", "9004"])
  assert.ok(page.events.every((event) => event.kind === "meeting" && event.text === ""))
  const first = page.events[0]
  assert.ok(first !== undefined)
  assert.equal(first.title, "Metaview conversation 9001")
  assert.equal(first.url, "https://app.metaview.ai/conversations/9001")
  assert.deepEqual(
    first.actors.map((actor) => [actor.role, actor.name ?? null]),
    [
      ["participant", null],
      ["candidate", "<redacted:personal>"],
      ["interviewer", "<redacted:personal>"],
    ],
  )
  const source = findSource(manifest, "metaview.conversations")
  assert.ok(source !== undefined)
  const accepted = acceptAnswer(source, "work", page)
  if (!accepted.ok) throw new Error(accepted.failure.message)
})

test("the scope narrows the page to the confirmed report", async () => {
  const page = await provider().page({ account: "work", request: request({ since, scope: { reports: ["rpt-research"] } }), now: NOW, call })
  assert.deepEqual(page.events.map((event) => event.external_id), ["9001", "9002"])
  assert.deepEqual(page.scope, { reports: ["rpt-research"] })
})

test("a cursor lists what follows it, and a later page can be empty", async () => {
  const first = await provider().page({ account: "work", request: request({ since, limit: 2 }), now: NOW, call })
  assert.deepEqual(first.events.map((event) => event.external_id), ["9001", "9002"])
  assert.equal(first.more, true)
  const second = await provider().page({ account: "work", request: request({ cursor: first.cursor, limit: 100 }), now: NOW, call })
  assert.deepEqual(second.events.map((event) => event.external_id), ["9003", "9004"])
  assert.equal(second.more, false)
  const third = await provider().page({ account: "work", request: request({ cursor: second.cursor, limit: 100 }), now: NOW, call })
  assert.deepEqual(third.events, [])
  assert.equal(third.more, false)
})

test("since then cursor-only paging lists each matching event exactly once", async () => {
  const reader = provider()
  const lower = Date.parse("2026-11-19T08:40:00.000Z")
  const seen: string[] = []
  let cursor: string | undefined
  for (let page = 0; page < 10; page++) {
    const answer = await reader.page({ account: "work", request: request({ ...(cursor === undefined ? { since: lower } : { cursor }), limit: 1 }), now: NOW, call })
    seen.push(...answer.events.map((event) => event.external_id))
    if (answer.events.length === 0) break
    cursor = answer.cursor
  }
  assert.deepEqual(seen, ["9002", "9003", "9004"])
  assert.equal(new Set(seen).size, seen.length)
})

test("two conversations at the same start are split across a page boundary, with no loss or repeat", async () => {
  const pair = provider(fakeHost({ sameTimestamp: true }))
  const same = Date.parse("2026-11-23T10:00:00.000Z")
  const first = await pair.page({ account: "work", request: request({ since: same, limit: 1 }), now: NOW, call })
  assert.deepEqual(first.events.map((event) => event.external_id), ["9201"])
  assert.equal(first.more, true)
  const second = await pair.page({ account: "work", request: request({ cursor: first.cursor, limit: 1 }), now: NOW, call })
  assert.deepEqual(second.events.map((event) => event.external_id), ["9202"])
  assert.equal(second.more, false)
})

test("same-start ids 999 and 1000 are both listed exactly once with limit 1", async () => {
  const tie = provider(fakeHost({ tieText: true }))
  const same = Date.parse("2026-11-23T10:00:00.000Z")
  const first = await tie.page({ account: "work", request: request({ since: same, limit: 1 }), now: NOW, call })
  const second = await tie.page({ account: "work", request: request({ cursor: first.cursor, limit: 1 }), now: NOW, call })
  const third = await tie.page({ account: "work", request: request({ cursor: second.cursor, limit: 1 }), now: NOW, call })
  const seen = [...first.events, ...second.events].map((event) => event.external_id)
  assert.deepEqual([...seen].sort(), ["1000", "999"])
  assert.equal(new Set(seen).size, 2)
  assert.deepEqual(third.events, [])
})

test("two reports are merged before the page is cut", async () => {
  const multi = provider(fakeHost({ multiReport: true }))
  const lower = Date.parse("2026-11-20T00:00:00.000Z")
  const first = await multi.page({ account: "work", request: request({ since: lower, scope: { reports: ["rpt-a", "rpt-b"] }, limit: 2 }), now: NOW, call })
  assert.deepEqual(first.events.map((event) => event.external_id), ["1", "2"])
  const second = await multi.page({ account: "work", request: request({ cursor: first.cursor, scope: { reports: ["rpt-a", "rpt-b"] }, limit: 2 }), now: NOW, call })
  assert.deepEqual(second.events.map((event) => event.external_id), ["3"])
  const third = await multi.page({ account: "work", request: request({ cursor: second.cursor, scope: { reports: ["rpt-a", "rpt-b"] }, limit: 2 }), now: NOW, call })
  assert.deepEqual(third.events, [])
})

test("a cursor another account holds is refused, not restarted", async () => {
  const first = await provider().page({ account: "work", request: request({ since }), now: NOW, call })
  assert.equal(await refusalCode(() => provider().page({ account: "personal", request: request({ cursor: first.cursor }), now: NOW, call })), "CURSOR_INVALID")
})

test("a cursor bound to another scope is refused", async () => {
  const first = await provider().page({ account: "work", request: request({ since, scope: { reports: ["rpt-research"] } }), now: NOW, call })
  assert.equal(await refusalCode(() => provider().page({ account: "work", request: request({ cursor: first.cursor, scope: { reports: ["rpt-other"] } }), now: NOW, call })), "CURSOR_INVALID")
})

test("a malformed cursor is refused", async () => {
  assert.equal(await refusalCode(() => provider().page({ account: "work", request: request({ cursor: "not-a-cursor" }), now: NOW, call })), "CURSOR_INVALID")
})

test("the personal account reads its own conversations and no other account's", async () => {
  const page = await provider().page({ account: "personal", request: request({ since }), now: NOW, call })
  assert.deepEqual(page.events.map((event) => event.external_id), ["9101", "9102"])
  assert.ok(page.events.every((event) => event.account === "personal"))
})

test("an empty window still answers a cursor", async () => {
  const page = await provider().page({ account: "work", request: request({ since: Date.parse("2026-11-24T00:00:00.000Z") }), now: NOW, call })
  assert.deepEqual(page.events, [])
  assert.ok(page.cursor.length > 0)
})

test("probe names the signed-in owner and reads no conversation", async () => {
  const answer = await provider().probe("personal", call)
  assert.deepEqual(answer, {
    source: SOURCE,
    account: "personal",
    owner: { id: "metaview:participant:8d1f5c7e-0000-4000-8000-000000000102", label: "Northwind Recruiting (personal)" },
    trust: "untrusted",
  })
})

test("a server that needs a sign-in is NEEDS_SIGN_IN, and a failed tool is UNAVAILABLE", async () => {
  assert.equal(await refusalCode(() => provider(fakeHost({ serverState: "needs_auth" })).page({ account: "work", request: request({ since }), now: NOW, call })), "NEEDS_SIGN_IN")
  assert.equal(await refusalCode(() => provider(fakeHost({ failSearch: "rate limit exceeded" })).page({ account: "work", request: request({ since }), now: NOW, call })), "RATE_LIMITED")
  assert.equal(await refusalCode(() => provider(fakeHost({ failSearch: "the upstream exploded" })).page({ account: "work", request: request({ since }), now: NOW, call })), "UNAVAILABLE")
})

test("a denied or declined vendor tool is PERMISSION_DENIED, not UNAVAILABLE", async () => {
  const denied = provider(fakeHost({ denyTool: "metaview-work_search_conversations" }))
  assert.equal(await refusalCode(() => denied.page({ account: "work", request: request({ since }), now: NOW, call })), "PERMISSION_DENIED")
  const asked = provider(fakeHost({ askTool: "metaview-work_search_conversations" }))
  assert.equal(await refusalCode(() => asked.page({ account: "work", request: request({ since }), now: NOW, call })), "PERMISSION_DENIED")
})

test("a missing tool names the server's state", async () => {
  assert.equal(await refusalCode(() => provider(fakeHost({ omit: ["metaview-work_search_conversations"] })).page({ account: "work", request: request({ since }), now: NOW, call })), "UNAVAILABLE")
  assert.equal(
    await refusalCode(() => provider(fakeHost({ omit: ["metaview-work_get_user_context"], serverState: "needs_auth" })).probe("work", call)),
    "NEEDS_SIGN_IN",
  )
})

test("a page over the source's maxBytes lists fewer events and says more", async () => {
  const small = createProvider(fakeHost(), { plugin: manifest.plugin.name, package: packageName, maxBytes: 400 })
  const page = await small.page({ account: "work", request: request({ since }), now: NOW, call })
  assert.ok(page.events.length >= 1)
  assert.ok(page.events.length < 4)
  assert.equal(page.more, true)
})

test("the same call answers the same page, hashes included", async () => {
  const once = () => provider().page({ account: "work", request: request({ since }), now: NOW, call })
  assert.deepEqual(await once(), await once())
})
