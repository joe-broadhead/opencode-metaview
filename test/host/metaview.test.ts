// The plugin on the public @opencode/sdk host: H1 load and connect, H2 what runs, H3 the permission model (P1-P5), H4
// adoption and conflict, H5 /metaview-status and the account capture, H6 unload, the user's own server with an API key
// that never reaches status, the account read by model turns with Code Mode off and on, the proofs on the tools RPC and
// Code Mode paths with nobody present, the `access` values, a server that asks for a sign-in, and the /connect entry.
// Each describe owns one host.
import { ROOT } from "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { Plugin } from "@opencode/plugin"
import { SUPPORTED_HOST, TESTED_HOSTS } from "../../src/constants.js"
import { DESTRUCTIVE_TOOLS } from "../../src/metaview-tools.js"
import { defaultRules, type Rule } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { StatusRpc } from "../../src/status.js"
import { TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { MODEL_ID } from "./fake-mcp.js"
import { agentRules, attempt, cleanup, effect, HOST_VERSION, session, startHost, until, type Host } from "./harness.js"

const AGENT_RULES = defaultRules().map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`).join("\n")
const AGENTS_NEXT_STEP = "Put the default rules shown by /metaview-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Metaview tools."
const KEY = "sk-fake-host-test-0123456789"
const SIGN_IN = "Run /connect and choose Metaview, then press o or Enter to open the link (in a terminal, opencode mcp auth metaview opens it automatically)."

// Starting a host takes several seconds, more on a busy machine.
setDefaultTimeout(120_000)
afterAll(cleanup)

const BUILT_IN = ["build", "general", "explore", "compaction", "title", "summary", "plan"]
const allow = (tool: string): Rule => ({ action: `metaview_${tool}`, resource: "*", effect: "allow" })
const deny = (tool: string): Rule => ({ action: `metaview_${tool}`, resource: "*", effect: "deny" })
const wildcard = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
/** The host hides a tool when the last rule matching its action is a deny on every resource. */
const hidden = (rules: readonly Rule[], action: string) => {
  const last = rules.findLast((rule) => wildcard(rule.action).test(action))
  return last?.resource === "*" && last.effect === "deny"
}

/** The host lists an MCP server's tools shortly after it connects, the three destructive ones included. */
const metaviewTools = (host: Host) =>
  until("Metaview's tools are registered", async () => {
    const ids = (await host.probe().tool.list()).map((tool) => tool.id).filter((id) => id.startsWith("metaview_"))
    return ids.length === 7 && ids.sort()
  })

async function status(host: Host, sessionID: string) {
  await host.client.sessions.command({ sessionID, name: "metaview-status", text: "" })
  return until("/metaview-status posts its text", async () => {
    const inbox = await host.client.session.inbox.list({ sessionID })
    const posted = inbox.findLast((item) => item.type === "synthetic")
    return posted?.type === "synthetic" ? posted.payload.text : undefined
  })
}

/** Enough of the tools RPC's contract for the client to call describe, the account read and one search. */
const TOOLS_CONTRACT = {
  id: TOOLS_RPC_ID,
  methods: Object.fromEntries(["describe", "get_user_context", "search_conversations"].map((name) => [name, { input: { type: "object" }, output: { type: "object" } }])),
  events: {},
}
type ToolsClient = Record<string, (input: object, options: object) => Promise<unknown>>
const toolsRpc = (host: Host) => (host.client.rpc as unknown as (definition: object) => ToolsClient)(TOOLS_CONTRACT)
/** A tools RPC call's output, or its error as JSON, so a test can search either for a secret. */
const scriptCall = (host: Host, method: string, input: object) =>
  toolsRpc(host)[method]!(input, { location: host.location }).then(
    (output) => JSON.stringify(output),
    (error: unknown) => JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})),
  )

const statusRpc = (host: Host) => (host.client.rpc as unknown as (definition: typeof StatusRpc) => { status: (input: object, options: object) => Promise<Record<string, unknown>> })(StatusRpc).status({}, { location: host.location })

describe(`the plugin on OpenCode ${HOST_VERSION}`, () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: () => ({ agents: { reviewer: { description: "Reviews changes", mode: "subagent" } } }) })
  })
  afterAll(() => host?.close())

  test("the host's global folders, temp folder and working directory are inside the test's temp root", async () => {
    const global = ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"].map((key) => join(process.env[key]!, "opencode"))
    expect(global.filter((path) => !existsSync(path))).toEqual([])
    const { paths } = await host.client.server.info()
    const used = [...global, realpathSync(paths.tmp), process.env.OPENCODE_TEST_HOME!, tmpdir(), process.cwd()]
    expect(used.filter((path) => !path.startsWith(ROOT + sep))).toEqual([])
  })

  test("H1: the plugin is active, metaview is connected, and its tools, skills and command are registered", async () => {
    const { data: plugins } = await host.client.plugin.list({ location: host.location })
    expect(plugins.find((plugin) => plugin.id === "metaview.workspace")?.state.status).toBe("active")
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    expect(servers.find((server) => server.name === "metaview")?.status).toEqual({ status: "connected" })
    expect(await metaviewTools(host)).toEqual([...["create_snippet", "get_user_context", "search_conversations", "shiny_new_tool", ...DESTRUCTIVE_TOOLS].map((tool) => `metaview_${tool}`)].sort())
    const { data: skills } = await host.client.skill.list({ location: host.location })
    expect(skills.map((skill) => skill.id).filter((id) => id.startsWith("metaview")).sort()).toEqual([...SKILL_NAMES].sort())
    const { data: commands } = await host.client.command.list({ location: host.location })
    expect(commands.map((command) => command.name)).toContain("metaview-status")
  })

  test("P1: the rules sit right after the base allow in every built-in agent, once", async () => {
    const rules = await agentRules(host)
    for (const id of BUILT_IN) {
      const permissions = rules.get(id)!
      const base = permissions.findIndex((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")
      expect(base).toBe(0)
      expect(permissions.slice(base + 1, base + 1 + defaultRules().length)).toEqual(defaultRules())
      expect(permissions.filter((rule) => rule.action === "metaview_*")).toHaveLength(1)
    }
  })

  test("P1: Plan and Explore are not weakened", async () => {
    expect(await effect(host, "plan", "edit")).toBe("deny")
    expect(await effect(host, "explore", "metaview_search_conversations")).toBe("deny")
    const explore = await session(host, "explore")
    expect(await attempt(host, explore, "explore", "search_conversations")).toEqual({ asked: undefined, ok: false, error: "Tool.Error: Permission denied: metaview_search_conversations" })
    const plan = await session(host, "plan")
    // Every tool is allowed by default, so a new tool runs there too.
    expect(await attempt(host, plan, "plan", "shiny_new_tool")).toMatchObject({ asked: undefined, ok: true })
  })

  test("P2 and H2: every tool runs without a prompt, the plugin's own reads, a write and one it does not know", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    expect(await attempt(host, build, "build", "search_conversations")).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", "shiny_new_tool")).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", "create_snippet")).toMatchObject({ asked: undefined, ok: true })
    expect(host.fake.calls.slice(before)).toEqual(["search_conversations", "shiny_new_tool", "create_snippet"])
    const rules = (await agentRules(host)).get("build")!
    expect(["metaview_search_conversations", "metaview_create_snippet", "metaview_shiny_new_tool"].filter((action) => hidden(rules, action))).toEqual([])
    // The three destructive tools are allowed too: only the read-only helpers' and Explore's own rules stop one.
    const all = await agentRules(host)
    for (const tool of DESTRUCTIVE_TOOLS) {
      for (const id of ["build", "general", "plan"]) expect({ id, tool, hidden: hidden(all.get(id)!, `metaview_${tool}`) }).toEqual({ id, tool, hidden: false })
      expect(await effect(host, "build", `metaview_${tool}`)).toBe("allow")
    }
  })

  test("DC-5: each destructive tool is a method with its class, and at this access it runs", async () => {
    const sessionID = await session(host)
    const described = JSON.parse(await scriptCall(host, "describe", {})) as { methods: { name: string; class: string }[] }
    const classOf = Object.fromEntries(described.methods.map((method) => [method.name, method.class]))
    const before = host.fake.calls.length
    for (const tool of DESTRUCTIVE_TOOLS) {
      expect(classOf[tool]).toBe("destructive")
      const call = (host.client.rpc as unknown as { call: (input: object) => Promise<unknown> }).call
      await call({ rpcID: TOOLS_RPC_ID, method: tool, input: { sessionID, input: { rationale: "record a decision" } }, location: host.location })
    }
    expect(host.fake.calls.slice(before)).toEqual([...DESTRUCTIVE_TOOLS])
  })

  test("P4: a saved 'Always allow' removes the prompt a user's own ask rule creates", async () => {
    // A session rule of the user's own is what asks now, the same shape a restricted access value gives.
    const asking = (await host.client.sessions.create({ agent: "build", location: host.location, permissions: [{ action: "metaview_shiny_new_tool", resource: "*", effect: "ask" }] })).id
    expect(await attempt(host, asking, "build", "shiny_new_tool", "always")).toMatchObject({ asked: "metaview_shiny_new_tool", ok: true })
    expect(await attempt(host, asking, "build", "shiny_new_tool")).toMatchObject({ asked: undefined, ok: true })
    const { projectID } = await host.client.sessions.get({ sessionID: asking })
    const saved = await host.client.permission.saved.list({ projectID })
    expect(saved.map(({ action, resource }) => ({ action, resource }))).toEqual([{ action: "metaview_shiny_new_tool", resource: "*" }])
  })

  test("P5: an agent defined only in user config gets no rules, and Metaview tools run there unprompted", async () => {
    const reviewer = (await agentRules(host)).get("reviewer")!
    expect(reviewer.some((rule) => rule.action.startsWith("metaview_"))).toBe(false)
    const sessionID = await session(host, "reviewer")
    expect(await attempt(host, sessionID, "reviewer", "create_snippet")).toMatchObject({ asked: undefined, ok: true })
  })

  test("H5: /metaview-status reports the connection, new tools, the unguarded agent and its fix, before any account read", async () => {
    await metaviewTools(host)
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: connected (${host.fake.url}, registered by this plugin)`)
    expect(text).toContain("- Account: not read yet")
    expect(text).toContain("- Tools: 7 available, 1 unknown: shiny_new_tool (new tools run too)\n")
    expect(text).toContain(`- Agents without default rules: reviewer\n${AGENT_RULES}\n`)
    expect(text).toContain(`- Next step: ${AGENTS_NEXT_STEP}`)
    expect(text).toContain(`- OpenCode: ${HOST_VERSION} (${TESTED_HOSTS.includes(HOST_VERSION) ? "tested" : "untested"}; supported range ${SUPPORTED_HOST})`)
  })

  test("H5: an account read fills the account, role and plan, in /metaview-status and the dialog's RPC", async () => {
    // The host's executors skip execute.after hooks, so this read goes through the tools RPC, which records the
    // account with the same function; a model turn records it through the hook.
    await toolsRpc(host).get_user_context!({ sessionID: await session(host), input: { rationale: "who is signed in" } }, { location: host.location })
    const text = await status(host, await session(host))
    expect(text).toContain("- Account: Acme Recruiting\n")
    expect(text).toContain("member: your own conversations and those shared with you;")
    expect(text).toContain("- Plan: paid\n")
    expect(await statusRpc(host)).toMatchObject({ workspace: "Acme Recruiting", role: "member", plan: "paid", unguardedAgents: ["reviewer"] })
    // Only the three fields: no ids from the result.
    expect(JSON.stringify(await statusRpc(host))).not.toMatch(/p_fake_1|u_fake_1/)
  })

  test("H6: unloading the plugin removes the server, the rules and the command", async () => {
    // Registering a plugin with the same ID replaces the old generation, which disposes everything it registered.
    await host.client.plugin(Plugin.define({ id: "metaview.workspace", setup: () => {} }))
    await until("the metaview server is gone", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return !data.some((server) => server.name === "metaview")
    })
    const rules = await agentRules(host)
    for (const id of BUILT_IN) expect(rules.get(id)!.some((rule) => rule.action.startsWith("metaview_"))).toBe(false)
    const { data: commands } = await host.client.command.list({ location: host.location })
    expect(commands.map((command) => command.name)).not.toContain("metaview-status")
  })
})

