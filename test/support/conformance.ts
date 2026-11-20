// source-contract's conformance kit, run over this plugin's own events_list and probe for the one source package.json
// declares (metaview.conversations), against the synthetic Metaview (test/support/synthetic-metaview.ts and
// test/fixtures/conformance.json). No live call is made. Each read runs in the kit's recording permission: the
// plugin's own asserts go to it, and so does every Metaview tool the fake executor runs (`metaview_<tool>`, as OpenCode's
// executor asserts it), so declared must equal asserted. `npm run conformance` writes the report
// (reports/conformance-report.json); test/unit/sources.test.ts asserts it.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { sourceConformance, type ConformanceReport, type PageCase, type SessionContext, type ToolDeclaration } from "@we-the-rebel-alliance/source-contract/conformance"
import { encodeBoundCursor, encodeCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { readInstalledDescriptor, type InstalledDescriptor } from "@we-the-rebel-alliance/source-contract/descriptor"
import { SOURCES_SCHEMA, type Sources } from "@we-the-rebel-alliance/source-contract/schema"
import type { ToolCall } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { PACKAGE, SOURCE, SOURCE_ID, eventsMethod, probeMethod, signIns } from "../../src/events/index.js"
import { METHODS, TOOLS_RPC_ID } from "../../src/tools-rpc.js"
import { ACCOUNT, NOW, ROOT, SINCE, cursorAt, syntheticContext } from "./synthetic-metaview.js"

export { ROOT }

/**
 * Why no single conversation can fail on its own, for the kit's `failed-holds-cursor` check: search_conversations
 * answers each page of conversations in one call, and a failed read fails the whole events_list call.
 */
export const ATOMIC =
  "search_conversations answers each page of conversations in one call: a conversation is listed whole or the call fails, and events_list fails with it, " +
  "so no single conversation can fail on its own"

export const call = (): ToolCall => ({ sessionID: "ses_conformance", agent: "build", messageID: "msg_script", id: "script:conformance", signal: new AbortController().signal, progress: async () => {} })

const open: SessionContext = { account: ACCOUNT, permission: { assert: async () => {} } }
// The kit's one process for its run: its probe records who is signed in for the session, and the page cases that follow
// reuse it, as a listing in a probed session does. A run of its own starts from nothing.
const memo = signIns()
/** A new process: the kit's probe is the first identity read again. */
export const fresh = () => memo.forget()
const contextOf = (session: SessionContext) => syntheticContext((input) => session.permission.assert(input as never))

/** events_list, as the tools RPC runs it, in a session. */
export const list = (input: Readonly<Record<string, unknown>>, session: SessionContext = open) =>
  eventsMethod(contextOf(session), () => NOW, memo).run(input, call()) as Promise<Record<string, any>>

/** probe, as the tools RPC runs it, in a session. */
export const probe = (input: Readonly<Record<string, unknown>>, session: SessionContext = open) => probeMethod(contextOf(session), memo).run(input, call()) as Promise<Record<string, any>>

/** The plugin's tools RPC methods, as describe lists them: the tools a source may name, each read-only or not. */
export function declaredTools(): ToolDeclaration[] {
  const methods = [...METHODS, eventsMethod(contextOf(open), undefined, memo), probeMethod(contextOf(open), memo)]
  return methods.map((method) => ({ id: method.name, readOnly: method.class === "read" }))
}

/** The repository's package.json, read as a consumer reads an installed plugin: checked, then hashed. */
export function installed(): InstalledDescriptor {
  const checked = readInstalledDescriptor(ROOT)
  if (!checked.ok) throw new Error(`package.json's sources: ${checked.problems.join("; ")}`)
  return checked.value
}

/** package.json's sources, as Memory's schema parses them for the kit. */
export function declaredSources(): Sources {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { sources: unknown }
  const checked = SOURCES_SCHEMA.check(pkg.sources)
  if (!checked.ok) throw new Error(`package.json's sources: ${checked.problems.join("; ")}`)
  return checked.value
}

/** The kit's cases: paging, an empty page, refusals of another account, cursor and source. */
async function cases(): Promise<PageCase[]> {
  const first = (await list({ account: ACCOUNT, since: SINCE, limit: 2 }))["cursor"] as string
  const done = (await list({ account: ACCOUNT, since: SINCE, limit: 500 }))["cursor"] as string
  const bound = (binding: { plugin: string; source: string; account: string }) => encodeBoundCursor(binding, { a: binding.account, t: Date.parse(SINCE), i: "", l: Date.parse(SINCE), n: "" })
  const old = (days: number) => cursorAt(NOW - days * 86_400_000)
  return [
    { name: "a first listing, for the account probe names, one conversation refused for a secret", input: { account: ACCOUNT, since: SINCE }, expect: "page" },
    { name: "what came after the first two", input: { account: ACCOUNT, cursor: first }, expect: "page" },
    { name: "the same, two at a time", input: { account: ACCOUNT, cursor: first, limit: 2 }, expect: "page" },
    { name: "nothing new since the last listing", input: { account: ACCOUNT, cursor: done }, expect: "empty" },
    // Metaview's retention is the organization's own and may have deleted what lies before the window.
    { name: "a cursor older than the 30 days the source vouches for answers a gap and restarts", input: { account: ACCOUNT, cursor: old(100) }, expect: "expired" },
    { name: "a first listing older than the window answers a window-truncated gap, once", input: { account: ACCOUNT, since: new Date(NOW - 100 * 86_400_000).toISOString(), limit: 2 }, expect: "page" },
    { name: "a cursor without the account it reads", input: { cursor: first }, expect: { refuses: "INPUT_INVALID" } },
    { name: "a first listing that names no account", input: { since: SINCE }, expect: { refuses: "INPUT_INVALID" } },
    { name: "a cursor passed for another account", input: { account: "4100/78", cursor: first }, expect: { refuses: "ACCOUNT_MISMATCH" } },
    { name: "another source's cursor", input: { account: ACCOUNT, cursor: bound({ plugin: "metaview", source: "ashby", account: ACCOUNT }) }, expect: { refuses: "CURSOR_INVALID" } },
    { name: "a cursor bound to another plugin", input: { account: ACCOUNT, cursor: bound({ plugin: "granola", source: SOURCE, account: ACCOUNT }) }, expect: { refuses: "CURSOR_INVALID" } },
    { name: "an unbound cursor", input: { account: ACCOUNT, cursor: encodeCursor(SOURCE, { a: ACCOUNT, t: 0, i: "" }) }, expect: { refuses: "CURSOR_INVALID" } },
    { name: "a source this plugin does not have", input: { account: ACCOUNT, source: "transcripts" }, expect: { refuses: "SOURCE_UNKNOWN" } },
  ]
}

/** The kit's report for every declared source. */
export async function conformanceReports(): Promise<ConformanceReport[]> {
  fresh()

  // Read as a consumer reads it first (the frame, checked and hashed), then as the kit reads it (Memory's schema).
  installed()
  const sources = declaredSources()
  const reports: ConformanceReport[] = []
  for (const source of sources.items) {
    if (source.id !== SOURCE_ID) throw new Error(`${source.id} is declared and the conformance run has no calls for it`)
    reports.push(
      await sourceConformance({
        plugin: PACKAGE,
        source,
        tools: declaredTools(),
        calls: { list, probe },
        cases: await cases(),
        account: ACCOUNT,
        sources: { rpc: sources.rpc, probe: sources.probe },
        describe: { id: TOOLS_RPC_ID },
        atomicPages: { reason: ATOMIC },
      }),
    )
  }
  return reports
}
