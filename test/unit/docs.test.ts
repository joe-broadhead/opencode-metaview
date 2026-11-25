import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { test } from "node:test"
import { version } from "../../src/manifest.ts"

const root = new URL("../../", import.meta.url)

function read(path: string): string {
  return readFileSync(new URL(path, root), "utf8")
}

function markdown(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(new URL(directory, root), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) found.push(...markdown(path))
    else if (entry.name.endsWith(".md")) found.push(path)
  }
  return found
}

const guides = ["README.md", "CONTRIBUTING.md", ...markdown("docs")]

/** Every install spec a guide names, with its ref (or `undefined` when it is untagged). */
function installSpecs(text: string): (string | undefined)[] {
  return [...text.matchAll(/github:we-the-rebel-alliance\/metaview-plugin(#[A-Za-z0-9.<>_-]+)?/g)].map((match) => match[1])
}

test("every install line names a versioned tag, never a ref that is only #v or untagged", () => {
  let installs = 0
  for (const file of guides) {
    for (const ref of installSpecs(read(file))) {
      installs++
      assert.ok(ref !== undefined, `${file}: an install spec is untagged`)
      assert.ok(ref === "#v<version>" || /^#v\d+\.\d+\.\d+$/.test(ref), `${file}: ${ref} is not #v<version> or a full release tag`)
    }
  }
  assert.ok(installs > 0, "no guide names an install spec")
  assert.ok(installSpecs(read("README.md")).length > 0, "README.md names no install spec")
})

test("the README states the tested OpenCode range and the tested release", () => {
  const readme = read("README.md")
  assert.ok(readme.includes(">=2.4.1 <2.5.0"))
  assert.ok(readme.includes("tested on 2.4.1"))
})

test("the changelog carries the 0.0.0 section, and the package version is 0.0.0", () => {
  const changelog = read("CHANGELOG.md")
  assert.match(changelog, /^## 0\.0\.0 \(unreleased\)$/m)
  assert.equal(version, "0.0.0")
})

test("a guide does not link a repository path on the main branch", () => {
  for (const file of guides) {
    const text = read(file)
    assert.ok(!/blob\/main|tree\/main|raw\/main/.test(text), `${file}: a link names the main branch`)
  }
})

test("docs/ exists with every file the standard names", () => {
  for (const file of ["capabilities", "configuration", "accounts", "automations", "architecture", "security"]) {
    assert.ok(
      readdirSync(new URL("docs/", root)).includes(`${file}.md`),
      `docs/${file}.md is missing`,
    )
  }
})

test("the skill directory names only the plugin's own skills", () => {
  const skills = readdirSync(new URL("skills/", root))
  assert.deepEqual(skills.sort(), ["metaview", "metaview-candidate-brief", "metaview-write"])
})