describe("the user's own metaview server, signing in with an API key", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: (url) => ({ mcp: { servers: { metaview: { type: "remote", url, oauth: false, headers: { "x-metaview-test": "user", Authorization: `Bearer ${KEY}` } } } } }),
    })
  })
  afterAll(() => host?.close())

  test("H4: is adopted unchanged: the host sends its headers, and the plugin's rules still apply", async () => {
    expect(await attempt(host, await session(host), "build", "search_conversations")).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, await session(host), "build", "create_snippet")).toMatchObject({ asked: undefined, ok: true })
    expect(host.fake.markers.length).toBeGreaterThan(0)
    expect(new Set(host.fake.markers)).toEqual(new Set(["user"]))
    expect(new Set(host.fake.authorizations)).toEqual(new Set([`Bearer ${KEY}`]))
  })

  test("the key never reaches /metaview-status or the status RPC, which name the entry as the user's own", async () => {
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: connected (${host.fake.url}, your own mcp.servers.metaview without OAuth, used unchanged)`)
    const output = await statusRpc(host)
    expect(output).toMatchObject({ state: "connected", source: { type: "adopted", signIn: "own" } })
    for (const shown of [text, JSON.stringify(output)]) {
      expect(shown).not.toContain(KEY)
      expect(shown).not.toMatch(/Bearer|Authorization/i)
    }
  })

  test("the key never reaches a script: not describe, a result or an upstream error", async () => {
    const sessionID = await session(host)
    const describe = await scriptCall(host, "describe", {})
    expect(describe).toContain("search_conversations")
    const result = await scriptCall(host, "search_conversations", { sessionID, input: { rationale: "list interviews" } })
    expect(result).toContain("called search_conversations")
    const failure = await scriptCall(host, "search_conversations", { sessionID, input: { query: "fail", rationale: "list interviews" } })
    expect(failure).toContain("UPSTREAM_ERROR")
    for (const shown of [describe, result, failure]) {
      expect(shown).not.toContain(KEY)
      expect(shown).not.toMatch(/Bearer/i)
    }
  })
})

describe("a model turn that reads the account", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: (url) => ({
        // The user's own entry at the fake, with Code Mode off, so the tools are the model's own tools.
        mcp: { servers: { metaview: { type: "remote", url, oauth: false, codemode: false } } },
        // No model leaves the machine: LM Studio's local API is the fake; the other local providers are off.
        providers: { lmstudio: { settings: { baseURL: `${new URL(url).origin}/v1` } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
      }),
    })
    const models = host.client as unknown as { model: { list: (input: object) => Promise<{ data: { id: string; providerID: string }[] }> } }
    await until("the scripted model is listed", async () => (await models.model.list({ location: host.location })).data.find((model) => model.providerID === "lmstudio" && model.id === MODEL_ID))
    await metaviewTools(host)
  })
  afterAll(() => host?.close())

  test("the model's own get_user_context call fills the account, role and plan through the execute.after hook", async () => {
    host.fake.model.script = [{ tool: "metaview_get_user_context", arguments: { rationale: "who is signed in" } }]
    const sessions = host.client.sessions as unknown as {
      create: (input: object) => Promise<{ id: string }>
      prompt: (input: object) => Promise<unknown>
    }
    const sessionID = (await sessions.create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    expect(await status(host, await session(host))).toContain("- Account: not read yet")
    await sessions.prompt({ sessionID, text: "Which Metaview workspace am I in?" })
    await until("the model's final turn", async () => host.fake.model.requests.filter((request) => (request as { messages?: { role: string }[] }).messages?.some((message) => message.role === "tool")).length > 0)
    expect(host.fake.calls).toContain("get_user_context")
    const text = await until("status shows the account", async () => {
      const posted = await status(host, await session(host))
      return posted.includes("Acme Recruiting") ? posted : undefined
    })
    expect(text).toContain("- Account: Acme Recruiting\n")
    expect(text).toContain("member: your own conversations and those shared with you;")
    expect(text).toContain("- Plan: paid\n")
    expect(text).not.toMatch(/p_fake_1|u_fake_1/)
  })

  test("DC-5: the model is offered the three destructive tools at this access, and each call reaches Metaview", async () => {
    host.fake.model.script = DESTRUCTIVE_TOOLS.map((tool) => ({ tool: `metaview_${tool}`, arguments: { rationale: "record a decision" } }))
    const before = host.fake.model.requests.length
    const sessions = host.client.sessions as unknown as {
      create: (input: object) => Promise<{ id: string }>
      prompt: (input: object) => Promise<unknown>
    }
    const sessionID = (await sessions.create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    await sessions.prompt({ sessionID, text: "Reject every candidate in the backend review and start outreach." })
    const turns = () => host.fake.model.requests.slice(before) as { tools?: { function?: { name?: string } }[]; messages?: { role: string }[] }[]
    await until("the model's final turn", async () => turns().some((request) => (request.messages ?? []).filter((message) => message.role === "tool").length >= DESTRUCTIVE_TOOLS.length))
    const offered = turns().flatMap((request) => (request.tools ?? []).map((item) => item.function?.name ?? ""))
    expect(offered.filter((name) => name.startsWith("metaview_"))).toContain("metaview_get_user_context")
    for (const tool of DESTRUCTIVE_TOOLS) {
      expect(offered).toContain(`metaview_${tool}`)
      expect(host.fake.calls).toContain(tool)
    }
  })
})

describe("a Code Mode turn that reads the account", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: (url) => ({
        // Code Mode on, as users run it by default: the model calls Metaview inside Code Mode's execute tool.
        mcp: { servers: { metaview: { type: "remote", url, oauth: false } } },
        providers: { lmstudio: { settings: { baseURL: `${new URL(url).origin}/v1` } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
      }),
    })
    const models = host.client as unknown as { model: { list: (input: object) => Promise<{ data: { id: string; providerID: string }[] }> } }
    await until("the scripted model is listed", async () => (await models.model.list({ location: host.location })).data.find((model) => model.providerID === "lmstudio" && model.id === MODEL_ID))
    await metaviewTools(host)
  })
  afterAll(() => host?.close())

  test("DC-10: an inner tools.metaview.get_user_context call fills the account through the execute.after hook", async () => {
    host.fake.model.script = [{ tool: "execute", arguments: { code: 'return await tools.metaview.get_user_context({ rationale: "who is signed in" })' } }]
    const sessions = host.client.sessions as unknown as {
      create: (input: object) => Promise<{ id: string }>
      prompt: (input: object) => Promise<unknown>
    }
    const sessionID = (await sessions.create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    await sessions.prompt({ sessionID, text: "Which Metaview workspace am I in?" })
    await until("the model's final turn", async () => host.fake.model.requests.some((request) => (request as { messages?: { role: string }[] }).messages?.some((message) => message.role === "tool")))
    expect(host.fake.calls).toContain("get_user_context")
    const text = await until("status shows the account", async () => {
      const posted = await status(host, await session(host))
      return posted.includes("Acme Recruiting") ? posted : undefined
    })
    expect(text).toContain("- Account: Acme Recruiting\n")
    expect(text).not.toMatch(/p_fake_1|u_fake_1/)
  })
})

describe("a user's own rule for a destructive tool", () => {
  // The recipe the guide gives: the rule goes in the agent's own permissions, which come after the plugin's block.
  const asked: Rule = { action: "metaview_manage_candidate_sequence", resource: "*", effect: "ask" }
  const denied: Rule = { action: "metaview_give_application_review_candidate_feedback", resource: "*", effect: "deny" }
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: () => ({ agents: { build: { permissions: [asked, denied] } } }) })
  })
  afterAll(() => host?.close())

  test("DC-5: one tool asks per call in that agent, one refuses, and the other agents and tools stay allowed", async () => {
    await metaviewTools(host)
    const rules = (await agentRules(host)).get("build")!
    const pluginBlock = rules.findIndex((rule) => rule.action === "metaview_*" && rule.effect === "allow")
    expect(rules.findIndex((rule) => JSON.stringify(rule) === JSON.stringify(asked))).toBeGreaterThan(pluginBlock)
    expect(await effect(host, "build", "metaview_manage_candidate_sequence")).toBe("ask")
    expect(await effect(host, "build", "metaview_give_application_review_candidate_feedback")).toBe("deny")
    const build = await session(host)
    expect(await attempt(host, build, "build", "manage_candidate_sequence")).toEqual({ asked: "metaview_manage_candidate_sequence", ok: false, error: "Permission.DeclinedError: " })
    expect(host.fake.calls).not.toContain("manage_candidate_sequence")
    // Each call asks again: a "once" answer runs one call and saves nothing.
    expect(await attempt(host, build, "build", "manage_candidate_sequence", "once")).toMatchObject({ asked: "metaview_manage_candidate_sequence", ok: true })
    expect(await attempt(host, build, "build", "manage_candidate_sequence")).toMatchObject({ asked: "metaview_manage_candidate_sequence", ok: false })
    // The denied one never runs, and the other agents and the other destructive tool stay allowed.
    expect(await attempt(host, build, "build", "give_application_review_candidate_feedback", "always")).toEqual({
      asked: undefined,
      ok: false,
      error: "Tool.Error: Permission denied: metaview_give_application_review_candidate_feedback",
    })
    expect(hidden(rules, "metaview_give_application_review_candidate_feedback")).toBe(true)
    for (const id of ["general", "plan"]) expect({ id, effect: await effect(host, id, "metaview_manage_candidate_sequence") }).toEqual({ id, effect: "allow" })
    expect(await effect(host, "build", "metaview_submit_feedback")).toBe("allow")
  })
})

describe("user permissions", () => {
  const userRules = [allow("create_snippet"), deny("search_conversations")]
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: () => ({
        permissions: userRules,
        // The documented fix for a config-only agent: the plugin's block first, then the user's rules again.
        agents: { reviewer: { description: "Reviews changes", mode: "subagent", permissions: [...defaultRules(), ...userRules] } },
      }),
    })
  })
  afterAll(() => host?.close())

  test("P3: a user allow on a write removes the prompt, and a user deny on a read hides it", async () => {
    const build = await session(host)
    expect(await attempt(host, build, "build", "create_snippet")).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", "search_conversations")).toEqual({ asked: undefined, ok: false, error: "Tool.Error: Permission denied: metaview_search_conversations" })
    expect(hidden((await agentRules(host)).get("build")!, "metaview_search_conversations")).toBe(true)
    expect(await attempt(host, build, "build", "shiny_new_tool")).toMatchObject({ asked: undefined, ok: true })
  })

  test("P5: the per-agent fix guards a config-only agent and keeps the user's rules winning", async () => {
    const reviewer = await session(host, "reviewer")
    expect(await attempt(host, reviewer, "reviewer", "shiny_new_tool")).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, reviewer, "reviewer", "create_snippet")).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, reviewer, "reviewer", "search_conversations")).toMatchObject({ asked: undefined, ok: false })
    expect(await status(host, reviewer)).toContain("- Agents without default rules: none\n")
  })
})

/**
 * Runs `code` as Code Mode does, through a schedule's check program: OpenCode checks each tool's input and output and
 * evaluates permissions with nobody present to answer a prompt. The program reports by throwing "SEEN <json>", so no
 * schedule is ever created and no model is involved.
 */
async function codeMode(host: Host, sessionID: string, code: string): Promise<{ seen: unknown } | { refused: string }> {
  let message: string
  try {
    const schedule = await host.client.experimental.schedule.create({
      sessionID,
      name: "metaview-host-test",
      when: { in: "6 hours" },
      prompt: "noop",
      if: { code },
    })
    await host.client.experimental.schedule.delete({ scheduleID: schedule.id })
    throw new Error("the check program finished without reporting")
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  const seen = /SEEN (.*)$/s.exec(message)
  if (!seen) return { refused: message }
  try {
    return { seen: JSON.parse(seen[1]!) }
  } catch {
    return { seen: seen[1]! }
  }
}

describe(`access on OpenCode ${HOST_VERSION}`, () => {
  // R18: one host test per value, on the tools RPC path, where a refusal must reach nothing.
  const call = async (host: Host, sessionID: string, method: string, input: unknown = { rationale: "host test" }): Promise<{ value?: unknown; refused?: string }> =>
    host.client.rpc
      .call({ rpcID: TOOLS_RPC_ID, method, input: { sessionID, input } as never, location: host.location })
      .then((result) => ({ value: result.output }))
      .catch((error: unknown) => ({ refused: (error as { data?: { code?: string }; message?: string }).data?.code ?? String(error) }))

  for (const [access, expectation] of [
    ["ask-changes", "refuse"],
    ["read-only", "deny"],
  ] as const) {
    describe(access, () => {
      let host: Host
      beforeAll(async () => {
        host = await startHost({ options: { access } })
        await metaviewTools(host)
      })
      afterAll(() => host?.close())

      test(`the block is the ${access} one, and a read still runs on the tools RPC path`, async () => {
        const rules = (await agentRules(host)).get("build")!
        expect(rules.slice(1, 1 + defaultRules(access).length)).toEqual(defaultRules(access))
        const before = host.fake.calls.length
        expect(await call(host, await session(host), "search_conversations")).toHaveProperty("value")
        expect(host.fake.calls.slice(before)).toEqual(["search_conversations"])
        expect(await status(host, await session(host))).toContain(`- Access: ${access === "read-only" ? "reads run without asking; every other tool is denied" : "reads run without asking; changes and new tools ask first"};`)
      })

      test(`a change is ${expectation === "deny" ? "denied" : "refused"} before dispatch, with nothing sent and no prompt left waiting`, async () => {
        const before = host.fake.calls.length
        const sessionID = await session(host)
        expect(await call(host, sessionID, "create_snippet")).toMatchObject({ refused: "PERMISSION_DENIED" })
        // A destructive tool follows the same rule as any other change.
        expect(await call(host, sessionID, "give_application_review_candidate_feedback")).toMatchObject({ refused: "PERMISSION_DENIED" })
        // An unknown tool is not a method at all, whatever the access value.
        expect((await call(host, sessionID, "shiny_new_tool")).refused ?? "").toContain("Unknown RPC method")
        expect(host.fake.calls.slice(before)).toEqual([])
        expect(await host.client.permission.list({ sessionID })).toEqual([])
      })
    })
  }

  describe("all", () => {
    let host: Host
    beforeAll(async () => {
      host = await startHost()
      await metaviewTools(host)
    })
    afterAll(() => host?.close())

    test("the block is the all one, and a write runs through the tools RPC with no prompt", async () => {
      const rules = (await agentRules(host)).get("build")!
      expect(rules.slice(1, 1 + defaultRules("all").length)).toEqual(defaultRules("all"))
      const before = host.fake.calls.length
      const sessionID = await session(host)
      expect(await call(host, sessionID, "create_snippet")).toHaveProperty("value")
      expect(await call(host, sessionID, "give_application_review_candidate_feedback", { rationale: "record a decision" })).toHaveProperty("value")
      expect(host.fake.calls.slice(before)).toEqual(["create_snippet", "give_application_review_candidate_feedback"])
      expect(await host.client.permission.list({ sessionID })).toEqual([])
    })
  })
})

describe(`Code Mode proofs on OpenCode ${HOST_VERSION}`, () => {
  // R2: the same proofs inside Code Mode's `execute`, where nobody can answer a prompt.
  let host: Host
  beforeAll(async () => {
    host = await startHost()
    await metaviewTools(host)
  })
  afterAll(() => host?.close())

  test("a read runs; an ask and a deny are refused with nothing sent; an unknown name is refused", async () => {
    const run = async (sessionID: string, tool: string) =>
      codeMode(host, sessionID, `const r = await tools.metaview[${JSON.stringify(tool)}]({ rationale: "host test" }); throw new Error("SEEN " + JSON.stringify(r))`)
    const created = async (permissions?: Rule[]) => (await host.client.sessions.create({ agent: "build", location: host.location, ...(permissions ? { permissions } : {}) })).id

    // A known read runs inside Code Mode, and Metaview is called once.
    const before = host.fake.calls.length
    expect(await run(await created(), "search_conversations")).toHaveProperty("seen")
    expect(host.fake.calls.slice(before)).toEqual(["search_conversations"])

    // An ask is refused before the tool runs: nothing reaches Metaview and no prompt is left waiting.
    const asking = host.fake.calls.length
    const askSession = await created([{ action: "metaview_create_snippet", resource: "*", effect: "ask" }])
    const asked = await run(askSession, "create_snippet")
    expect(asked).toHaveProperty("refused")
    expect((asked as { refused: string }).refused).toMatch(/needs approval|nobody is present|not permitted|declined/i)
    expect(host.fake.calls.slice(asking)).toEqual([])
    expect(await host.client.permission.list({ sessionID: askSession })).toEqual([])

    // A deny refuses, and a name that is not a method is not callable.
    const denied = await run(await created([{ action: "metaview_create_snippet", resource: "*", effect: "deny" }]), "create_snippet")
    expect(denied).toHaveProperty("refused")
    const unknown = await run(await created(), "no_such_tool")
    expect(unknown).toHaveProperty("refused")
    expect(host.fake.calls.slice(asking)).toEqual([])
  })
})

describe("a user metaview server that points elsewhere", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: (url) => ({ mcp: { servers: { metaview: { type: "remote", url: url.replace(/\/mcp$/, "/other"), oauth: false } } } }) })
  })
  afterAll(() => host?.close())

  test("H4: is left in place and reported as a conflict", async () => {
    const text = await status(host, await session(host))
    const other = host.fake.url.replace(/\/mcp$/, "/other")
    expect(text).toContain(`- Connection: conflict (your mcp.servers.metaview points at ${other})`)
    expect(text).toContain(`- Next step: Your OpenCode config defines mcp.servers.metaview with ${other}, but the plugin uses ${host.fake.url}.`)
  })
})

// Metaview's server answers 401 with a bearer challenge until the user signs in, or after its tokens are revoked. On
// the host's own MCP client that is a sign-in, not a failure: status says so, with the /connect step, and forgets the
// account read before it.
describe("a server that asks for a sign-in", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true })
  })
  afterAll(() => host?.close())

  test("DC-6: is sign-in required, with the /connect next step, in the RPC and in /metaview-status, and the account is forgotten", async () => {
    await metaviewTools(host)
    await toolsRpc(host).get_user_context!({ sessionID: await session(host), input: { rationale: "who is signed in" } }, { location: host.location })
    expect(await statusRpc(host)).toMatchObject({ state: "connected", workspace: "Acme Recruiting" })
    // The tokens stop working: the next connection gets the challenge.
    host.fake.challenge = true
    const mcp = host.client.mcp as unknown as Record<"connect" | "disconnect", (input: object) => Promise<unknown>>
    await mcp.disconnect({ server: "metaview", location: host.location })
    await mcp.connect({ server: "metaview", location: host.location }).catch(() => {})
    const server = await until("the server needs a sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      const found = data.find((item) => item.name === "metaview")
      return found?.status.status === "needs_auth" ? found : undefined
    })
    expect(server.status.status).toBe("needs_auth")
    const output = await until("status forgets the account", async () => {
      const read = await statusRpc(host)
      return read.workspace === null ? read : undefined
    })
    expect(output).toMatchObject({ state: "sign_in_required", nextStep: SIGN_IN, workspace: null, role: null, plan: null })
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: sign-in required (${host.fake.url}, registered by this plugin)`)
    expect(text).toContain(`- Next step: ${SIGN_IN}`)
    expect(text).not.toContain("Acme Recruiting")
  })
})

