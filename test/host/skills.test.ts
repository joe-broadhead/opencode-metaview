import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { join, sep } from "node:path"
import { test } from "node:test"
import { pathToFileURL, fileURLToPath } from "node:url"
import { OpenCode } from "@opencode/sdk"
import { createHost, waitForActivation } from "@we-the-rebel-alliance/plugin-contract/kit"

/** The repository root, and the skill directories the loader must register. */
const root = fileURLToPath(new URL("../..", import.meta.url))
const skillsDir = join(root, "skills")
const expected = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

interface Host {
  readonly sessions: {
    create(input: { location: { directory: string }; agent: string; permissions: readonly unknown[] }): Promise<{ id: string }>
    prompt(input: { sessionID: string; text: string; delivery: string }): Promise<unknown>
  }
  readonly plugin: { list(input: { location: { directory: string } }): Promise<{ data: readonly { id?: string }[] }> }
  readonly skill: { list(input: { location: { directory: string } }): Promise<{ data: readonly { id: string; path: string }[] }> }
  readonly command: { list(input: { location: { directory: string } }): Promise<{ data: readonly { name: string }[] }> }
  readonly agent: { list(input: { location: { directory: string } }): Promise<{ data: readonly { id: string }[] }> }
  readonly mcp: { list(input: { location: { directory: string } }): Promise<{ data: readonly { name: string }[] }> }
  close(): Promise<void>
}

test("every skills/*/SKILL.md is registered on the real OpenCode 2.4.1 host", { timeout: 120_000 }, async () => {
  const module = (await import(pathToFileURL(join(root, "dist", "index.js")).href)) as { default: unknown }
  const host = (await OpenCode.create({
    plugins: [module.default],
    config: { directory: root },
    app: { name: "opencode", version: "2.4.1" },
    log: { level: "error", emit: () => undefined },
  })) as unknown as Host
  try {
    const session = await host.sessions.create({ location: { directory: root }, agent: "build", permissions: [] })
    await host.sessions.prompt({ sessionID: session.id, text: "activate the plugin", delivery: "queue" }).catch(() => undefined)
    await waitForActivation({
      isActive: async () => (await host.plugin.list({ location: { directory: root } })).data.some((plugin) => plugin.id === "metaview"),
      timeoutMs: 60_000,
    })
    const listed = await host.skill.list({ location: { directory: root } })
    const ours = listed.data
      .filter((skill) => skill.path.startsWith(`${skillsDir}${sep}`))
      .map((skill) => skill.id)
      .sort()
    assert.deepEqual(ours, expected)

    const commands = await host.command.list({ location: { directory: root } })
    assert.ok(!commands.data.some((command) => command.name === "metaview" || command.name === "metaview-status"), "the old slash commands are not restored")
    const agents = await host.agent.list({ location: { directory: root } })
    for (const id of ["build", "general", "explore", "compaction", "title", "summary", "plan"]) {
      assert.ok(agents.data.some((agent) => agent.id === id), `${id} is still registered`)
    }
    const servers = await host.mcp.list({ location: { directory: root } })
    assert.ok(servers.data.some((server) => server.name === "metaview"), "the default Metaview MCP server is registered")
  } finally {
    await host.close()
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
