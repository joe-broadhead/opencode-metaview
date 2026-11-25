/** The handlers, driven through their real entry, with the fake Metaview server and a fixed clock. */
import { accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Bus } from "@we-the-rebel-alliance/plugin-contract/bus"
import type { MethodCall } from "@we-the-rebel-alliance/plugin-contract/register"
import { manifest, packageName, version } from "../../src/manifest.ts"
import { handlersFor, type HandlerRuntime } from "../../src/handlers/index.ts"
import { createProvider, type ProviderCall, type ProviderHost } from "../../src/provider/client.ts"
import { fakeHost, NOW, type FakeOptions } from "./fake-metaview.ts"

export { NOW }

/** The options the fixture and the T1 host use: two aliases. */
const OPTIONS = { accounts: { work: {}, personal: {} } } as const

const BUS: Bus = { name: "metaview", emit: async () => ({ ok: true }) }

/** A runtime with the real manifest, the fake provider and a fixed clock. */
export function runtimeFor(options: Readonly<Record<string, unknown>> = OPTIONS, host: ProviderHost = fakeHost(), overrides: Partial<HandlerRuntime> = {}): HandlerRuntime {
  const plan = accountsOf(manifest, options)
  if (!plan.ok) throw new Error(plan.problems.join("; "))
  return {
    plugin: manifest.plugin.name,
    version,
    hostVersion: "2.4.1",
    accounts: plan.value.accounts,
    problems: [],
    provider: createProvider(host, { plugin: manifest.plugin.name, package: packageName }),
    clock: () => NOW,
    ...overrides,
  }
}

/** A runtime whose fake server answers the given `FakeOptions`. */
export function runtimeWith(hostOptions: FakeOptions, options: Readonly<Record<string, unknown>> = OPTIONS, overrides: Partial<HandlerRuntime> = {}): HandlerRuntime {
  return runtimeFor(options, fakeHost(hostOptions), overrides)
}

/** The call context a handler sees, as `register` builds it. */
function callFor(account: string, overrides: Partial<MethodCall> = {}): MethodCall {
  return {
    sessionID: "ses_test",
    agent: "build",
    messageID: "msg_test",
    id: "call_test",
    signal: new AbortController().signal,
    progress: async () => undefined,
    account,
    door: "tool",
    bus: BUS,
    unguardedAgents: async () => ({ ok: true, agents: [] }),
    ...overrides,
  }
}

/** A caller for the provider's own tests, with the same fields a handler passes. */
export function providerCall(): ProviderCall {
  const call = callFor("work")
  return {
    sessionID: call.sessionID,
    agent: call.agent,
    messageID: call.messageID,
    id: call.id,
    signal: call.signal,
    progress: call.progress,
  }
}

/** Run one handler with an account and the input `register` would pass. */
export async function run(runtime: HandlerRuntime, method: "status" | "probe" | "events_list", input: Readonly<Record<string, unknown>>, account = "work", call: Partial<MethodCall> = {}): Promise<unknown> {
  const handler = handlersFor(runtime)[method]
  if (handler === undefined) throw new Error(`the handler table has no ${method} handler`)
  return handler.run(input, callFor(account, call))
}
