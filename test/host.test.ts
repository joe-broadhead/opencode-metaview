import assert from "node:assert/strict"
import { test } from "node:test"
import { assertHost } from "@we-the-rebel-alliance/plugin-contract/register"
import { manifest } from "../src/manifest.ts"

const context = (version: string, options: Readonly<Record<string, unknown>> = {}) => ({ app: { version }, options })

test("a tested host starts the plugin", () => {
  assert.doesNotThrow(() => assertHost(context("2.4.1"), manifest))
  assert.doesNotThrow(() => assertHost(context("2.4.9"), manifest))
})

test("an untested host gets the contract's clean refusal", () => {
  assert.throws(
    () => assertHost(context("2.5.0"), manifest),
    (error: unknown) => error instanceof Error && error.message.startsWith("HOST_UNTESTED: ") && error.message.includes("Next step: "),
  )
  assert.throws(() => assertHost(context("not a version"), manifest), /HOST_UNTESTED:/)
})

test("allowUntestedHost starts the plugin anyway", () => {
  assert.doesNotThrow(() => assertHost(context("2.5.0", { allowUntestedHost: true }), manifest))
})
