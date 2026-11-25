/**
 * The plugin's one entry: `Plugin.define({ id, setup })`, the host gate, the accounts, and one `register` call.
 *
 * `register` wires doors 1–3 from `handlers`, resolves accounts, generates the access rules and builds the bus writer
 * from the manifest's declared events. This file never calls `ctx.tool`, `ctx.rpc` or `ctx.permission` itself.
 */
import { Plugin } from "@opencode/plugin"
import { accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { findSource, maxBytesOf } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { registerMcpAccounts } from "./accounts.ts"
import { handlersFor } from "./handlers/index.ts"
import { manifest, packageName, version } from "./manifest.ts"
import { createProvider, SOURCE_ID } from "./provider/client.ts"
import { loadSkills, registerSkills } from "./skills.ts"

export default Plugin.define({
  id: manifest.plugin.name,
  async setup(context) {
    assertHost(context, manifest)

    const options = context.options ?? {}
    const plan = accountsOf(manifest, options)
    if (!plan.ok) throw new Error(`OPTIONS_INVALID: ${plan.problems.join("; ")}. Next step: fix the plugin's accounts option.`)

    const conversations = findSource(manifest, SOURCE_ID)
    if (conversations === undefined) throw new Error(`OPTIONS_INVALID: the manifest declares no ${SOURCE_ID} source. Next step: add the conversations source to capabilities.sources.`)

    // The vendor's MCP server holds the credentials: one server per alias, named metaview or metaview-<alias>.
    const accounts = await registerMcpAccounts(context, manifest, options)
    const skills = await loadSkills()
    const skillRegistration = await registerSkills(context.skill, skills.skills)

    const handlers = handlersFor({
      plugin: manifest.plugin.name,
      version,
      hostVersion: context.app.version,
      accounts: plan.value.accounts,
      problems: [...accounts.problems, ...skills.problems],
      provider: createProvider({ tool: context.tool, mcp: context.mcp }, { plugin: manifest.plugin.name, package: packageName, maxBytes: maxBytesOf(conversations) }),
      clock: Date.now,
    })

    const registration = await register(context, manifest, handlers)
    return async () => {
      await registration.dispose()
      await skillRegistration.dispose().catch(() => undefined)
    }
  },
})
