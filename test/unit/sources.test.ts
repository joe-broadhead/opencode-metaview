// package.json's `sources` (source-contract version 1): the declaration as a consumer and the kit read it, and the
// kit's report over the plugin's own reads (test/support/conformance.ts, offline). Every id and name is invented.
import { describe, expect, test } from "bun:test"
import { assertDeclaration } from "@we-the-rebel-alliance/source-contract/conformance"
import { EVENTS_LIST, PROBE } from "@we-the-rebel-alliance/source-contract/events"
import { toolsRpcIdProblems } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { EVENTS_ACTION, EVENTS_TOOL, MAX_BYTES, PACKAGE, PROBE_ACTION, SOURCE, SOURCE_ID } from "../../src/events/index.js"
import { PLUGIN_METHODS } from "../../src/metaview-tools.js"
import { TOOLS_RPC_ID } from "../../src/tools-rpc.js"
import { conformanceReports, declaredSources, declaredTools, installed } from "../support/conformance.js"

/**
 * v0.3 checks this source carries nothing for. The kit marks each not applicable and states no reason of its own; an
 * empty reason would be no reason, so the test states why. A conversation's actor is a role, never a from or author.
 */
const ABSENT = {
  "actor-kind": "no event names an actor's kind, so actor-kind does not apply",
  "commitment-key": "no page carries a commitment, so commitment-key does not apply",
  facts: "no page carries a fact, so facts does not apply",
  hints: "the source declares no hint file, so hints does not apply",
  "one-author": "no page lists a from or author actor, so one-author does not apply",
  "parts-stable": "no page carries a part, so parts-stable does not apply",
  routines: "the source declares no routine file, so routines does not apply",
}

describe("package.json's sources", () => {
  test("is one events source, read as a consumer reads an installed plugin, and passes Memory's schema and the kit's rules", () => {
    const descriptor = installed()
    expect(descriptor.package).toBe(PACKAGE)
    expect(descriptor.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    const sources = declaredSources()
    expect(sources.items.map((item) => [item.id, item.kind, item.tool])).toEqual([[SOURCE_ID, "events", EVENTS_TOOL]])
    const [source] = sources.items
    expect(source).toMatchObject({
      reads: "meeting",
      input: { source: SOURCE },
      accounts: { named: true },
      private: true,
      cost: { class: "free" },
      maxBytes: MAX_BYTES,
      urlHosts: ["app.metaview.ai"],
    })
    // The exact MCP tools the reads call: get_user_context is probe's identity operation, and events_list reads it too
    // (it must know whose conversations are the user's own), which `readsIdentity` says.
    expect(source!.permission).toEqual({
      events: EVENTS_ACTION,
      operations: ["get_user_context", "search_conversations"],
      identity: ["get_user_context"],
      readsIdentity: true,
    })
    expect(() => assertDeclaration(sources, { tools: declaredTools() })).not.toThrow()
  })

  test("names the tools RPC this plugin registers, the probe action its method asserts, and the contract's method names", () => {
    const sources = declaredSources()
    expect(sources.rpc).toBe(TOOLS_RPC_ID)
    expect(toolsRpcIdProblems(sources.rpc, { id: TOOLS_RPC_ID })).toEqual([])
    expect(sources.probe).toEqual({ action: PROBE_ACTION })
    expect([EVENTS_TOOL, EVENTS_ACTION, PROBE_ACTION]).toEqual([EVENTS_LIST, `metaview_${EVENTS_LIST}`, `metaview_${PROBE}`])
    // The default rules and status know the two from src/metaview-tools.ts, which has no runtime imports.
    expect(PLUGIN_METHODS).toEqual([EVENTS_LIST, PROBE])
  })

  test("passes the conformance kit, with every check that applies run, the gap's included, and says why failed[] cannot happen", async () => {
    const reports = await conformanceReports()
    expect(reports.map((report) => ({ source: report.source, problems: report.problems, incomplete: report.incomplete, ok: report.ok }))).toEqual([
      { source: SOURCE_ID, problems: [], incomplete: false, ok: true },
    ])
    const checks = Object.fromEntries(reports[0]!.checks.map((check) => [check.name, check.notApplicable ? "n/a" : check.ran ? "ran" : "missing"]))
    expect(checks).toMatchObject({
      declaration: "ran",
      "page-result": "ran",
      "refused-is-final": "ran",
      probe: "ran",
      "identity-grants": "ran",
      "rpc-id": "ran",
      "unused-grants": "ran",
      // Metaview's retention may delete history, so an old cursor answers a gap: no noExpiry.
      "gap-and-cursor-expired": "ran",
      "gap-once-per-read": "ran",
      // A page carries events, so the page's byte cap is checked.
      "event-within-max-bytes": "ran",
      "failed-holds-cursor": "n/a",
    })
    // The v0.3 checks in ABSENT do not apply either; each reason is non-empty, which is what the kit accepts for a
    // stated skip.
    for (const [name, reason] of Object.entries(ABSENT)) {
      expect(reason.trim()).not.toBe("")
      expect(reports[0]!.checks.find((check) => check.name === name)).toMatchObject({ ran: false, notApplicable: true, problems: [] })
    }
    const reasons = Object.fromEntries(reports[0]!.checks.filter((check) => check.reason).map((check) => [check.name, check.reason]))
    expect(reasons).toEqual({ "failed-holds-cursor": expect.stringContaining("search_conversations answers each page of conversations in one call") })
  })
})
