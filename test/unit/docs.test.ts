// The docs and skills must match the code: tool names, the deny rule, error codes, the uninstall order and the Jelly
// guide. They state no tool counts, so a change to src/metaview-tools.ts cannot leave a stale number behind.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DENIED_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/metaview-tools.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
// Everything a user or the model reads about the current release.
const FILES = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "AGENTS.md",
  ...readdirSync(join(ROOT, "docs")).map((name) => `docs/${name}`),
  ...readdirSync(join(ROOT, "skills")).map((name) => `skills/${name}/SKILL.md`),
]
const KNOWN = [...READ_TOOLS, ...WRITE_TOOLS, ...DENIED_TOOLS]
const text = (file: string) => readFileSync(join(ROOT, file), "utf8").replace(/\s+/g, " ")
const DENY_RULE = '{ "action": "metaview_submit_feedback", "resource": "*", "effect": "deny" }'
const OPT_IN = '{ "action": "metaview_submit_feedback", "resource": "*", "effect": "ask" }'

describe("docs", () => {
  test.each(FILES)("%s states no count of read, write or declared tools that could go stale", (file) => {
    const counts = [...text(file).matchAll(/\b\d+ (?:known )?(?:read|write)(?:s\b| tools\b| read-only)|\b\d+ tools are declared/g)].map((match) => match[0])
    const stale = counts.filter((count) => !count.startsWith(`${READ_TOOLS.length} read`) && !count.startsWith(`${WRITE_TOOLS.length} write`))
    expect(stale).toEqual([])
  })

  test.each(FILES)("%s names only Metaview tools the plugin knows", (file) => {
    const named = [...text(file).matchAll(/\bmetaview_([a-z][a-z_]*)(?![\w*])/g)].map((match) => match[1]!)
    expect(named.filter((tool) => !KNOWN.includes(tool))).toEqual([])
  })

  test.each(["README.md", "docs/configuration.md", "docs/scripting.md", "docs/jelly.md", "SECURITY.md"])("%s says nothing provisional or pending", (file) => {
    expect(text(file)).not.toMatch(/provisional|not yet (?:checked|published|signed)|private package|TODO/i)
  })

  test("the README names no version of the plugin, not even in an example", () => {
    expect(text("README.md")).not.toMatch(/opencode-metaview@\d|\b0\.\d+\.\d+\b|\bv\d+\.\d+\.\d+\b/)
  })

  test("the README and the configuration guide give each denied tool its deny rule, and the guide the ask rule that turns it on", () => {
    const rule = (name: string, effect: string) => `{ "action": "metaview_${name}", "resource": "*", "effect": "${effect}" }`
    for (const name of DENIED_TOOLS) {
      for (const file of ["README.md", "docs/configuration.md"]) expect(text(file)).toContain(rule(name, "deny"))
      expect(text("docs/configuration.md")).toContain(rule(name, "ask"))
      // The opt-in is a per-call ask, never an allow.
      for (const file of FILES) expect(text(file)).not.toContain(rule(name, "allow"))
    }
    expect(text("docs/configuration.md")).toContain(DENY_RULE)
    expect(text("skills/metaview-write/SKILL.md")).toContain(OPT_IN)
  })

  test.each(FILES)("%s puts no ask or allow recipe for a Metaview tool at the top level, where it would reach Explore", (file) => {
    const raw = readFileSync(join(ROOT, file), "utf8")
    // Every JSON example that is a config: its top-level permissions only tighten.
    for (const [, body] of raw.matchAll(/```json\n([^]*?)```/g)) {
      let config: unknown
      try {
        config = JSON.parse(body!)
      } catch {
        continue
      }
      const top = !Array.isArray(config) && typeof config === "object" && config !== null ? ((config as { permissions?: { action: string; effect: string }[] }).permissions ?? []) : []
      expect(top.filter((rule) => rule.action.startsWith("metaview_") && rule.effect !== "deny")).toEqual([])
    }
    // Every ask or allow rule for one tool sits in an agent's own rules, said in its paragraph or code block. The
    // plugin's own block, which the plugin inserts itself, is the one exception.
    const blocks = raw.split(/\n\s*\n/)
    blocks.forEach((block, index) => {
      if (!/\{ "action": "metaview_[a-z_]+", "resource": "\*", "effect": "(?:ask|allow)" \}/.test(block)) return
      const context = `${blocks[index - 1] ?? ""}\n${block}`
      if (/The plugin adds these\s+rules/.test(context)) return
      // "in your permissions or an agent's own" offers the top level too: it fails.
      const agentLevel = /agent's own|"agents"/.test(context) && !/\b(?:in|to) (?:your|the same) `permissions`|here or in an agent's own/.test(context.replace(/\s+/g, " "))
      expect({ file, block: block.slice(0, 120), agentLevel }).toEqual({ file, block: block.slice(0, 120), agentLevel: true })
    })
  })

  test("the strict-agent recipe repeats every deny after its metaview_* ask, so no denied tool reopens", () => {
    const recipe = text("docs/configuration.md").split("A strict agent where every Metaview tool asks")[1]?.split("```")[1] ?? ""
    const ask = recipe.indexOf('{ "action": "metaview_*", "resource": "*", "effect": "ask" }')
    expect(ask).toBeGreaterThanOrEqual(0)
    for (const name of DENIED_TOOLS) expect(recipe.indexOf(`{ "action": "metaview_${name}", "resource": "*", "effect": "deny" }`)).toBeGreaterThan(ask)
  })

  test("the docs show the user's own entry with an API key from the environment, never a key itself", () => {
    const guide = text("docs/configuration.md")
    expect(guide).toContain('"headers": { "Authorization": "Bearer {env:METAVIEW_API_KEY}" }')
    expect(guide).toContain('"oauth": false')
    for (const file of FILES) expect(text(file)).not.toMatch(/Bearer (?!\{env:)[A-Za-z0-9_-]{8,}/)
  })

  // Once the plugin is removed and OpenCode reloads, `mcp logout metaview` finds no server: sign out first.
  test("the README's Uninstall signs out before it removes the plugin", () => {
    const uninstall = /## Uninstall(.*?)## Links/.exec(text("README.md"))?.[1] ?? ""
    const logout = uninstall.indexOf("opencode mcp logout metaview")
    const list = uninstall.indexOf("opencode auth list")
    const remove = uninstall.indexOf("opencode plugin remove @joe-broadhead/opencode-metaview")
    expect(logout).toBeGreaterThanOrEqual(0)
    expect(list).toBeGreaterThan(logout)
    expect(remove).toBeGreaterThan(list)
  })

  // Every code the plugin's own code raises (the tools RPC's are in docs/scripting.md) has no service prefix and a row
  // in the configuration guide's Errors table.
  test("the configuration guide documents every error code the plugin raises, none with a service prefix", () => {
    const sources = readdirSync(join(ROOT, "src")).filter((name) => name.endsWith(".ts"))
    const codes = new Set(sources.flatMap((name) => [...readFileSync(join(ROOT, "src", name), "utf8").matchAll(/(?:metaviewError|errorText)\(\s*"([A-Z][A-Z_]+)"/g)].map((match) => match[1]!)))
    expect(codes.size).toBeGreaterThan(3)
    const errors = /## Errors(.*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    const troubleshooting = /## Troubleshooting(.*?)## /.exec(text("README.md"))?.[1] ?? ""
    for (const code of codes) {
      expect(code).not.toStartWith("METAVIEW_")
      expect(errors).toContain(`| \`${code}\` |`)
      // Every code the plugin raises has a README troubleshooting row too.
      expect({ code, inReadme: troubleshooting.includes(`| \`${code}\` |`) }).toEqual({ code, inReadme: true })
    }
  })

  test("the configuration guide's Errors table lists only codes the plugin raises", () => {
    const sources = readdirSync(join(ROOT, "src")).filter((name) => name.endsWith(".ts") && name !== "tools-rpc.ts")
    const raised = sources.map((name) => readFileSync(join(ROOT, "src", name), "utf8")).join("\n")
    const errors = /## Errors(.*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    const documented = [...errors.matchAll(/\| `([A-Z][A-Z_]+)` \|/g)].map((match) => match[1]!)
    expect(documented.length).toBeGreaterThan(5)
    expect(documented.filter((code) => !raised.includes(`"${code}"`) && !raised.includes(`${code}:`))).toEqual([])
  })

  test("the Jelly guide describes the declaration as Jelly reads it, with no placeholder or version", () => {
    const guide = text("docs/jelly.md")
    expect(guide).not.toMatch(/`latest` is|None yet/)
    expect(guide).toContain("the one line in `jelly.summary`, and beside it the mark in `jelly.icon`")
    // Jelly's contracts drop an unknown top-level key; they do not refuse the declaration for it.
    expect(guide).toContain("drop a top-level key they don't know")
    expect(guide).not.toMatch(/refuses this declaration|accepts no unknown keys/)
    // A tool Metaview adds later is undeclared, and Jelly runs it unasked: the guide says so plainly.
    expect(guide).toContain("in Jelly it runs without asking, even if it changes something")
    expect(guide).not.toContain("not asked about")
    const off = guide.split("- Off:")[1]?.split("- Everything else")[0] ?? ""
    for (const name of DENIED_TOOLS) expect(off).toContain(`\`metaview_${name}\``)
    const skills = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).jelly.skills as string[]
    expect(guide).toContain(`Declared: ${skills.map((name) => `\`${name}\``).join(", ")}.`)
  })

  test("the scripting guide points at the known reads, and says rationale goes inside the tool's input", () => {
    const guide = text("docs/scripting.md")
    expect(guide).toContain("(`READ_TOOLS` in `src/metaview-tools.ts`)")
    expect(guide).toContain('"input":{"rationale":')
  })
})