// The /connect mark is only observable while a credential remains, so this signs in with Metaview's own flow and a
// token that has no refresh token: a 401 then needs a new sign-in rather than a refresh, and the account stays. The
// plugin reads its mark back from the projected connection, so the mark it sets is the one it clears.
describe("the /connect sign-in mark", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true, challenge: true, fake: { refreshTokens: false } })
  })
  afterAll(() => host?.close())

  const SIGN_IN_AGAIN = "Metaview needs a new sign-in. Choose this account to sign in again."

  /** The /connect entry's connections, with the status a credential shows there. */
  const connections = async () => {
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((server) => server.name === "metaview")?.integrationID
    if (!integrationID) return []
    const { data } = await host.client.integration.get({ integrationID, location: host.location })
    return (data as unknown as { connections?: { type?: string; status?: { status: string; message?: string } }[] }).connections ?? []
  }

  /** Signs in through OpenCode's own flow: the authorization endpoint redirects the loopback callback, which exchanges its code. */
  const signIn = async () => {
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((server) => server.name === "metaview")!.integrationID!
    const { data: integration } = await host.client.integration.get({ integrationID, location: host.location })
    const oauth = (host.client.integration as unknown as { oauth: { connect: (input: object) => Promise<{ data: { attemptID: string; url: string } }> } }).oauth
    const { data: attempt } = await oauth.connect({ integrationID, methodID: (integration.methods[0] as unknown as { id: string }).id, location: host.location })
    const redirect = await fetch(attempt.url, { redirect: "manual" })
    const callback = redirect.headers.get("location")
    expect(callback).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    await fetch(callback!)
  }
  const connected = () =>
    until("the server is connected", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((server) => server.name === "metaview")?.status.status === "connected"
    })

  test("is set while the server needs a sign-in, and cleared once the same account connects again", async () => {
    await signIn()
    await until("the sign-in stores a token without a refresh token", async () => host.fake.tokens.length === 1)
    expect(host.fake.tokens[0]).toMatchObject({ grant_type: "authorization_code" })
    expect(host.fake.tokens[0]).not.toHaveProperty("refresh_token")
    host.fake.challenge = false
    await connected()
    expect(await until("/connect shows the account", async () => (await connections()).find((item) => item.type === "credential" && item.status?.message === undefined))).toBeDefined()

    // The token stops working, and there is no refresh token: a new sign-in, with the credential kept.
    host.fake.challenge = true
    const mcp = host.client.mcp as unknown as Record<"connect" | "disconnect", (input: object) => Promise<unknown>>
    await mcp.disconnect({ server: "metaview", location: host.location })
    await mcp.connect({ server: "metaview", location: host.location }).catch(() => {})
    await until("the server needs a sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((server) => server.name === "metaview")?.status.status === "needs_auth"
    })
    expect(await until("/connect shows the new sign-in on the account", async () => (await connections()).find((item) => item.status?.message === SIGN_IN_AGAIN))).toBeDefined()

    // The same account connects again: the plugin clears its own mark.
    host.fake.challenge = false
    await mcp.connect({ server: "metaview", location: host.location })
    await connected()
    expect(await until("/connect clears the sign-in mark", async () => ((await connections()).some((item) => item.status?.message) ? undefined : true))).toBe(true)
  })
})

describe("the /connect entry", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true })
  })
  afterAll(() => host?.close())

  const entry = async () => {
    const { data } = await host.client.mcp.list({ location: host.location })
    const integrationID = data.find((server) => server.name === "metaview")?.integrationID
    if (!integrationID) return undefined
    return (await host.client.integration.get({ integrationID, location: host.location })).data
  }

  test("is named Metaview, also after the host reloads its MCP servers", async () => {
    expect((await until("the entry is named Metaview", async () => ((await entry())?.name === "Metaview" ? entry() : undefined)))?.methods).toHaveLength(1)
    await host.probe().mcp.reload()
    await until("the entry is named Metaview again after the reload", async () => (await entry())?.name === "Metaview")
    await Bun.sleep(1000)
    expect((await entry())?.name).toBe("Metaview")
  })
})
