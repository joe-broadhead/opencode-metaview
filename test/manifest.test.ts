import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { accountName, accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { STATUS_SCHEMA } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { EVENTS_LIST_INPUT_SCHEMA, PAGE_SCHEMA, PROBE_SCHEMA } from "@we-the-rebel-alliance/plugin-contract/events"
import { checkManifest, manifestHash } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { methodEntries } from "@we-the-rebel-alliance/plugin-contract/register"
import { handlersFor } from "../src/handlers/index.ts"
import { manifest, packageName, version } from "../src/manifest.ts"
import { runtimeFor } from "./support/handlers.ts"

interface LiveTools {
  readonly host: { readonly opencode?: string } | string
  readonly count: number
  readonly tools: readonly { readonly name: string }[]
}

const live = JSON.parse(readFileSync(new URL("./fixtures/live-tools.json", import.meta.url), "utf8")) as LiveTools

const counts = () => {
  const byClass: Record<string, number> = {}
  for (const item of Object.values(manifest.methods)) byClass[item.class] = (byClass[item.class] ?? 0) + 1
  return byClass
}

test("the package and the manifest share one name", () => {
  assert.equal(manifest.plugin.name, "metaview")
  assert.equal(packageName, `@we-the-rebel-alliance/${manifest.plugin.name}-plugin`)
  assert.equal(version, "0.0.0")
  assert.equal(checkManifest(manifest).ok, true)
  assert.match(manifestHash(manifest), /^sha256:[0-9a-f]{64}$/)
})

test("the manifest declares the inventory's 71 callables by class", () => {
  assert.equal(Object.keys(manifest.methods).length, 71)
  assert.deepEqual(counts(), { read: 46, write: 14, send: 7, share: 1, delete: 3 })
  assert.equal(manifest.methods["status"]?.accounts, "none")
  assert.equal(manifest.methods["probe"]?.accounts, "optional")
  assert.equal(manifest.methods["events_list"]?.accounts, "optional")
  assert.deepEqual(manifest.methods["events_list"]?.operations, ["get_user_context", "search_conversations"])
  assert.deepEqual(manifest.methods["probe"]?.operations, ["get_user_context"])
})

test("every pass-through MCP tool is declared, and only the recorded 68 are", () => {
  const declared = Object.keys(manifest.methods)
    .filter((method) => method.startsWith("mcp:"))
    .map((method) => method.slice("mcp:".length))
    .sort()
  const recorded = live.tools.map((tool) => tool.name).sort()
  assert.equal(declared.length, 68)
  assert.equal(live.count, 68)
  assert.deepEqual(declared, recorded)
  for (const method of Object.keys(manifest.methods).filter((name) => name.startsWith("mcp:"))) {
    assert.equal(manifest.methods[method]?.operations?.length, 1, method)
  }
})

test("the source is an events feed of meetings with a report scope, cadence, privacy and cost", () => {
  const source = manifest.sources[0]
  assert.ok(source !== undefined)
  assert.equal(source.id, "metaview.conversations")
  assert.equal(source.kind, "events")
  if (source.kind !== "events") return
  assert.equal(source.reads, "meeting")
  assert.equal(source.method, "events_list")
  assert.deepEqual(source.input, { source: "conversations" })
  assert.deepEqual(source.scope?.keys, ["reports"])
  assert.equal(source.cadence?.suggestMinutes, 15)
  assert.equal(source.private, true)
  assert.deepEqual(source.cost, { class: "free" })
  assert.deepEqual(source.operations, ["get_user_context", "search_conversations"])
  assert.deepEqual(source.urlHosts, ["app.metaview.ai"])
})

test("two aliases resolve to the names OpenCode signs in to", () => {
  const plan = accountsOf(manifest, { accounts: { work: {}, personal: {} } })
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.deepEqual(plan.value.accounts.map((account) => account.alias), ["work", "personal"])
  assert.equal(accountName(manifest.plugin.name, "work"), "metaview-work")
  assert.equal(accountName(manifest.plugin.name, "personal"), "metaview-personal")
})

test("the handlers reuse the contract's own schemas instead of copying them", () => {
  const handlers = handlersFor(runtimeFor())
  assert.equal(handlers.status?.output, STATUS_SCHEMA)
  assert.equal(handlers.probe?.output, PROBE_SCHEMA)
  assert.equal(handlers.events_list?.input, EVENTS_LIST_INPUT_SCHEMA)
  assert.equal(handlers.events_list?.output, PAGE_SCHEMA)
})

test("the manifest and the handler table declare the same methods", () => {
  const entries = methodEntries(manifest, handlersFor(runtimeFor()))
  assert.deepEqual(
    entries.map((entry) => entry.name).sort(),
    Object.keys(manifest.methods)
      .filter((method) => !method.startsWith("mcp:"))
      .sort(),
  )
})

test("the recorded tool list states the host it was captured on, as evidence", () => {
  const host = typeof live.host === "object" ? live.host.opencode : live.host
  assert.equal(typeof host, "string")
  assert.ok((host ?? "").length > 0)
})
