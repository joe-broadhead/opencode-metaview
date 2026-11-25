import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { loadSkills, parseSkill, registerSkills, SkillLoadError } from "../src/skills.ts"

test("the loader reads every skill directory with a valid frontmatter", async () => {
  const loaded = await loadSkills()
  const names = ["metaview", "metaview-candidate-brief", "metaview-write"]
  assert.deepEqual(
    loaded.skills.map((skill) => skill.id).sort(),
    names,
  )
  assert.deepEqual(loaded.problems, [])
  for (const skill of loaded.skills) {
    const description = skill.description ?? ""
    assert.ok(description.length <= 300, `${skill.id} description is ${description.length} characters`)
    assert.ok(skill.path.endsWith(join("skills", skill.id, "SKILL.md")))
    assert.ok(skill.content.length > 0)
  }
})

test("registerSkills adds every loaded skill", async () => {
  const loaded = await loadSkills()
  const added: string[] = []
  const registration = await registerSkills(
    {
      transform: async (callback: (editor: { add(skill: { id: string }): void }) => void) => {
        callback({ add: (skill) => added.push(skill.id) })
        return { dispose: async () => undefined }
      },
    } as never,
    loaded.skills,
  )
  await registration.dispose()
  assert.deepEqual(added, ["metaview", "metaview-candidate-brief", "metaview-write"])
})

test("a broken skill is a problem, not a thrown setup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "metaview-skills-"))
  try {
    mkdirSync(join(directory, "broken"))
    writeFileSync(join(directory, "broken", "SKILL.md"), "---\nname: other\ndescription: nope\n---\nbody\n")
    const loaded = await loadSkills(directory)
    assert.deepEqual(loaded.skills, [])
    assert.equal(loaded.problems.length, 1)
    const problem = loaded.problems[0]
    assert.ok(problem !== undefined)
    assert.match(problem, /^SKILLS_INVALID: /)
    assert.match(problem, /Next step: /)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("parseSkill refuses a missing description", () => {
  assert.throws(() => parseSkill("x", "/x/SKILL.md", "---\nname: x\n---\nbody\n"), (error: unknown) => error instanceof SkillLoadError && error.code === "SKILLS_INVALID")
})
