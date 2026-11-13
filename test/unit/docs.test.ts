// The docs and skills must match the code: tool names, the default rules for every access value, the tested releases,
// the error codes, the uninstall order and the Jelly guide. They state no tool counts, so a change to
// src/metaview-tools.ts cannot leave a stale number behind.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { TESTED_HOSTS } from "../../src/constants.js"
import { DESTRUCTIVE_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/metaview-tools.js"
import { defaultRules } from "../../src/permissions.js"

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
const KNOWN = [...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]
const text = (file: string) => readFileSync(join(ROOT, file), "utf8").replace(/\s+/g, " ")
const raw = (file: string) => readFileSync(join(ROOT, file), "utf8")

/** The JSON in the first fenced block after `marker`, parsed. */
function blockAfter(file: string, pattern: RegExp): unknown {
  const body = pattern.exec(raw(file))?.[1] ?? ""
  return JSON.parse(body)
}

/** The release the install specs name: package.json's version. */
const VERSION = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version
/** The README's upgrade example removes an earlier release's entry; it must name one before VERSION. */
const UPGRADE_FROM = /remove the old entry with `opencode plugin remove github:joe-broadhead\/opencode-metaview#v(\d+)\.(\d+)\.(\d+)`/

describe("docs", () => {
  test.each(FILES)("%s states no count of read, write or declared tools that could go stale", (file) => {
    const counts = [...text(file).matchAll(/\b\d+ (?:known )?(?:read|write)(?:s\b| tools\b| read-only)|\b\d+ tools are declared/g)].map((match) => match[0])
    const declared = `${READ_TOOLS.length + WRITE_TOOLS.length + DESTRUCTIVE_TOOLS.length} tools are declared`
    const stale = counts.filter((count) => !count.startsWith(`${READ_TOOLS.length} read`) && !count.startsWith(`${WRITE_TOOLS.length} write`) && count !== declared)
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
    // The install and uninstall specs name the release tag (D19), and nothing else may name a version.
    expect(text("README.md").replaceAll(`opencode-metaview#v${VERSION}`, "").replace(UPGRADE_FROM, "")).not.toMatch(/opencode-metaview@\d|\b0\.\d+\.\d+\b|\bv\d+\.\d+\.\d+\b/)
  })

  // A person reads the README first, so it says plainly what an all-allow default means here and the one-line way out.
  test("the README opens Permissions with what every-tool-allowed means for candidates and the ATS, and the two one-line restrictions", () => {
    const permissions = /## Permissions([\s\S]*?)## Configure/.exec(raw("README.md"))?.[1] ?? ""
    expect(permissions).toContain("**Every tool is allowed by default.**")
    expect(text("README.md")).toContain("act on candidates and your ATS without asking")
    for (const value of ['| `"all"` (the default) |', '| `"ask-changes"` |', '| `"read-only"` |']) expect(permissions).toContain(value)
    expect(permissions).toContain('"options": { "access": "read-only" }')
    // The three ways to restrict, in the order the family states them.
    for (const way of ["The `access` option", "An agent that asks, or reads only", "A rule per tool"]) expect(permissions).toContain(way)
  })

  test("every destructive tool is named in the README, the guide and the write skill", () => {
    for (const file of ["README.md", "docs/configuration.md", "skills/metaview-write/SKILL.md"]) {
      for (const name of DESTRUCTIVE_TOOLS) expect({ file, name, named: text(file).includes(name) }).toEqual({ file, name, named: true })
    }
  })

  test.each(FILES)("%s puts no ask or allow recipe for a Metaview tool at the top level, where it would reach Explore", (file) => {
    const body = raw(file)
    // Every JSON example that is a config: its top-level permissions only tighten. A bare array is an agent's own list.
    for (const [, json] of body.matchAll(/```json\n([^]*?)```/g)) {
      let config: unknown
      try {
        config = JSON.parse(json!)
      } catch {
        continue
      }
      if (Array.isArray(config) || typeof config !== "object" || config === null) continue
      const top = ((config as { permissions?: { action: string; effect: string }[] }).permissions ?? [])
      expect(top.filter((rule) => rule.action.startsWith("metaview_") && rule.effect !== "deny")).toEqual([])
    }
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
    const remove = uninstall.indexOf(`opencode plugin remove github:joe-broadhead/opencode-metaview#v${VERSION}`)
    expect(logout).toBeGreaterThanOrEqual(0)
    expect(list).toBeGreaterThan(logout)
    expect(remove).toBeGreaterThan(list)
  })

  test("the configuration guide documents every error code the plugin raises, none with a service prefix", () => {
    const sources = readdirSync(join(ROOT, "src")).filter((name) => name.endsWith(".ts"))
    const codes = new Set(sources.flatMap((name) => [...readFileSync(join(ROOT, "src", name), "utf8").matchAll(/(?:metaviewError|errorText)\(\s*"([A-Z][A-Z_]+)"/g)].map((match) => match[1]!)))
    expect(codes.size).toBeGreaterThan(3)
    const errors = /## Errors(.*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    for (const code of codes) {
      expect(code).not.toStartWith("METAVIEW_")
      expect(errors).toContain(`| \`${code}\` |`)
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
    // Every tool is declared allowed, and a tool Metaview adds later runs unasked: the guide says so plainly.
    expect(guide).toContain("- Ask: none. Every tool is allowed by default, in Jelly as in OpenCode.")
    expect(guide).toContain("in Jelly it runs without asking, even if it changes something")
    expect(guide).not.toContain("not asked about")
    const section = guide.split("Three of the declared tools")[1]?.split("A tool the upstream server adds later")[0] ?? ""
    for (const name of DESTRUCTIVE_TOOLS) expect(section).toContain(`\`metaview_${name}\``)
    const skills = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).jelly.skills as string[]
    expect(guide).toContain(`Declared: ${skills.map((name) => `\`${name}\``).join(", ")}.`)
  })

  test("the scripting guide points at the known reads, and says rationale goes inside the tool's input", () => {
    const guide = text("docs/scripting.md")
    expect(guide).toContain("(`READ_TOOLS` in `src/metaview-tools.ts`)")
    expect(guide).toContain('"input":{"rationale":')
  })
})

// The README prints the block the plugin inserts, in full, generated from defaultRules(): it is what an administrator
// copies into an agent's own permissions, so it cannot be elided or drift.
describe("the default rules block", () => {
  test("the README's Permissions section prints defaultRules() in full", () => {
    const printed = blockAfter("README.md", /## Permissions[\s\S]*?generated from[\s\S]*?```json\n([\s\S]*?)\n```/)
    expect(printed).toEqual(defaultRules())
  })

  test.each(["all", "ask-changes", "read-only"] as const)("the configuration guide prints the %s block in full", (access) => {
    const printed = blockAfter("docs/configuration.md", new RegExp(`\`access: "${access}"\`[\\s\\S]*?\\n\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``))
    expect({ access, printed }).toEqual({ access, printed: defaultRules(access) })
  })

  // A later rule of the user's still wins, and the block for one value cannot leave a tool the others restrict runnable.
  test("the three blocks differ only in the effect of a change", () => {
    const [all, ask, readOnly] = [defaultRules(), defaultRules("ask-changes"), defaultRules("read-only")]
    expect(all.map((rule) => rule.action)).toEqual(ask.map((rule) => rule.action))
    expect(all.map((rule) => rule.action)).toEqual(readOnly.map((rule) => rule.action))
    expect(ask.filter((rule) => rule.action === "metaview_*")[0]!.effect).toBe("ask")
    expect(readOnly.filter((rule) => rule.action === "metaview_*")[0]!.effect).toBe("deny")
  })

  test("the namespace rule covers a tool no list names yet", () => {
    for (const access of ["all", "ask-changes", "read-only"] as const) {
      const other = access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny"
      expect(defaultRules(access)[0]).toEqual({ action: "metaview_*", resource: "*", effect: other })
    }
  })
})

// Every "tested on …" mention states TESTED_HOSTS, so a release added to the list cannot leave a stale sentence behind.
describe("tested hosts", () => {
  const UNRELEASED = /## \[Unreleased\]([\s\S]*?)(?=\n## |$)/.exec(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"))?.[1] ?? ""
  const SOURCES: [string, string][] = [
    ["README.md", readFileSync(join(ROOT, "README.md"), "utf8")],
    ["AGENTS.md", readFileSync(join(ROOT, "AGENTS.md"), "utf8")],
    ["SECURITY.md", readFileSync(join(ROOT, "SECURITY.md"), "utf8")],
    ["docs/configuration.md", readFileSync(join(ROOT, "docs/configuration.md"), "utf8")],
    ["CHANGELOG.md (Unreleased)", UNRELEASED],
  ]

  test.each(SOURCES)("%s names exactly TESTED_HOSTS wherever it says what is tested", (file, body) => {
    // The sentence that says something is tested, so a version list in the next sentence cannot leak in.
    const mentions = body
      .split("\n")
      .flatMap((line) => line.split(/\.\s+/))
      .filter((sentence) => /\btested\b/i.test(sentence))
      // The supported range is not a tested release: drop a backticked `>=a.b.c <d.e.f` span before reading versions.
      .map((sentence) => sentence.replace(/`[^`]*>=[^`]*`/g, ""))
      .map((sentence) => [...sentence.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((version) => version[0]!))
      .filter((versions) => versions.length > 0)
    for (const versions of mentions) expect({ file, versions: [...new Set(versions)].sort() }).toEqual({ file, versions: [...TESTED_HOSTS].sort() })
  })

  test("the README's Requirements line names every tested release", () => {
    const requirements = /## Requirements([\s\S]*?)## /i.exec(readFileSync(join(ROOT, "README.md"), "utf8"))?.[1] ?? ""
    const named = [...requirements.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((match) => match[0]).filter((version) => version !== "2.3.0")
    expect([...new Set(named)].sort()).toEqual([...TESTED_HOSTS].sort())
  })

  // A release inside the range that ships later is the untested example, so it must be one that never ships.
  test("the untested example is 2.2.99, and no doc names a future release as tested", () => {
    const all = SOURCES.map(([, body]) => body).join("\n")
    expect(all).toContain("2.2.99")
    expect(all).not.toMatch(/\b2\.2\.(?:7|8|9[0-8])\b(?!\d)/)
  })
})

describe("the upgrade example", () => {
  test("removes an earlier release than the one the install specs name", () => {
    const match = UPGRADE_FROM.exec(text("README.md"))
    expect(match).not.toBeNull()
    const earlier = match!.slice(1, 4).map(Number)
    const current = VERSION.split(".").map(Number)
    const order = earlier.map((part, index) => part - current[index]!).find((difference) => difference !== 0) ?? 0
    expect(order).toBeLessThan(0)
  })
})
