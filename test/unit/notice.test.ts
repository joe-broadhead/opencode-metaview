// The release tarball ships NOTICE next to a bundle that inlines third-party code. This test builds the server entry
// with the same options as scripts/build.mjs, collects every package that actually ends up in the bundle (including a
// package inlined by a bundled dist, such as zod inside plugin-contract), and requires each one's heading and verbatim
// licence text in NOTICE.
import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { build } from "esbuild"

const root = fileURLToPath(new URL("../../", import.meta.url))
const HOST = ["@opencode/*"]
const PLUGIN = "@we-the-rebel-alliance/metaview-plugin"
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string }

/** A package name from an esbuild input path, or undefined for the plugin's own sources. */
function packageOf(path: string): string | undefined {
  const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path)
  return match?.[1]
}

function keep(name: string | undefined): name is string {
  return name !== undefined && name !== PLUGIN && !name.startsWith("@opencode/") && !name.startsWith(".")
}

function section(name: string): RegExp {
  return new RegExp(`^## ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`, "m")
}

/** The packages a NOTICE does not name, in the order they were found. */
export function missingNoticeSections(notice: string, packages: readonly string[]): string[] {
  return packages.filter((name) => !section(name).test(notice))
}

/** A package's licence text, trimmed exactly as the NOTICE writes it. */
export function licenseText(name: string): string {
  const directory = join(root, "node_modules", name)
  const file = readdirSync(directory).find((entry) => /^(licen[cs]e|copying)(\.|$)/i.test(entry))
  if (file === undefined) throw new Error(`${name} ships no licence file`)
  return readFileSync(join(directory, file), "utf8").trim()
}

/** Every package this bundle actually inlines, including packages inlined by a bundled dist. */
export async function bundledPackages(): Promise<string[]> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [{ in: join(root, "src", "index.ts"), out: "index" }],
    outdir: "dist",
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    external: HOST,
    legalComments: "none",
    write: false,
    metafile: true,
    logLevel: "silent",
    banner: { js: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n// ${pkg.name} ${pkg.version}. Built by scripts/build.mjs; do not edit.` },
  })
  const found = new Set<string>()
  const inputs = Object.keys(result.metafile.inputs)
  for (const path of inputs) {
    const name = packageOf(path)
    if (keep(name)) found.add(name)
  }
  // A bundled dist can inline its own dependencies; plugin-contract's chunks carry the original module path in a
  // comment (`// node_modules/zod/v4/...`). Those packages are redistributed by this bundle too.
  for (const path of inputs) {
    if (!path.startsWith("node_modules/")) continue
    const text = readFileSync(join(root, path), "utf8")
    for (const match of text.matchAll(/\/\/\s*node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//g)) {
      const name = match[1]
      if (keep(name) && existsSync(join(root, "node_modules", name, "package.json"))) found.add(name)
    }
  }
  return [...found].sort()
}

test("every bundled package has its heading and verbatim licence in NOTICE", async () => {
  const packages = await bundledPackages()
  assert.ok(packages.includes("yaml"))
  assert.ok(packages.includes("zod"))
  const notice = readFileSync(join(root, "NOTICE"), "utf8")
  assert.deepEqual(missingNoticeSections(notice, packages), [])
  for (const name of packages) {
    const meta = JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")) as {
      version: string
      license: string
    }
    assert.ok(
      notice.includes(`## ${name} ${meta.version} (${meta.license})`),
      `${name} has no "## ${name} ${meta.version} (${meta.license})" heading`,
    )
    assert.ok(notice.includes(licenseText(name)), `${name}'s licence text is not in NOTICE`)
  }
})

test("a missing section is reported", () => {
  const notice = readFileSync(join(root, "NOTICE"), "utf8")
  const withoutYaml = notice.replace(/^## yaml[\s\S]*?(?=^## |\s*$)/m, "")
  assert.deepEqual(missingNoticeSections(withoutYaml, ["yaml"]), ["yaml"])
})
