import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { OpenCode } from "@opencode/sdk"
import type { Plugin } from "@opencode/plugin"
import { load, resolve } from "@opencode/plugin/host"
import { createHost, waitForActivation } from "@we-the-rebel-alliance/plugin-contract/kit"
import { parse as parseYaml } from "yaml"

const root = fileURLToPath(new URL("../..", import.meta.url))

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

/** The real host's domains this test reads. */
interface Host {
  readonly sessions: {
    create(input: Record<string, unknown>): Promise<{ readonly id: string }>
    prompt(input: Record<string, unknown>): Promise<unknown>
  }
  readonly plugin: {
    list(input: Record<string, unknown>): Promise<{ readonly data: readonly { readonly id?: string }[] }>
  }
  readonly skill: {
    list(input: Record<string, unknown>): Promise<{
      readonly data: readonly { readonly id: string; readonly name: string; readonly description?: string; readonly path: string; readonly content: string }[]
    }>
  }
  readonly command: { list(input: Record<string, unknown>): Promise<{ readonly data: readonly { readonly name: string }[] }> }
  readonly agent: { list(input: Record<string, unknown>): Promise<{ readonly data: readonly { readonly id: string }[] }> }
  readonly mcp: { list(input: Record<string, unknown>): Promise<{ readonly data: readonly { readonly name: string }[] }> }
  close(): Promise<void>
}

async function definitionOf() {
  const entry = resolve({ directory: root }).server
  assert.ok(entry !== undefined, "the package has no server entry")
  const module = (await load(entry)) as { readonly default?: Plugin.Plugin }
  const definition = module.default
  assert.ok(definition !== undefined, "the server entry exports no Plugin.define value")
  return definition
}

test("the real OpenCode 2.4.1 host registers every skills/<name>/SKILL.md after load", { timeout: 120_000 }, async () => {
  const definition = await definitionOf()
  const ids = readdirSync(join(root, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  assert.ok(ids.length > 0, "the package ships no skill")

  // An empty project: OpenCode discovers `<project>/skills/` itself, so using the repository root here would let the
  // test pass without `registerSkills`. The skills must come from the plugin's transform alone. The isolated HOME and
  // XDG dirs also keep a person's own skills and config out of the answer.
  const project = mkdtempSync(join(tmpdir(), "metaview-skill-project-"))
  const isolated = isolate()
  const host = (await OpenCode.create({
    plugins: [definition],
    config: { directory: project },
    app: { name: "opencode", version: "2.4.1" },
    log: { level: "error", emit: () => undefined },
  })) as unknown as Host
  try {
    const session = await host.sessions.create({ location: { directory: project }, agent: "build", permissions: [] })
    await host.sessions.prompt({ sessionID: session.id, text: "activate the skill registration", delivery: "queue" }).catch(() => undefined)
    await waitForActivation({
      isActive: async () => {
        const list = await host.plugin.list({ location: { directory: project } }).catch(() => undefined)
        return list?.data.some((entry) => entry.id === definition.id) ?? false
      },
      timeoutMs: 60_000,
    })
    const answer = await host.skill.list({ location: { directory: project } })
    for (const id of ids) {
      const skill = answer.data.find((candidate) => candidate.id === id)
      assert.ok(skill !== undefined, `the host did not register the ${id} skill`)
      assert.equal(skill.name, id)
      assert.equal(skill.path, join(root, "skills", id, "SKILL.md"))
      assert.ok(skill.content.trim().length > 0, `the ${id} skill has no body`)
      const text = readFileSync(skill.path, "utf8")
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
      assert.ok(frontmatter !== null, `the ${id} skill has no frontmatter`)
      const parsed = parseYaml(frontmatter[1] ?? "") as { readonly description?: unknown }
      assert.equal(typeof parsed.description, "string", `the ${id} skill has no YAML description`)
      const expected = parsed.description as string
      assert.notEqual(expected.trim(), "", `the ${id} skill has an empty description`)
      for (const marker of [">", "|", ">-", "|-", ">+", "|+"]) {
        assert.notEqual(expected.trim(), marker, `the ${id} skill registers the block marker ${marker}, not its text`)
      }
      assert.equal(skill.description, expected, `the ${id} skill description is not the YAML text`)
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
    const commands = await host.command.list({ location: { directory: project } })
    assert.ok(!commands.data.some((command) => command.name === "metaview" || command.name === "metaview-status"))
    const agents = await host.agent.list({ location: { directory: project } })
    for (const id of ["build", "general", "explore", "compaction", "title", "summary", "plan"]) {
      assert.ok(agents.data.some((agent) => agent.id === id), `${id} is still registered`)
    }
  } finally {
    await host.close()
    isolated.restore()
    rmSync(isolated.home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test("each account's MCP server is registered with the real OpenCode 2.4.1 host", { timeout: 120_000 }, async () => {
  const definition = await definitionOf()
  const project = mkdtempSync(join(tmpdir(), "metaview-mcp-project-"))
  const isolated = isolate()
  const options = { accounts: { work: {}, personal: {} } }
  const wrapper = {
    id: definition.id,
    setup: (context: Plugin.Context) =>
      definition.setup(
        new Proxy(context, {
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
