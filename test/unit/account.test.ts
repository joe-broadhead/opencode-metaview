// The account capture: three fields of a get_user_context result, kept in memory and forgotten on sign-out.
import { afterEach, describe, expect, test } from "bun:test"
import { accountOf, captureAccount, watchAccount } from "../../src/account.js"

type Event = { type: string; data: { server?: string } }

/** An event stream the test drives, ended by the subscriber's signal. */
function events() {
  const listeners = new Set<(event: Event) => void>()
  const subscribe = ({ signal }: { signal: AbortSignal }) => {
    const queue: Event[] = []
    let wake: (() => void) | undefined
    const listener = (event: Event) => (queue.push(event), wake?.())
    listeners.add(listener)
    signal.addEventListener("abort", () => (listeners.delete(listener), wake?.()))
    return {
      async *[Symbol.asyncIterator]() {
        while (!signal.aborted) {
          if (queue.length) yield queue.shift()!
          else await new Promise<void>((resolve) => (wake = resolve))
        }
      },
    }
  }
  return { subscribe, emit: (type: string, data: Event["data"] = {}) => listeners.forEach((listener) => listener({ type, data })) }
}

const RESULT = { workspace_name: "Acme\u0007 Recruiting", is_admin: true, is_paying_plan: false, user_id: "u_fake_1", participant_id: "p_fake_1", data_access: "every conversation" }
const stops: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop()
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

async function watch() {
  const stream = events()
  let after: ((event: unknown) => Promise<void> | void) | undefined
  const state = { server: "connected" }
  const account = await watchAccount({
    tool: { hook: async (_name: string, callback: (event: unknown) => void) => ((after = callback), { dispose: async () => void (after = undefined) }) },
    mcp: { list: async () => ({ data: [{ name: "metaview", status: { status: state.server } }] }) },
    event: { subscribe: stream.subscribe },
  } as never)
  stops.push(account.stop)
  return { account, state, stream, after: async (event: unknown) => await after?.(event) }
}

describe("accountOf", () => {
  test("reads the workspace name, role and plan, and nothing else", () => {
    const expected = { workspace: "Acme Recruiting", role: "admin", plan: "free" } as const
    expect(accountOf({ output: RESULT })).toEqual(expected)
    expect(accountOf({ content: [{ type: "text", text: JSON.stringify(RESULT) }] })).toEqual(expected)
    expect(accountOf({ output: { user: { workspace_name: "Globex", is_admin: false } } })).toEqual({ workspace: "Globex", role: "member" })
    expect(JSON.stringify(accountOf({ output: RESULT }))).not.toMatch(/u_fake|p_fake|every conversation/)
  })

  test("reads the flat shape get_user_context's description documents, with organization_id and every other key ignored", () => {
    // Its documented response format, with invented values. The tool declares no output schema.
    const documented = { organization_id: 1, workspace_name: "Globex Talent", user_id: 123, participant_id: "p_fake_2", is_admin: true, is_paying_plan: true, data_access: "You can see all conversations in the organization." }
    expect(accountOf({ content: [{ type: "text", text: JSON.stringify(documented) }] })).toEqual({ workspace: "Globex Talent", role: "admin", plan: "paid" })
  })

  test("notes_on_platform_credits in place of is_paying_plan means shared credits; its text is never read", () => {
    const credits = { workspace_name: "Globex Talent", is_admin: false, notes_on_platform_credits: "Fake note: 40 conversations left" }
    const account = accountOf({ output: credits })
    expect(account).toEqual({ workspace: "Globex Talent", role: "member", plan: "credits" })
    expect(JSON.stringify(account)).not.toContain("40 conversations")
    // A paid flag, when both appear, decides.
    expect(accountOf({ output: { ...credits, is_paying_plan: false } })?.plan).toBe("free")
  })

  test("cuts a long name, and ignores results without the fields", () => {
    expect(accountOf({ output: { workspace_name: "x".repeat(200) } })?.workspace).toHaveLength(80)
    for (const result of [{}, { output: "not json" }, { output: [1] }, { content: [{ type: "image" }] }, { output: { workspace_name: 3 } }]) expect(accountOf(result)).toBeUndefined()
  })
})

