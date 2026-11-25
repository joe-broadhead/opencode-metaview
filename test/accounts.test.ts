import assert from "node:assert/strict"
import { test } from "node:test"
import { manifest } from "../src/manifest.ts"
import { registerMcpAccounts, type AccountsContext } from "../src/accounts.ts"

/** A context with the two transforms, capturing the MCP servers a plugin registers. */
function context() {
  const servers = new Map<string, Record<string, unknown>>()
  const fake = {
    integration: {
      transform: async () => {
        throw new Error("the mcp mechanism must not touch the integration transform")
      },
    },
    mcp: {
      transform: async (callback: (editor: { set(name: string, config: Record<string, unknown>): void }) => void) => {
        callback({ set: (name, config) => void servers.set(name, config) })
        return { dispose: async () => undefined }
      },
    },
  } as unknown as AccountsContext
  return { fake, servers }
}

test("the mcp mechanism registers one Metaview server per alias, named for the account", async () => {
  const { fake, servers } = context()
  const registration = await registerMcpAccounts(fake, manifest, { accounts: { work: {}, personal: {} } })
  assert.equal(registration.mechanism, "mcp")
  assert.deepEqual(registration.accounts.map((account) => account.name), ["metaview-work", "metaview-personal"])
  assert.deepEqual(servers.get("metaview-work"), { type: "remote", url: "https://mcp.metaview.ai/mcp", oauth: {} })
  assert.deepEqual(servers.get("metaview-personal"), { type: "remote", url: "https://mcp.metaview.ai/mcp", oauth: {} })
  assert.deepEqual(registration.problems, [])
})

test("with no accounts option the plugin has one default server", async () => {
  const { fake, servers } = context()
  const registration = await registerMcpAccounts(fake, manifest, {})
  assert.deepEqual(registration.accounts.map((account) => account.name), ["metaview"])
  assert.deepEqual(servers.get("metaview"), { type: "remote", url: "https://mcp.metaview.ai/mcp", oauth: {} })
})

test("a bad alias is reported and registers no server", async () => {
  const { fake, servers } = context()
  const registration = await registerMcpAccounts(fake, manifest, { accounts: { Work: {} } })
  assert.ok(registration.problems.length > 0)
  assert.equal(servers.size, 0)
})
