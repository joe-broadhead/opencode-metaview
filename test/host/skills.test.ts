import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { test } from "node:test"
import { pathToFileURL, fileURLToPath } from "node:url"
import { OpenCode } from "@opencode/sdk"
import { parse as parseYaml } from "yaml"
import { createHost, waitForActivation } from "@we-the-rebel-alliance/plugin-contract/kit"

/** The repository root, and the skill directories the loader must register. */
const root = fileURLToPath(new URL("../..", import.meta.url))
const skillsDir = join(root, "skills")

interface ExpectedSkill {
  readonly id: string
  readonly description: string
}

/** Every skill's id and the exact description a real YAML parser reads from its frontmatter. */
function expectedSkills(): ExpectedSkill[] {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const text = readFileSync(join(skillsDir, entry.name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n")
      const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
      if (match === null) throw new Error(`${entry.name} has no frontmatter`)
      const frontmatter = parseYaml(match[1] ?? "") as Record<string, unknown> | null
      const description = frontmatter?.["description"]
      if (typeof description !== "string" || description.trim() === "") throw new Error(`${entry.name} has no description`)
      if (description === ">" || description === "|") throw new Error(`${entry.name} uses a block scalar`)
      const raw = /^description:\s*(.*)$/m.exec(match[1] ?? "")?.[1]?.trim()
      if (raw === undefined || raw === ">" || raw === "|" || raw.startsWith(">") || raw.startsWith("|")) {
        throw new Error(`${entry.name}'s description is not a one-line YAML scalar`)
      }
      return { id: entry.name, description }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
}

interface Isolated {
  readonly home: string
  restore(): void
}

/** A temporary HOME and every XDG directory, so the host reads no person's config or skills. */
function isolate(): Isolated {
  const home = mkdtempSync(join(tmpdir(), "metaview-home-"))
  const keys = ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"] as const
  const previous = new Map<string, string | undefined>(keys.map((key) => [key, process.env[key]]))
  const dirs = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_STATE_HOME: join(home, "state"),
  }
  for (const [key, value] of Object.entries(dirs)) {
    process.env[key] = value
    if (key !== "HOME") mkdirSync(value, { recursive: true })
  }
  return {
    home,
    restore() {
      for (const key of keys) {
        const value = previous.get(key)
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    },
  }
}

interface Host {
  readonly sessions: {
    create(input: { location: { directory: string }; agent: string; permissions: readonly unknown[] }): Promise<{ id: string }>
    prompt(input: { sessionID: string; text: string; delivery: string }): Promise<unknown>
  }
  readonly plugin: { list(input: { location: { directory: string } }): Promise<{ data: readonly { id?: string }[] }> }
  readonly skill: { list(input: { location: { directory: string } }): Promise<{ data: readonly { id: string; path: string; description?: string }[] }> }
  readonly command: { list(input: { location: { directory: string } }): Promise<{ data: readonly { name: string }[] }> }
  readonly agent: { list(input: { location: { directory: string } }): Promise<{ data: readonly { id: string }[] }> }
  readonly mcp: { list(input: { location: { directory: string } }): Promise<{ data: readonly { name: string }[] }> }
  close(): Promise<void>
}

test("every skills/*/SKILL.md is registered on the real OpenCode 2.4.1 host", { timeout: 120_000 }, async () => {
  // An empty project, never the repository root: OpenCode discovers `<directory>/skills/` by itself, so the repo root
  // would hide a missing `registerSkills` call.
  const project = mkdtempSync(join(tmpdir(), "metaview-host-"))
  const isolated = isolate()
  const module = (await import(pathToFileURL(join(root, "dist", "index.js")).href)) as { default: unknown }
  const host = (await OpenCode.create({
    plugins: [module.default],
    config: { directory: project },
    app: { name: "opencode", version: "2.4.1" },
    log: { level: "error", emit: () => undefined },
  })) as unknown as Host
  try {
    const session = await host.sessions.create({ location: { directory: project }, agent: "build", permissions: [] })
    await host.sessions.prompt({ sessionID: session.id, text: "activate the plugin", delivery: "queue" }).catch(() => undefined)
    await waitForActivation({
      isActive: async () => (await host.plugin.list({ location: { directory: project } })).data.some((plugin) => plugin.id === "metaview"),
      timeoutMs: 60_000,
    })
    const expected = expectedSkills()
    const listed = await host.skill.list({ location: { directory: project } })
    const ours = listed.data
      .filter((skill) => skill.path.startsWith(`${skillsDir}${sep}`))
      .map((skill) => ({ id: skill.id, description: skill.description }))
      .sort((left, right) => left.id.localeCompare(right.id))
    assert.deepEqual(ours.map((skill) => skill.id), expected.map((skill) => skill.id))
    for (const skill of expected) {
      const registered = ours.find((entry) => entry.id === skill.id)
      assert.ok(registered !== undefined, `${skill.id} is registered`)
      assert.equal(registered.description, skill.description, `${skill.id} description matches its SKILL.md`)
      assert.ok(registered.description !== ">" && registered.description !== "|" && registered.description.trim() !== "")
    }

    const commands = await host.command.list({ location: { directory: project } })
    assert.ok(!commands.data.some((command) => command.name === "metaview" || command.name === "metaview-status"), "the old slash commands are not restored")
    const agents = await host.agent.list({ location: { directory: project } })
    for (const id of ["build", "general", "explore", "compaction", "title", "summary", "plan"]) {
      assert.ok(agents.data.some((agent) => agent.id === id), `${id} is still registered`)
    }
    const servers = await host.mcp.list({ location: { directory: project } })
    assert.deepEqual(
      servers.data
        .map((server) => server.name)
        .filter((name) => name === "metaview" || name.startsWith("metaview-"))
        .sort(),
      ["metaview"],
      "the default Metaview MCP server is registered",
    )
  } finally {
    await host.close()
    isolated.restore()
    rmSync(isolated.home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test("each account's MCP server is registered with the real OpenCode 2.4.1 host", { timeout: 120_000 }, async () => {
  const project = mkdtempSync(join(tmpdir(), "metaview-mcp-host-"))
  const isolated = isolate()
  const module = (await import(pathToFileURL(join(root, "dist", "index.js")).href)) as { default: unknown }
  const definition = module.default as { readonly id: string; setup(context: unknown): Promise<unknown> | unknown }
  const options = { accounts: { work: {}, personal: {} } }
  const wrapper = {
    id: definition.id,
    setup: (context: unknown) =>
      definition.setup(
        new Proxy(context as object, {
          get(target, property, receiver) {
            return property === "options" ? options : Reflect.get(target, property, receiver)
          },
        }),
      ),
  }
  const host = (await OpenCode.create({
    plugins: [wrapper],
    config: { directory: project },
    app: { name: "opencode", version: "2.4.1" },
    log: { level: "error", emit: () => undefined },
  })) as unknown as Host
  try {
    const session = await host.sessions.create({ location: { directory: project }, agent: "build", permissions: [] })
    await host.sessions.prompt({ sessionID: session.id, text: "activate the plugin", delivery: "queue" }).catch(() => undefined)
    await waitForActivation({
      isActive: async () => (await host.plugin.list({ location: { directory: project } })).data.some((plugin) => plugin.id === "metaview"),
      timeoutMs: 60_000,
    })
    const servers = await host.mcp.list({ location: { directory: project } })
    const names = servers.data
      .map((server) => server.name)
      .filter((name) => name === "metaview" || name.startsWith("metaview-"))
      .sort()
    assert.deepEqual(names, ["metaview-personal", "metaview-work"])
  } finally {
    await host.close()
    isolated.restore()
    rmSync(isolated.home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test("the real host registers the plugin's three methods and no vendor tool as its own", { timeout: 120_000 }, async () => {
  const run = await createHost({ directory: root, version: "2.4.1", pluginId: "metaview" })
  try {
    assert.deepEqual(
      run.tools.map((tool) => tool.permission).sort(),
      ["metaview.events_list", "metaview.probe", "metaview.status"],
    )
    assert.deepEqual([...(run.rpc?.methods ?? [])].sort(), ["events_list", "probe", "status"])
  } finally {
    await run.close()
  }
})
