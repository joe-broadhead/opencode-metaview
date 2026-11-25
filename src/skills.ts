/**
 * The plugin's own skills, loaded and registered through OpenCode's skill domain.
 *
 * `register` in the contract wires methods, not skills, so this module reads every `skills/<id>/SKILL.md` next to the
 * package and adds each one to `ctx.skill.transform` from `setup`. A missing or broken file does not stop the plugin:
 * its line becomes a `status` problem, and the rest of the skills still load.
 */
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill, type Plugin } from "@opencode/plugin"

/** `skills/` at the package root, next to `dist/` (and next to `src/` in the repository). */
export const SKILLS_DIR = fileURLToPath(new URL("../skills/", import.meta.url))

/** A skill file the loader could not use, in the contract's `CODE: What happened. Next step: What to do.` form. */
export class SkillLoadError extends Error {
  readonly code = "SKILLS_INVALID"
  readonly what: string
  readonly next: string

  constructor(what: string, next = "Reinstall the plugin, or fix the skill's frontmatter.") {
    super(`SKILLS_INVALID: ${what}. Next step: ${next}`)
    this.name = "SkillLoadError"
    this.what = what
    this.next = next
  }
}

/** Strip one pair of quotes around a frontmatter scalar. */
function unquote(value: string): string {
  return value.replace(/^(["'])(.*)\1$/, "$2")
}

/** Parse `---` frontmatter with `name` and `description`; the body after it is the skill's content. */
export function parseSkill(id: string, path: string, text: string): Skill.Info {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"))
  if (match === null) throw new SkillLoadError(`skills/${id}/SKILL.md has no frontmatter`)
  const fields = new Map<string, string>()
  for (const line of match[1]!.split("\n")) {
    const at = line.indexOf(":")
    if (at < 0) continue
    fields.set(line.slice(0, at).trim(), unquote(line.slice(at + 1).trim()))
  }
  if (fields.get("name") !== id) throw new SkillLoadError(`skills/${id}/SKILL.md must be named "${id}" in its frontmatter`)
  const description = fields.get("description")
  if (description === undefined || description === "") throw new SkillLoadError(`skills/${id}/SKILL.md has no description`)
  return {
    id: Skill.ID.make(id),
    name: Skill.Name.make(id),
    description,
    path: Skill.Info.fields.path.make(path),
    content: match[2]!.trim(),
  }
}

/** Every skill directory under `directory`, with its problems, in name order. */
export async function loadSkills(directory = SKILLS_DIR): Promise<{ skills: Skill.Info[]; problems: string[] }> {
  const skills: Skill.Info[] = []
  const problems: string[] = []
  let names: string[] = []
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    names = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => String(entry.name))
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { skills, problems: [new SkillLoadError(`the skills directory cannot be read (${reason})`).message] }
  }
  for (const name of names) {
    const path = join(directory, name, "SKILL.md")
    try {
      skills.push(parseSkill(name, path, await readFile(path, "utf8")))
    } catch (error) {
      problems.push(error instanceof SkillLoadError ? error.message : new SkillLoadError(`skills/${name}/SKILL.md cannot be read (${error instanceof Error ? error.message : String(error)})`).message)
    }
  }
  return { skills, problems }
}

/** Add every loaded skill to OpenCode's skill editor; the caller disposes the registration on shutdown. */
export function registerSkills(skill: Pick<Plugin.Context["skill"], "transform">, skills: readonly Skill.Info[]) {
  return skill.transform((editor) => {
    for (const info of skills) editor.add(info)
  })
}
