import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { findSource } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { acceptAnswer } from "@we-the-rebel-alliance/plugin-contract/read"
import { manifest, packageName } from "../src/manifest.ts"
import { run, runtimeFor } from "./support/handlers.ts"

interface RecordedCase {
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
  readonly expect?: unknown
  readonly answer?: unknown
  readonly refuses?: string
}

interface Fixture {
  readonly plugin: string
  readonly namespace: string
  readonly accounts: { readonly real: boolean; readonly aliases: readonly string[] }
  readonly sources: Record<string, { readonly cases: readonly RecordedCase[]; readonly probe: { readonly input: Readonly<Record<string, unknown>>; readonly answer: unknown } }>
  readonly events: { readonly emitted: readonly string[]; readonly status: unknown }
}

const fixture = JSON.parse(readFileSync(new URL("../fixtures/conformance.json", import.meta.url), "utf8")) as Fixture
const runtime = runtimeFor()
const source = findSource(manifest, "metaview.conversations")
const recorded = fixture.sources["metaview.conversations"]
if (recorded === undefined) throw new Error("fixtures/conformance.json records no metaview.conversations source")

/** The input a handler sees: register removes the account selector. */
function withoutAccount(input: Readonly<Record<string, unknown>>): { readonly account: string; readonly input: Record<string, unknown> } {
  const { account, ...rest } = input
  return { account: typeof account === "string" ? account : "work", input: rest }
}

test("the fixture was recorded for this package and names the real two-account run", () => {
  assert.equal(fixture.plugin, packageName)
  assert.equal(fixture.namespace, manifest.plugin.summary)
  assert.equal(fixture.accounts.real, true)
  assert.deepEqual(fixture.accounts.aliases, ["work", "personal"])
  assert.ok(source !== undefined)
  assert.ok(recorded !== undefined)
})

test("every recorded page is what the handlers answer today", async () => {
  for (const item of recorded.cases) {
    const { account, input } = withoutAccount(item.input)
    if (item.refuses !== undefined) {
      await assert.rejects(
        () => run(runtime, "events_list", input, account),
        (error: unknown) => error instanceof SourceError && error.message === item.refuses,
        item.name,
      )
      continue
    }
    const answer = await run(runtime, "events_list", input, account)
    assert.deepEqual(answer, item.answer, item.name)
    const accepted = acceptAnswer(source!, account, answer)
    if (!accepted.ok) throw new Error(`${item.name}: ${accepted.failure.message}`)
  }
})

test("the recorded probe is what the handler answers today", async () => {
  const probe = withoutAccount(recorded.probe.input)
  assert.deepEqual(await run(runtime, "probe", probe.input, probe.account), recorded.probe.answer)
})

test("the recorded status is what the status handler answers today", async () => {
  assert.deepEqual(await run(runtime, "status", {}), fixture.events.status)
})

test("the fixture declares no bus event for a plugin that emits none", () => {
  assert.deepEqual(fixture.events.emitted, [])
})
