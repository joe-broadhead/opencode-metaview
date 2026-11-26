// The packed tarball: exactly the files whitelist, an install with scripts disabled, and the server entry it exports.
//
// `opencode plugin add` 2.4.1 accepts a registry or Git specifier only, not a local path, so this test installs the
// tarball with npm and loads the installed entry. `plugin-kit check`'s T1 starts the same bundle in the real host.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { after, test } from "node:test"

const root = realpathSync(fileURLToPath(new URL("../..", import.meta.url)))
const work = mkdtempSync(join(realpathSync("/tmp"), "metaview-pack-"))
after(() => rmSync(work, { recursive: true, force: true }))

interface Packed {
  readonly filename: string
  readonly files: readonly { readonly path: string }[]
}

const run = (command: string, args: readonly string[], cwd: string): string =>
  execFileSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" } })

let cached: Packed | undefined
function pack(): Packed {
  if (cached !== undefined) return cached
  run("npm", ["run", "bundle"], root)
  const [first] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], root)) as Packed[]
  if (first === undefined) throw new Error("npm pack answered no tarball")
  cached = first
  return first
}

test("the tarball lists exactly the files whitelist, with no source, fixture or contract copy", { timeout: 120_000 }, () => {
  const paths = pack()
    .files.map((file) => file.path)
    .sort()
  const expected = [
    "LICENSE",
    "NOTICE",
    "README.md",
    "assets/icon-128.png",
    "assets/icon-256.png",
    "assets/icon.svg",
    "dist/index.js",
    "package.json",
    "skills/metaview-candidate-brief/SKILL.md",
    "skills/metaview-write/SKILL.md",
    "skills/metaview/SKILL.md",
  ].sort()
  assert.deepEqual(paths, expected)
  assert.ok(paths.every((path) => !path.endsWith(".ts") && !path.endsWith(".d.ts") && !path.includes("node_modules/")))
})

test("the installed tarball exports the plugin's one server entry", { timeout: 300_000 }, async () => {
  const project = join(work, "project")
  mkdirSync(project)
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "metaview-pack-project", private: true, type: "module" }))
  run("npm", ["install", join(work, pack().filename), "@opencode/plugin@2.4.1", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], project)
  const installed = join(project, "node_modules", "@we-the-rebel-alliance", "metaview-plugin")
  const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as { version?: unknown; dependencies?: unknown; capabilities?: { plugin?: { name?: unknown } } }
  assert.equal(pkg.version, "0.0.0")
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.capabilities?.plugin?.name, "metaview")
  const entry = (await import(pathToFileURL(join(installed, "dist", "index.js")).href)) as { default?: { id?: unknown; setup?: unknown } }
  assert.equal(entry.default?.id, "metaview")
  assert.equal(typeof entry.default?.setup, "function")
})
