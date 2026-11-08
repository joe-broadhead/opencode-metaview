// The drift script against saved tool lists: the recorded live list (OpenCode's form), the research form, and edited
// copies. It reads files only.
import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DESTRUCTIVE_TOOLS, PARAMETERS, READ_TOOLS, WRITE_TOOLS } from "../../src/metaview-tools.js"

const SCRIPT = fileURLToPath(new URL("../../scripts/check-metaview-tools.mjs", import.meta.url))
const FIXTURE = fileURLToPath(new URL("./metaview-live-tools.json", import.meta.url))
const dir = mkdtempSync(join(tmpdir(), "metaview-drift-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

type LiveTool = { id: string; name: string; description?: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }
const live = () => (JSON.parse(readFileSync(FIXTURE, "utf8")) as { tools: LiveTool[] }).tools
const ALL = [...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]
/** One tool in the research form, from the recorded parameters. */
const research = (name: string) => ({ name, annotations: { readOnlyHint: READ_TOOLS.includes(name), destructiveHint: false }, inputs: [...PARAMETERS[name]!] })

let files = 0
function drift(list: unknown, ...args: string[]) {
  const file = join(dir, `tools-${++files}.json`)
  writeFileSync(file, JSON.stringify(list))
  const result = spawnSync("node", [SCRIPT, file, ...args], { encoding: "utf8" })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

describe("npm run drift", () => {
  test("PARAMETERS records every known tool, each with its required rationale", () => {
    expect(Object.keys(PARAMETERS).sort()).toEqual([...ALL].sort())
    for (const name of ALL) expect(PARAMETERS[name]).toContain("rationale*:string")
  })

  test("the recorded live list matches the tool lists and PARAMETERS exactly: names, required parameters and types", () => {
    const tools = live()
    expect(tools.map((tool) => tool.name).sort()).toEqual([...ALL].sort())
    const { code, out } = drift({ tools }, "--strict")
    expect([code, out.trim().split("\n").at(-1)]).toEqual([0, "No drift."])
  })

  test("the research form of the same list shows no drift either", () => {
    expect(drift({ tools: ALL.map(research) }, "--strict")).toMatchObject({ code: 0, out: expect.stringContaining("No drift.") })
  })

  test("reports added, renamed and changed parameters, and treats removed tools as information", () => {
    const tools = live().filter((tool) => tool.name !== "list_mailboxes")
    const snippets = tools.find((tool) => tool.name === "search_snippets")!
    snippets.name = "find_moments"
    snippets.id = "metaview_find_moments"
    const search = tools.find((tool) => tool.name === "search_conversations")!
    delete search.inputSchema.properties.conversation_ids
    search.inputSchema.properties.window = { type: "object" }
    search.inputSchema.properties.limit = { type: "string" }
    search.inputSchema.required = [...(search.inputSchema.required ?? []), "window"]
    const { code, out } = drift({ tools }, "--strict")
    expect(code).toBe(1)
    expect(out).toContain("Added: listed by Metaview, in no list of src/metaview-tools.ts:\n  find_moments")
    expect(out).toContain("Removed: in src/metaview-tools.ts, not in this list")
    expect(out).toContain("  list_mailboxes")
    expect(out).toContain("Possibly renamed: a removed tool and an added one take mostly the same parameters:\n  search_snippets -> find_moments")
    expect(out).toContain("  search_conversations: +window*:object -conversation_ids limit (integer -> string)")
  })

  test("a nullable or array type that changes is drift too", () => {
    const tools = live()
    const fields = tools.find((tool) => tool.name === "search_conversations")!.inputSchema.properties as Record<string, unknown>
    fields.filters = { type: "string" }
    expect(drift({ tools }).out).toContain("  search_conversations: filters (array<object>|null -> string)")
  })

  test("a read whose description says it changes or sends something is flagged; nouns, enums and other tools are not", () => {
    const describe = (name: string, description: string) => ({ ...live().find((tool) => tool.name === name)!, description })
    const quiet = [
      describe("get_job_post", "<usecase>Read a Job Post's creator, document and check results.</usecase>\nJob Posts are collaboratively drafted job descriptions."),
      describe("list_application_reviews", "- DECISION: PROGRESSED / REJECTED; applicants from the ATS, or UPLOAD."),
      describe("get_screen_details", "Outreach as candidates receive it; change it with update_screen_outreach."),
      describe("group_conversations", "1. Create an AI field (create_ai_field) extracting the data point."),
      describe("list_mailboxes", "List the email mailboxes you can send sequence emails from."),
      describe("list_screens", "- Writes: update_screen_plan and update_screen_outreach only; all else read-only."),
    ]
    const loud = [
      describe("list_sequences", "Sends a test email to every enrolled candidate."),
      describe("search_reports", "<usecase>This tool creates a report from the search.</usecase>"),
    ]
    const others = live().filter((tool) => ![...quiet, ...loud].some((item) => item.name === tool.name))
    const { out } = drift({ tools: [...others, ...quiet, ...loud] })
    expect(out).toContain("  list_sequences  (Sends)")
    expect(out).toContain("  search_reports  (creates)")
    for (const tool of quiet) expect(out).not.toContain(`  ${tool.name}  (`)
  })

  test("a list from an MCP client with annotations shows a read that became a write", () => {
    const tools = ALL.map(research)
    tools.find((tool) => tool.name === "fetch_candidates")!.annotations = { readOnlyHint: false, destructiveHint: false }
    const { code, out } = drift({ tools })
    expect(code).toBe(0)
    expect(out).toContain("Reclassified: the lists disagree with Metaview's annotations:\n  fetch_candidates  readOnlyHint=false destructiveHint=false")
  })

  test("a removed tool alone is not drift: an account lists only its products' tools", () => {
    const { code, out } = drift({ tools: READ_TOOLS.map(research) }, "--strict")
    expect(code).toBe(0)
    expect(out).toContain("No drift apart from the removed tools above.")
  })

  test("refuses a file that is not a tool list, and a missing argument, with exit code 2", () => {
    expect(drift({ servers: [] }).code).toBe(2)
    const none = spawnSync("node", [SCRIPT], { encoding: "utf8" })
    expect(none.status).toBe(2)
    expect(none.stderr).toContain("no tool list given")
  })
})
