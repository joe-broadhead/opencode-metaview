import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadSkills, parseSkill, registerSkills, SKILL_NAMES, SKILLS_DIR } from "../../src/skills.js"

const root = mkdtempSync(join(tmpdir(), "metaview-skill-loading-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function skills(files: Record<string, string>) {
  const directory = mkdtempSync(join(root, "skills-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(directory, name))
    writeFileSync(join(directory, name, "SKILL.md"), text)
  }
  return directory
}

const ok = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\nBody\n`

describe("skill loading", () => {
  test("the main skill, the candidate brief and the one for changes", () => {
    expect([...SKILL_NAMES]).toEqual(["metaview", "metaview-candidate-brief", "metaview-write"])
    expect(SKILLS_DIR.replaceAll("\\", "/").endsWith("/skills/")).toBe(true)
  })

  test("parses LF and CRLF frontmatter into a skill", () => {
    for (const newline of ["\n", "\r\n"]) {
      const text = ["---", "name: metaview", 'description: "Use Metaview: find, read and cite interviews."', "---", "", "# Metaview", "Body."].join(newline)
      expect(parseSkill("metaview", "/pkg/skills/metaview/SKILL.md", text)).toEqual({
        id: "metaview",
        name: "metaview",
        description: "Use Metaview: find, read and cite interviews.",
        path: "/pkg/skills/metaview/SKILL.md",
        content: "# Metaview\nBody.",
      } as never)
    }
  })

  test.each([
    ["no frontmatter", "# Metaview", "skills/metaview/SKILL.md has no frontmatter"],
    ["the wrong name", "---\nname: other\ndescription: d\n---\n", 'skills/metaview/SKILL.md must be named "metaview" in its frontmatter'],
    ["no description", "---\nname: metaview\n---\n", "skills/metaview/SKILL.md has no description"],
  ])("rejects a skill with %s", (_, text, message) => {
    expect(() => parseSkill("metaview", "/x", text)).toThrow(message)
  })

  test("loads every skill", async () => {
    const directory = skills(Object.fromEntries(SKILL_NAMES.map((name) => [name, ok(name)])))
    const loaded = await loadSkills(directory)
    expect(loaded.skills.map((skill): string => skill.id)).toEqual([...SKILL_NAMES])
    expect(loaded.problems).toEqual([])
  })

  test("a missing or broken skill becomes a problem for status, not a setup failure", async () => {
    const directory = skills({ metaview: "---\nname: metaview\n---\n", "metaview-write": ok("metaview-write") })
    const loaded = await loadSkills(directory)
    expect(loaded.skills.map((skill): string => skill.id)).toEqual(["metaview-write"])
    expect(loaded.problems).toEqual([
      'SKILLS_INVALID: The "metaview" skill was not loaded: skills/metaview/SKILL.md has no description. Next step: Reinstall the plugin.',
      'SKILLS_INVALID: The "metaview-candidate-brief" skill was not loaded: skills/metaview-candidate-brief/SKILL.md is missing. Next step: Reinstall the plugin.',
    ])
  })

  test("an unreadable skill file is reported as unreadable, not missing", async () => {
    const directory = skills({ "metaview-candidate-brief": ok("metaview-candidate-brief"), "metaview-write": ok("metaview-write") })
    mkdirSync(join(directory, "metaview", "SKILL.md"), { recursive: true })
    expect((await loadSkills(directory)).problems).toEqual([
      'SKILLS_INVALID: The "metaview" skill was not loaded: skills/metaview/SKILL.md cannot be read (EISDIR). Next step: Reinstall the plugin.',
    ])
  })

  test("registers every loaded skill", async () => {
    const added: string[] = []
    await registerSkills(
      { transform: async (callback) => (callback({ add: (skill: { id: string }) => void added.push(skill.id) } as never), { dispose: async () => {} }) },
      [parseSkill("metaview", "/x", "---\nname: metaview\ndescription: d\n---\n")],
    )
    expect(added).toEqual(["metaview"])
  })
})
