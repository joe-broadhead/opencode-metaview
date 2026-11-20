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
    // The exact MCP tools the reads call, get_user_context as probe's identity. No key that consumers on
    // source-contract 0.1.x refuse (permission.readsIdentity among them): events_list reads only search_conversations.
    expect(source!.permission).toEqual({
      events: EVENTS_ACTION,
      operations: ["get_user_context", "search_conversations"],
      identity: ["get_user_context"],
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
      "failed-holds-cursor": "n/a",
    })
    const reasons = Object.fromEntries(reports[0]!.checks.filter((check) => check.reason).map((check) => [check.name, check.reason]))
    expect(reasons).toEqual({ "failed-holds-cursor": expect.stringContaining("search_conversations answers each page of conversations in one call") })
  })
})