describe("watchAccount", () => {
  test("captures a completed model call of get_user_context only", async () => {
    const { account, after } = await watch()
    await after({ tool: "metaview_search_conversations", status: "completed", result: { output: RESULT } })
    await after({ tool: "metaview_get_user_context", status: "error", error: new Error("x") })
    expect(account.current()).toBeUndefined()
    await after({ tool: "metaview_get_user_context", status: "completed", result: { output: RESULT } })
    expect(account.current()).toEqual({ workspace: "Acme Recruiting", role: "admin", plan: "free" })
    // A later result without the fields keeps what was read.
    await after({ tool: "metaview_get_user_context", status: "completed", result: { output: "{}" } })
    expect(account.current()?.workspace).toBe("Acme Recruiting")
  })

  test("a script's read through the tools RPC reaches every running instance", async () => {
    const first = await watch()
    const second = await watch()
    captureAccount({ output: RESULT })
    expect([first.account.current()?.role, second.account.current()?.role]).toEqual(["admin", "admin"])
  })

  test("forgets the account when the server needs a new sign-in or the account is switched", async () => {
    const { account, after, state, stream } = await watch()
    await after({ tool: "metaview_get_user_context", status: "completed", result: { output: RESULT } })
    await tick()
    stream.emit("mcp.status.changed", { server: "other" })
    await tick()
    expect(account.current()).toBeDefined()
    state.server = "needs_auth"
    stream.emit("mcp.status.changed", { server: "metaview" })
    await tick()
    expect(account.current()).toBeUndefined()
    state.server = "connected"
    await after({ tool: "metaview_get_user_context", status: "completed", result: { output: RESULT } })
    expect(account.current()).toBeDefined()
    stream.emit("credential.switched")
    await tick()
    expect(account.current()).toBeUndefined()
  })

  test("while any instance signs in with its own key entry, a script's account read updates no status", async () => {
    const shared = await watch()
    const stream = events()
    const own = await watchAccount(
      { tool: { hook: async () => ({ dispose: async () => {} }) }, mcp: { list: async () => ({ data: [] }) }, event: { subscribe: stream.subscribe } } as never,
      () => true,
    )
    stops.push(own.stop)
    captureAccount({ output: RESULT })
    expect([shared.account.current(), own.current()]).toEqual([undefined, undefined])
    // The model path belongs to its own instance, so it still records the account there.
    await shared.after({ tool: "metaview_get_user_context", status: "completed", result: { output: RESULT } })
    expect(shared.account.current()?.workspace).toBe("Acme Recruiting")
  })

  test("an instance whose metaview server is at another URL records no account, from the model or a script", async () => {
    const stream = events()
    let after: ((event: unknown) => Promise<void> | void) | undefined
    const foreign = await watchAccount(
      {
        tool: { hook: async (_name: string, callback: (event: unknown) => void) => ((after = callback), { dispose: async () => {} }) },
        mcp: { list: async () => ({ data: [{ name: "metaview", status: { status: "connected" } }] }) },
        event: { subscribe: stream.subscribe },
      } as never,
      () => false,
      () => false,
    )
    stops.push(foreign.stop)
    await after?.({ tool: "metaview_get_user_context", status: "completed", result: { output: RESULT } })
    captureAccount({ output: RESULT })
    expect(foreign.current()).toBeUndefined()
  })

  test("notes when the server's status last changed, for status's listing check", async () => {
    const { account, stream } = await watch()
    const started = account.changedAt()
    await tick()
    stream.emit("mcp.status.changed", { server: "other" })
    await tick()
    expect(account.changedAt()).toBe(started)
    stream.emit("mcp.status.changed", { server: "metaview" })
    await tick()
    expect(account.changedAt()).toBeGreaterThan(started)
  })

  test("stops capturing once stopped", async () => {
    const { account } = await watch()
    await stops.pop()!()
    captureAccount({ output: RESULT })
    expect(account.current()).toBeUndefined()
  })
})
