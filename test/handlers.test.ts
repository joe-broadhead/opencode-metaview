import assert from "node:assert/strict"
import { test } from "node:test"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { findSource } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { acceptAnswer } from "@we-the-rebel-alliance/plugin-contract/read"
import { manifest } from "../src/manifest.ts"
import { run, runtimeFor, runtimeWith } from "./support/handlers.ts"

const runtime = runtimeFor()

function codeOf(action: () => Promise<unknown>): Promise<string | undefined> {
  return action().then(
    () => undefined,
    (error: unknown) => (error instanceof SourceError ? error.code : undefined),
  )
}

test("status names the plugin, its host, both accounts and no next step", async () => {
  const answer = (await run(runtime, "status", {})) as Record<string, unknown>
  assert.equal(answer["name"], "metaview")
  assert.equal(answer["version"], "0.0.0")
  assert.equal(answer["state"], "ready")
  assert.equal(answer["nextStep"], null)
  assert.deepEqual(answer["host"], { version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] })
  const accounts = answer["accounts"] as Record<string, unknown>[]
  assert.deepEqual(accounts.map((account) => account["alias"]), ["work", "personal"])
  assert.ok(accounts.every((account) => account["state"] === "ready" && typeof account["owner"] === "object"))
  assert.deepEqual(answer["unguardedAgents"], [])
})

test("status names an agent that no longer holds the generated rules", async () => {
  const answer = (await run(runtime, "status", {}, "work", { unguardedAgents: async () => ({ ok: true, agents: ["build"] }) })) as Record<string, unknown>
  assert.deepEqual(answer["unguardedAgents"], ["build"])
})

test("an unreadable agent list is unknown, never zero: status says error with a redacted next step", async () => {
  const answer = (await run(runtime, "status", {}, "work", { unguardedAgents: async () => ({ ok: false, error: "the agent list failed at https://example.test/x?token=secret" }) })) as Record<string, unknown>
  assert.equal(answer["state"], "error")
  assert.equal(answer["nextStep"], "the agent list failed at https://example.test/x?token=…")
})

test("a server that needs a sign-in makes every account needs_sign_in", async () => {
  const answer = (await run(runtimeWith({ serverState: "needs_auth" }), "status", {})) as Record<string, unknown>
  assert.equal(answer["state"], "needs_sign_in")
  const accounts = answer["accounts"] as Record<string, unknown>[]
  assert.ok(accounts.every((account) => account["state"] === "needs_sign_in"))
  assert.ok(typeof answer["nextStep"] === "string" && answer["nextStep"].includes("Sign in"))
})

test("an account problem makes status an error and its next step is redacted", async () => {
  const answer = (await run(runtime, "status", {})) as Record<string, unknown>
  assert.equal(answer["state"], "ready")
  const broken = runtimeFor(undefined, undefined, { problems: ["the metaview-work server failed at https://example.test/x?token=secret"] })
  const reported = (await run(broken, "status", {})) as Record<string, unknown>
  assert.equal(reported["state"], "error")
  assert.equal(reported["nextStep"], "the metaview-work server failed at https://example.test/x?token=…")
})

test("probe answers the account's owner and no conversation", async () => {
  const answer = (await run(runtime, "probe", {}, "personal")) as Record<string, unknown>
  assert.equal(answer["account"], "personal")
  assert.deepEqual(answer["owner"], { id: "metaview:participant:8d1f5c7e-0000-4000-8000-000000000102", label: "Northwind Recruiting (personal)" })
  assert.equal(answer["trust"], "untrusted")
  assert.equal(answer["events"], undefined)
})

test("probe refuses an unknown source and extra input", async () => {
  assert.equal(await codeOf(() => run(runtime, "probe", { source: "other" })), "SOURCE_UNKNOWN")
  assert.equal(await codeOf(() => run(runtime, "probe", { limit: 1 })), "INPUT_INVALID")
})

test("events_list answers a page the consumer's own check accepts", async () => {
  const answer = await run(runtime, "events_list", { source: "conversations", since: "2026-11-01T00:00:00.000Z" })
  const source = findSource(manifest, "metaview.conversations")
  assert.ok(source !== undefined)
  const accepted = acceptAnswer(source, "work", answer)
  if (!accepted.ok) throw new Error(accepted.failure.message)
  assert.equal(accepted.kind, "events")
  assert.equal(accepted.page.events.length, 4)
})

test("events_list refuses an unknown source, an unknown scope key and an invalid limit", async () => {
  assert.equal(await codeOf(() => run(runtime, "events_list", { source: "other" })), "SOURCE_UNKNOWN")
  assert.equal(await codeOf(() => run(runtime, "events_list", { scope: { channels: ["C1"] } })), "INPUT_INVALID")
  assert.equal(await codeOf(() => run(runtime, "events_list", { limit: 0 })), "INPUT_INVALID")
})

test("events_list refuses another account's cursor", async () => {
  const first = (await run(runtime, "events_list", { source: "conversations", since: "2026-11-01T00:00:00.000Z" })) as { cursor: string }
  assert.equal(await codeOf(() => run(runtime, "events_list", { cursor: first.cursor }, "personal")), "CURSOR_INVALID")
})
