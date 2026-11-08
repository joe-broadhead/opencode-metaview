// Metaview's part of the tools RPC: the plugin-specific block of src/host/tools-rpc.ts. The shared part is tested in
// tools-rpc.test.ts.
import { afterEach, describe, expect, test } from "bun:test"
import { watchAccount } from "../../src/account.js"
import { PLUGIN_ID as METAVIEW_PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { METHODS, NEXT_STEPS, PLUGIN_ID, shapeInput, shapeResult, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { DESTRUCTIVE_TOOLS, READ_TOOLS, SEND_TOOLS, WRITE_TOOLS } from "../../src/metaview-tools.js"
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

  test("every known tool is a method, by exact name, with its class", () => {
    expect(METHODS.map((method) => method.name)).toEqual([...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS])
    const classOf = Object.fromEntries(METHODS.map((method) => [method.name, method.class]))
    for (const name of READ_TOOLS) expect(classOf[name]).toBe("read")
    for (const name of WRITE_TOOLS) expect(classOf[name]).toBe(SEND_TOOLS.includes(name) ? "send" : "write")
    for (const name of DESTRUCTIVE_TOOLS) expect(classOf[name]).toBe("destructive")
    expect(METHODS.every((method) => method.kind === "mcp")).toBe(true)
  })

  test("every known tool allows by default, and the namespace rule covers one Metaview adds later", () => {
    const allowed = defaultRules().filter((rule) => rule.effect === "allow").map((rule) => rule.action)
    expect(allowed).toEqual([`${SERVER_NAME}_*`, ...[...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].map((name) => `${SERVER_NAME}_${name}`)])
    for (const name of ["shiny_new_tool", "describe", "*"]) expect(METHODS.map((method) => method.name)).not.toContain(name)
  })

  test("names Metaview's own commands in its next steps, and has no per-account servers", () => {
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("/connect and choose Metaview")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("mcp.servers.metaview")
    expect(NEXT_STEPS.TOOL_UNAVAILABLE).toContain("products your account has")
    for (const step of Object.values(NEXT_STEPS)) expect(step).toMatch(/[^.]\.$/)
    expect(NEXT_STEPS.ACCOUNT_UNKNOWN).toBeUndefined()
  })

  test("leaves Metaview's arguments alone: the model path has no before hook", () => {
    expect(shapeInput("search_conversations", { query: "q" }, { sessionID: "s", agent: "a", action: "metaview_search_conversations" })).toEqual({ query: "q" })
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
    const call = { sessionID: "ses_script", agent: "build", action: "metaview_get_user_context" }
    expect(shapeResult("search_conversations", result, call)).toBe(result)
    expect(account.current()).toBeUndefined()
    expect(shapeResult("get_user_context", result, call)).toBe(result)
    expect(account.current()).toEqual({ workspace: "Acme Recruiting", role: "member", plan: "paid" })
  })
})
