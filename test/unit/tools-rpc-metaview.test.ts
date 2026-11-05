// Metaview's part of the tools RPC: the plugin-specific block of src/host/tools-rpc.ts. The shared part is tested in
// tools-rpc.test.ts.
import { afterEach, describe, expect, test } from "bun:test"
import { watchAccount } from "../../src/account.js"
import { PLUGIN_ID as METAVIEW_PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { KNOWN_READS, NEXT_STEPS, PLUGIN_ID, shapeResult, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { DENIED_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/metaview-tools.js"
import { defaultRules } from "../../src/permissions.js"

const stops: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop()
})

describe("Metaview's tools RPC", () => {
  test("is metaview.workspace.tools, under the plugin's own id", () => {
    expect(PLUGIN_ID).toBe(METAVIEW_PLUGIN_ID)
    expect(TOOLS_RPC_ID).toBe("metaview.workspace.tools")
  })

  test("its methods are exactly the known reads, the server tools the default rules allow", () => {
    expect([...KNOWN_READS]).toEqual([...READ_TOOLS])
    const allowed = defaultRules().filter((rule) => rule.effect === "allow").map((rule) => rule.action)
    expect(KNOWN_READS.map((name) => `${SERVER_NAME}_${name}`)).toEqual(allowed)
  })

  test("no write, no denied tool and no unknown tool is a method", () => {
    expect(KNOWN_READS.filter((name) => WRITE_TOOLS.includes(name) || DENIED_TOOLS.includes(name))).toEqual([])
    expect(KNOWN_READS).not.toContain("submit_feedback")
    for (const name of DENIED_TOOLS) expect(defaultRules()).toContainEqual({ action: `metaview_${name}`, resource: "*", effect: "deny" })
    for (const name of ["shiny_new_tool", "describe", "*"]) expect(KNOWN_READS).not.toContain(name)
  })

  test("names Metaview's own commands in its next steps, and has no per-account servers", () => {
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("/connect and choose Metaview")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("mcp.servers.metaview")
    expect(NEXT_STEPS.TOOL_UNAVAILABLE).toContain("products your account has")
    for (const step of Object.values(NEXT_STEPS)) expect(step).toMatch(/[^.]\.$/)
    expect(NEXT_STEPS.ACCOUNT_UNKNOWN).toBeUndefined()
  })

  test("a script's account read reaches status, and the result passes through unchanged", async () => {
    const never = { subscribe: ({ signal }: { signal: AbortSignal }) => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ done: true, value: undefined }))) }) }) }
    const account = await watchAccount({
      tool: { hook: async () => ({ dispose: async () => {} }) },
      mcp: { list: async () => ({ data: [] }) },
      event: never,
    } as never)
    stops.push(account.stop)
    const result = { output: { workspace_name: "Acme Recruiting", is_admin: false, is_paying_plan: true, user_id: "u_fake" }, text: "{}" }
    expect(shapeResult("search_conversations", result)).toBe(result)
    expect(account.current()).toBeUndefined()
    expect(shapeResult("get_user_context", result)).toBe(result)
    expect(account.current()).toEqual({ workspace: "Acme Recruiting", role: "member", plan: "paid" })
  })
})
