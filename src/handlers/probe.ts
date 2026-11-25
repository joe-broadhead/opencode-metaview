/** `probe`: whose an account is. It reads the account, never any conversation. */
import { parseProbeInput, PROBE_SCHEMA } from "@we-the-rebel-alliance/plugin-contract/events"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { SOURCE } from "../provider/client.ts"
import { refuseInput, refuseSource } from "./shared.ts"
import type { HandlerRuntime } from "./index.ts"

/** `probe`: the owner and the account's sign-in for one alias, without reading any conversation. */
export function probeHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description: "Read the signed-in Metaview owner for one account. Use it to tell accounts apart; it reads no conversation.",
    input: {
      type: "object",
      properties: { source: { type: "string", description: "The source to probe; only conversations." } },
      additionalProperties: false,
    },
    output: PROBE_SCHEMA,
    async run(input, call) {
      const parsed = parseProbeInput(input)
      if (!parsed.ok) refuseInput(parsed.problems)
      const source = parsed.value.source ?? SOURCE
      if (source !== SOURCE) refuseSource(runtime.plugin, source)
      return runtime.provider.probe(call.account, call)
    },
  }
}
