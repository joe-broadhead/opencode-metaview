import { describe, expect, test } from "bun:test"
import { DISPLAY_NAME, SERVER_NAME } from "../../src/constants.js"
import { ACCESS_VALUES, parseOptions } from "../../src/options.js"
import { DESTRUCTIVE_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/metaview-tools.js"
import { defaultRules, evaluate, type Rule } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, readPackage } from "../support/jelly-kit.js"
import { ACCESS_CHOICES, type PluginSetting, settingChoices, settingsProblems, settingValueIssue } from "../support/jelly-settings.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly's agents have no base allow
 * rule, so this plugin's own rules never reach them: Jelly writes each declared "ask" or "deny" as that tool's default.
 * The shared kit checks the declaration against Jelly's plugin authors' standard; the tests below add what only
 * Metaview declares.
 */

const BASE_ALLOW: Rule = { action: "*", resource: "*", effect: "allow" }
const ROOT = new URL("../../", import.meta.url)
const pkg = readPackage(ROOT)
const jelly = pkg.jelly as Declaration & {
  tools: DeclaredTool[]
  skills: string[]
  rpc: unknown[]
  views: unknown[]
  signIns: unknown[]
  contributes: unknown
}
const byPermission = new Map(jelly.tools.map((tool) => [tool.permission, tool]))
const known = [...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].map((tool) => `${SERVER_NAME}_${tool}`)

describe("the jelly declaration", () => {
  test("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    expect(declarationProblems(ROOT, { effectOf: (permission) => evaluate([BASE_ALLOW, ...defaultRules()], permission), registered: known })).toEqual([])
  })

  test("declares every known tool once, each allowed at the default access", () => {
    for (const tool of READ_TOOLS) expect(byPermission.get(`metaview_${tool}`)).toMatchObject({ effect: "allow", readOnly: true })
    for (const tool of [...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]) expect(byPermission.get(`metaview_${tool}`)).toMatchObject({ effect: "allow", readOnly: false })
    expect(jelly.tools).toHaveLength(known.length)
    for (const tool of jelly.tools) expect(Object.keys(tool).sort()).toEqual(["effect", "name", "permission", "readOnly"])
  })

  test("keeps the tools that reach a candidate or the ATS declared as changes, so Jelly can restrict them", () => {
    const reachesPeople = [
      "post_sourcing_candidates_to_ats",
      "update_screen_outreach",
      "update_screen_plan",
      "manage_sequence",
      "enrich_candidate_contacts",
      "give_application_review_candidate_feedback",
      "manage_candidate_sequence",
    ]
    for (const tool of reachesPeople) expect(byPermission.get(`metaview_${tool}`)).toMatchObject({ effect: "allow", readOnly: false })
  })

  test("names every skill the package ships, the one sign-in, and no views, RPC, feeds or widgets", () => {
    expect(jelly.title).toBe(DISPLAY_NAME)
    expect(jelly.skills).toEqual([...SKILL_NAMES])
    expect(jelly.signIns).toEqual([{ id: SERVER_NAME, label: DISPLAY_NAME, server: SERVER_NAME }])
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({ homeFeeds: [], homeWidgets: [], workKinds: [], settings: [{ key: "access", label: "Access", type: "string", default: parseOptions({}).access, choices: [...ACCESS_CHOICES], description: expect.any(String) }] })
    expect(parseOptions({ access: "read-only" }).access).toBe("read-only")
  })
})

describe("docs/jelly.md", () => {
  test("follows the plugin authors' standard", () => {
    expect(docProblems(ROOT)).toEqual([])
  })
})

describe("the jelly settings declare their choices", () => {
  const settings = (pkg.jelly as unknown as { contributes: { settings: PluginSetting[] } }).contributes.settings
  const access = settings.find((setting) => setting.key === "access")!
  const accepts = (options: Record<string, unknown>) => {
    try {
      parseOptions(options)
      return true
    } catch {
      return false
    }
  }

  test("Jelly's setting schema reads them", () => {
    expect(settingsProblems(settings)).toEqual([])
  })

  test("access offers Jelly's three choices, word for word, and the options parser takes exactly those", () => {
    expect(access.choices).toEqual([...ACCESS_CHOICES])
    expect(settingChoices(access)?.map((choice) => choice.value)).toEqual([...ACCESS_VALUES])
    for (const { value } of ACCESS_CHOICES) expect(accepts({ access: value })).toBe(true)
    for (const value of ["read", "write", "none", "ALL"]) {
      expect(settingValueIssue(access, value)).not.toBeNull()
      expect(accepts({ access: value })).toBe(false)
    }
  })
})
