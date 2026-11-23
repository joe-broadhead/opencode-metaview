import { describe, expect, test } from "bun:test"
import { DESTRUCTIVE_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/metaview-tools.js"
import { defaultRules, evaluate, hasDefaultRules, insertRules, registerDefaultRules, unguardedAgents, type Rule } from "../../src/permissions.js"
import { agentEditor, allow, builtInAgents, transforms, type AgentEditor, type FakeAgent } from "./fake.js"

const ACTIONS = ["metaview_search_conversations", "metaview_get_user_context", "metaview_create_snippet", "metaview_submit_feedback", "metaview_shiny_new_tool", "metaview_manage_candidate_sequence"]
const effects = (rules: readonly Rule[]) => ACTIONS.map((action) => evaluate(rules, action))

describe("defaultRules", () => {
  test("allow every Metaview tool, reads and a tool Metaview adds later alike", () => {
    const rules = defaultRules()
    expect(rules[0]).toEqual({ action: "metaview_*", resource: "*", effect: "allow" })
    expect(rules.slice(1)).toEqual(
      [...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].map((tool) => ({ action: `metaview_${tool}`, resource: "*", effect: "allow" })),
    )
    expect(rules.filter((rule) => rule.effect !== "allow")).toEqual([])
    expect(effects([allow("*"), ...rules])).toEqual(["allow", "allow", "allow", "allow", "allow", "allow"])
  })

  test("ask-changes allows reads and asks for everything else, new tools included", () => {
    const rules = defaultRules("ask-changes")
    expect(rules[0]).toEqual({ action: "metaview_*", resource: "*", effect: "ask" })
    expect(effects([allow("*"), ...rules])).toEqual(["allow", "allow", "ask", "ask", "ask", "ask"])
    for (const tool of DESTRUCTIVE_TOOLS) expect(evaluate([allow("*"), ...rules], `metaview_${tool}`)).toBe("ask")
  })

  test("read-only allows reads and denies everything else, new tools included", () => {
    const rules = defaultRules("read-only")
    expect(rules[0]).toEqual({ action: "metaview_*", resource: "*", effect: "deny" })
    expect(effects([allow("*"), ...rules])).toEqual(["allow", "allow", "deny", "deny", "deny", "deny"])
    for (const tool of DESTRUCTIVE_TOOLS) expect(evaluate([allow("*"), ...rules], `metaview_${tool}`)).toBe("deny")
  })

  test("a user's later rule still wins, whichever access the block came from", () => {
    const optIn = { action: "metaview_manage_candidate_sequence", resource: "*", effect: "ask" as const }
    expect(evaluate([allow("*"), ...defaultRules(), optIn], "metaview_manage_candidate_sequence")).toBe("ask")
    expect(evaluate([allow("*"), ...defaultRules("ask-changes"), allow("metaview_create_snippet")], "metaview_create_snippet")).toBe("allow")
    expect(evaluate([allow("*"), ...defaultRules("read-only"), allow("metaview_manage_candidate_sequence")], "metaview_manage_candidate_sequence")).toBe("allow")
  })
})

describe("insertRules", () => {
  test("splices the rules right after the base allow, before the agent's own rules", () => {
    const rules = defaultRules()
    for (const agent of builtInAgents()) {
      const before = agent.permissions.slice()
      expect(insertRules(agent.permissions, rules)).toBe(true)
      expect(agent.permissions).toEqual([before[0]!, ...rules, ...before.slice(1)])
    }
  })

  test("is idempotent, and finds the block after another plugin's", () => {
    const permissions = [allow("*")]
    insertRules(permissions, defaultRules())
    const once = permissions.slice()
    expect(insertRules(permissions, defaultRules())).toBe(false)
    expect(permissions).toEqual(once)
    const later = [allow("*"), allow("github_*"), ...defaultRules(), allow("metaview_create_snippet")]
    expect(insertRules(later, defaultRules())).toBe(false)
  })

  test("the block for each access value is inserted once, on every rebuild", () => {
    for (const access of ["all", "ask-changes", "read-only"] as const) {
      const permissions = [allow("*")]
      expect(insertRules(permissions, defaultRules(access))).toBe(true)
      expect(permissions.slice(1, 1 + defaultRules(access).length)).toEqual(defaultRules(access))
      expect(insertRules(permissions, defaultRules(access))).toBe(false)
    }
  })

  test("only the whole block counts: the namespace rule alone is not the block, so the block is added", () => {
    const own = [allow("*"), { action: "metaview_*", resource: "*", effect: "allow" as const }, allow("metaview_create_snippet")]
    expect(hasDefaultRules(own)).toBe(false)
    expect(insertRules(own, defaultRules())).toBe(true)
    expect(own.slice(1, 1 + defaultRules().length)).toEqual(defaultRules())
    expect(hasDefaultRules(own)).toBe(true)
  })

  test("leaves agents without a base allow untouched and never throws on odd lists", () => {
    const deny = (action: string): Rule => ({ action, resource: "*", effect: "deny" })
    for (const permissions of [[], [deny("*")], [allow("read")]] as Rule[][]) {
      const before = permissions.slice()
      expect(insertRules(permissions, defaultRules())).toBe(false)
      expect(permissions).toEqual(before)
    }
  })

  test("stricter agents stay stricter: Explore's own deny still wins", () => {
    const [, plan, explore] = builtInAgents() as [FakeAgent, FakeAgent, FakeAgent]
    insertRules(explore.permissions, defaultRules())
    expect(effects(explore.permissions)).toEqual(["deny", "deny", "deny", "deny", "deny", "deny"])
    insertRules(plan.permissions, defaultRules())
    expect(effects(plan.permissions)).toEqual(["allow", "allow", "allow", "allow", "allow", "allow"])
  })

  test("the user's rules come later and win, both ways", () => {
    const permissions = [allow("*")]
    insertRules(permissions, defaultRules())
    permissions.push({ action: "metaview_create_snippet", resource: "*", effect: "deny" }, { action: "metaview_submit_feedback", resource: "*", effect: "ask" })
    expect(effects(permissions)).toEqual(["allow", "allow", "deny", "ask", "allow", "allow"])
  })
})

describe("registerDefaultRules", () => {
  test("adds the rules to every agent once per rebuild and reports no problem", async () => {
    const { transform, run } = transforms<AgentEditor>()
    const problems: (string | undefined)[] = []
    await registerDefaultRules({ transform }, defaultRules(), (problem) => problems.push(problem))
    for (let rebuild = 0; rebuild < 2; rebuild++) {
      const agents = builtInAgents()
      run(agentEditor(agents))
      for (const agent of agents) expect(agent.permissions.filter((rule) => rule.action === "metaview_*")).toHaveLength(1)
    }
    expect(problems).toEqual([undefined, undefined])
  })

  test("never throws; a failure is reported for status", async () => {
    const { transform, run } = transforms<AgentEditor>()
    const problems: (string | undefined)[] = []
    await registerDefaultRules({ transform }, defaultRules(), (problem) => problems.push(problem))
    const broken = { ...agentEditor([]), list: () => { throw new Error("boom") } }
    expect(() => run(broken)).not.toThrow()
    expect(problems).toEqual([
      "RULES_NOT_ADDED: Metaview's default permission rules could not be added (boom), so Metaview tools may run without asking. Next step: Restart OpenCode.",
    ])
  })
})

describe("unguardedAgents", () => {
  test("names agents with a base allow, no block, and rules that would let a new Metaview tool run", () => {
    const guarded = [allow("*"), ...defaultRules()]
    const agents = [
      { id: "build", permissions: guarded },
      { id: "reviewer", permissions: [allow("*")] },
      { id: "fixed", permissions: [allow("*"), ...defaultRules(), allow("metaview_create_snippet")] },
      { id: "other-plugin-first", permissions: [allow("*"), allow("github_*"), ...defaultRules()] },
      { id: "block-before-base", permissions: [...defaultRules(), allow("*")] },
      { id: "locked", permissions: [allow("*"), { action: "*", resource: "*", effect: "deny" as const }] },
      { id: "denies-metaview", permissions: [allow("*"), { action: "metaview_*", resource: "*", effect: "deny" as const }] },
      // No base allow: the plugin adds no rules there, and nothing needs fixing.
      { id: "own-allow-no-base", permissions: [allow("metaview_*")] },
    ]
    expect(unguardedAgents(agents)).toEqual(["reviewer", "block-before-base"])
    expect(hasDefaultRules(guarded)).toBe(true)
    expect(hasDefaultRules([...defaultRules()])).toBe(false)
    // An agent carrying the restricted block is guarded for every access value; its own rules already deny a new tool.
    for (const access of ["all", "ask-changes", "read-only"] as const) {
      expect({ access, agents: unguardedAgents([{ id: "careful", permissions: [allow("*"), ...defaultRules("read-only")] }], access) }).toEqual({ access, agents: [] })
    }
  })
})
