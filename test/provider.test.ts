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
  assert.equal(first.title, "Ana Silva interview")
  assert.equal(first.url, "https://app.metaview.ai/conversations/9001")
  assert.deepEqual(
    first.actors.map((actor) => [actor.role, actor.name]),
    [
      ["participant", "Northwind Recruiting"],
      ["candidate", "Ana Silva"],
      ["interviewer", "Kai Mensah"],
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
