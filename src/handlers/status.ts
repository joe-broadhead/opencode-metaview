/**
 * `status`: what a person and an app read before anything else. It carries no content and no credential.
 *
 * `statusAnswer` from the contract assembles the whole answer: the manifest's name and host range, the installed
 * version, the running host, one entry per alias, the account problems setup recorded and what the call's
 * `unguardedAgents()` answered. A failed agent list is one more problem inside `statusAnswer`, so this handler has no
 * try/catch and keeps no state between `register` and the call.
 */
import { accountStatuses, redactReason, STATUS_SCHEMA, statusAnswer, type AccountSignal } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { manifest } from "../manifest.ts"
import { EMPTY } from "./shared.ts"
import type { HandlerRuntime } from "./index.ts"

/** The code of a refusal, without importing the class at run time. */
function codeOf(error: unknown): string | undefined {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
  return typeof code === "string" ? code : undefined
}

function reasonOf(error: unknown): string {
  return redactReason(error instanceof Error ? error.message : String(error))
}

/** `status`: the plugin's identity, host, state, one entry per alias, unguarded agents and a next step. */
export function statusHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description: "Read the plugin's version, OpenCode host, account states and any next step. It reads no conversation.",
    input: EMPTY,
    output: STATUS_SCHEMA,
    async run(_input, call) {
      const signals: Record<string, AccountSignal> = {}
      for (const account of runtime.accounts) {
        try {
          const identity = await runtime.provider.identity(account.alias, call)
          signals[account.alias] = { state: "ready", owner: identity.owner }
        } catch (error) {
          signals[account.alias] = codeOf(error) === "NEEDS_SIGN_IN" ? { state: "needs_sign_in" } : { state: "error", reason: reasonOf(error) }
        }
      }
      return statusAnswer({
        manifest,
        version: runtime.version,
        hostVersion: runtime.hostVersion,
        accounts: accountStatuses(runtime.accounts, signals),
        problems: [...runtime.problems],
        unguardedAgents: await call.unguardedAgents(),
      })
    },
  }
}
