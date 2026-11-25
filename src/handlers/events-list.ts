/**
 * `events_list`: the conversations source's one read (contract §7). The input, its normalisation and the page come from
 * the contract's `events` module; this handler validates what only the plugin knows (the source) and asks the provider.
 */
import { EVENTS_LIST_INPUT_SCHEMA, PAGE_SCHEMA, parseEventsListInput } from "@we-the-rebel-alliance/plugin-contract/events"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { SCOPE_KEYS, SOURCE } from "../provider/client.ts"
import { refuseInput, refuseSource } from "./shared.ts"
import type { HandlerRuntime } from "./index.ts"

/** `events_list`: one account's conversations as meetings, oldest first, with a cursor bound to the account and scope. */
export function eventsListHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description:
      "List one account's Metaview conversations as meeting events, oldest first. Metadata only: start, candidate and interviewers by name and id, and a link. Pass the cursor a page returned to read what follows it.",
    input: EVENTS_LIST_INPUT_SCHEMA,
    output: PAGE_SCHEMA,
    async run(input, call) {
      const parsed = parseEventsListInput(input, { scopeKeys: [...SCOPE_KEYS] })
      if (!parsed.ok) refuseInput(parsed.problems)
      if (parsed.value.source !== undefined && parsed.value.source !== SOURCE) refuseSource(runtime.plugin, parsed.value.source)
      return runtime.provider.page({ account: call.account, request: parsed.value, now: runtime.clock(), call })
    },
  }
}
