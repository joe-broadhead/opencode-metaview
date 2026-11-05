// The shipped skills: exactly the three, loadable by the plugin, short, free of internal jargon, naming only Metaview
// tools the plugin knows, and keeping to the personal-data rules for candidate data.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DENIED_TOOLS, PARAMETERS, READ_TOOLS, WRITE_TOOLS } from "../../src/metaview-tools.js"
import { parseSkill, SKILL_NAMES, SKILLS_DIR } from "../../src/skills.js"

const NAMES = [...SKILL_NAMES]
const KNOWN = [...READ_TOOLS, ...WRITE_TOOLS, ...DENIED_TOOLS]
const MAX_LINES = 100
// Parameter names that look like tool names.
const PARAMETER_NAMES = ["group_by"]
// Words from the plugin's own process that mean nothing to the model or the user.
const JARGON = /manifest|attest|quarantin|acceptance|harness|fixture|\bfork\b|dispatch|lease|catalog|allowlist|capabilit|\bWS-[A-Z0-9]|PLAN\.md|drift|provisional|\bTODO\b|\bevals?\b/i
// Metaview's own installable skills; a user may have them, so the plugin's ids must differ.
const VENDOR_IDS = ["metaview-interview-prep", "metaview-interview-debrief", "metaview-interview-intelligence", "metaview-sourcing-copilot", "metaview-talent-research"]

const read = (name: string) => readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8")

/** The keys of an object literal's body, at its top level only: `a: 1, b, c: [{ d }]` gives a, b and c. */
function topLevelKeys(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | undefined
  let current = ""
  for (const char of body) {
    if (quote) quote = char === quote ? undefined : quote
    else if (char === '"' || char === "'") quote = char
    else if ("[{(".includes(char)) depth++
    else if ("]})".includes(char)) depth--
    else if (char === "," && depth === 0) {
      parts.push(current)
      current = ""
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map((part) => part.trim().split(":")[0]!.trim()).filter(Boolean)
}
const description = (name: string) => parseSkill(name, join(SKILLS_DIR, name, "SKILL.md"), read(name)).description ?? ""

describe("skills", () => {
  test("exactly the three skills, each a single SKILL.md, none with an id Metaview's own skills use", () => {
    expect(readdirSync(SKILLS_DIR).sort()).toEqual([...NAMES].sort())
    for (const name of NAMES) expect(readdirSync(join(SKILLS_DIR, name))).toEqual(["SKILL.md"])
    expect(NAMES.filter((name) => VENDOR_IDS.includes(name))).toEqual([])
  })

  test.each(NAMES)("%s loads, is named after its folder and has a one-line description", (name) => {
    const text = read(name)
    const skill = parseSkill(name, join(SKILLS_DIR, name, "SKILL.md"), text)
    expect(skill.name as string).toBe(name)
    expect(skill.description?.length).toBeGreaterThan(40)
    expect(text.split("\n").filter((line) => line.startsWith("description:"))).toHaveLength(1)
    expect(skill.content.length).toBeGreaterThan(0)
  })

  test.each(NAMES)("%s is under the line limit and free of internal jargon", (name) => {
    const text = read(name)
    expect(text.split("\n").length).toBeLessThan(MAX_LINES)
    expect(text.match(JARGON)?.[0]).toBeUndefined()
  })

  test.each(NAMES)("%s names only Metaview tools the plugin knows", (name) => {
    const text = read(name)
    const prefixed = [...text.matchAll(/\bmetaview_([a-z_]+)\b|\btools\.metaview\.([a-z_]+)\b/g)].map((match) => (match[1] ?? match[2])!)
    // Bare tool names in code spans, such as `search_conversations` or `fetch_candidates({ … })`.
    const bare = [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)(?:\(|`)/g)].map((match) => match[1]!).filter((word) => /^(get|list|search|fetch|find|group|create|send|update|upsert|manage|give|post|enrich|generate|resolve|restore|run|submit)_/.test(word) && !PARAMETER_NAMES.includes(word))
    expect([...prefixed, ...bare].filter((tool) => !KNOWN.includes(tool))).toEqual([])
  })

  test.each(NAMES)("%s writes each literal call with a known tool, its recorded parameters, and the required rationale", (name) => {
    const text = read(name).replace(/\s+/g, " ")
    const calls = [...text.matchAll(/`([a-z_]+)\(\{ (.*?) \}\)`/g)].map((match) => ({ tool: match[1]!, keys: topLevelKeys(match[2]!) }))
    for (const { tool, keys } of calls) {
      expect({ tool, known: KNOWN.includes(tool) }).toEqual({ tool, known: true })
      const recorded = PARAMETERS[tool]!.map((entry) => entry.split(":")[0]!.replace(/\*$/, ""))
      expect({ tool, unknown: keys.filter((key) => !recorded.includes(key)) }).toEqual({ tool, unknown: [] })
      expect({ tool, rationale: keys.includes("rationale") }).toEqual({ tool, rationale: true })
    }
    if (name !== "metaview-candidate-brief") expect(calls.length).toBeGreaterThan(0)
  })

  test.each(NAMES)("%s quotes only enum values the live schemas allow", (name) => {
    const live = JSON.parse(readFileSync(new URL("./metaview-live-tools.json", import.meta.url), "utf8")) as { tools: { inputSchema: { properties: Record<string, unknown> } }[] }
    // Every enum value each parameter name takes, in any tool, also inside anyOf.
    const enums = new Map<string, Set<string>>()
    const collect = (key: string, schema: unknown): void => {
      if (!schema || typeof schema !== "object") return
      const { enum: values, anyOf } = schema as { enum?: unknown[]; anyOf?: unknown[] }
      if (Array.isArray(values)) for (const value of values) if (typeof value === "string") enums.set(key, (enums.get(key) ?? new Set()).add(value))
      if (Array.isArray(anyOf)) for (const item of anyOf) collect(key, item)
    }
    for (const tool of live.tools) for (const [key, schema] of Object.entries(tool.inputSchema.properties)) collect(key, schema)
    // Keys of a filter's date value or a metric's arguments, not the tool parameter of the same name.
    const NESTED = ["scope"]
    const quoted = [...read(name).replace(/\s+/g, " ").matchAll(/`?([a-z_]+)`?: "([^"]+)"/g)].filter((match) => enums.has(match[1]!) && !NESTED.includes(match[1]!))
    for (const [, key, value] of quoted) expect({ key, value, allowed: enums.get(key!)!.has(value!) }).toEqual({ key, value, allowed: true })
    if (name === "metaview-write") {
      expect(quoted.map((match) => match[1]).sort()).toEqual(expect.arrayContaining(["decision_filter", "detail_level", "share_scope"]))
      for (const band of ["poor", "no_evidence", "okay", "good", "great"]) expect(enums.get("fit_filter")!.has(band)).toBe(true)
    }
  })

  test.each(NAMES)("%s writes every filter example with an operation and value shape the filter grammar allows", (name) => {
    const grammar = JSON.parse(readFileSync(new URL("./metaview-filter-formats.json", import.meta.url), "utf8")) as { filter_formats: Record<string, { operations: string[] }> }
    const ops = (type: string) => grammar.filter_formats[type]!.operations
    const text = read(name).replace(/\s+/g, " ")
    // Date filters: before/after take one date (or a relative offset); between takes a [from, to] pair.
    const dates = [...text.matchAll(/\{ field_id: "default:start_time", operation: "([a-z_]+)", value: \{ scope: "(relative|absolute)", value: (\[[^\]]*\]|"[^"]*"|-?\d+) \} \}/g)]
    for (const [, operation, scope, value] of dates) {
      expect(ops("date")).toContain(operation!)
      // A range is the user's local days: each bound carries its UTC offset, never a bare Z midnight.
      if (operation === "between") expect({ operation, scope, pair: /^\["[^"]+[+-]\d{2}:\d{2}", "[^"]+[+-]\d{2}:\d{2}"\]$/.test(value!) }).toEqual({ operation, scope: "absolute", pair: true })
      else expect({ operation, range: value!.startsWith("[") }).toEqual({ operation, range: false })
      if (scope === "relative") expect(value).toMatch(/^-?\d+$/)
    }
    // People and text filters use their field type's operations.
    for (const [, operation] of text.matchAll(/field_id: "default:(?:candidate|interviewer)", operation: "([a-z_]+)"/g)) expect(ops("participant_list")).toContain(operation!)
    if (name === "metaview") {
      expect(dates.map((match) => match[1])).toEqual(["after", "between"])
      for (const operation of ["includes_one_of", "excludes_all_of"]) expect(ops("participant_list")).toContain(operation)
      for (const operation of ["is_one_of", "like_one_of"]) expect(ops("string")).toContain(operation)
      expect(text).toContain("`before`/`after` take one date")
      expect(text).toMatch(/Bounds are the user's local midnights with their offset \(a time tool gives the zone\), the end exclusive/)
      expect(text).not.toMatch(/T00:00:00Z/)
    }
  })

  test("each skill says search_snippets takes the conversation's integer id, as its schema does", () => {
    expect(PARAMETERS.search_snippets).toContain("conversation_id*:integer")
    for (const name of ["metaview", "metaview-write"]) expect(read(name).replace(/\s+/g, " ")).toMatch(/`conversation_id` (?:as an integer|is the conversation's integer id)/)
  })

  test("metaview sends the user to /metaview-status and the sign-in step when Metaview is missing", () => {
    const text = read("metaview")
    expect(text).toContain("/metaview-status")
    expect(text).toContain("run `/connect` and choose Metaview")
    expect(text).toContain("opencode mcp auth metaview")
  })

  test("the descriptions name their requests and leave non-hiring meetings, calendars and Slack to other skills", () => {
    expect(description("metaview")).toMatch(/Not for non-hiring meetings \(Granola\), calendar scheduling or Slack/)
    expect(description("metaview")).toContain("Load before the first Metaview tool call")
    expect(description("metaview-candidate-brief")).toMatch(/Prep me for my interview/)
    // Granola's meeting brief fires on "brief me before my call with a person": this one leaves those to it.
    expect(description("metaview-candidate-brief")).toContain("Not for non-hiring meetings or calls (granola-meeting-brief)")
    expect(description("metaview-write")).toContain("Load before any Metaview change")
    for (const name of NAMES) expect(description(name)).not.toMatch(/\bmeeting notes\b|\bschedule a\b|\bpost to Slack\b/i)
  })

  test("the personal-data rules: AI output labelled as Metaview's, no protected inference, no unasked hiring decision", () => {
    const main = read("metaview")
    expect(main).toMatch(/Label Metaview's AI notes, summaries/)
    expect(main).toMatch(/Never infer or estimate age/)
    expect(main).toMatch(/No ranking, score/)
    expect(main).toMatch(/rationale/)
    expect(read("metaview-candidate-brief")).toMatch(/No ranking, overall score or "hire X"/)
    expect(read("metaview-candidate-brief")).toMatch(/rating blank/)
  })

  test("metaview keeps the fair-process line, gives no verdict for an unrun check, and retries a timeout once", () => {
    const text = read("metaview").replace(/\s+/g, " ")
    expect(text).toContain("suggest asking every candidate for the role the same job-related question")
    expect(text).toMatch(/give it no verdict, not even a hedged one/)
    expect(text).toMatch(/tied to no check by name/)
    expect(text).toMatch(/HTTP 504\) on a filtered or `search` call: retry once, narrower or without `search`, then report it; never loop/)
    expect(text).toMatch(/A miss on any full name \(a person, a review, a role\): no shortened, partial or variant terms/)
    expect(text).toMatch(/an access problem even for a call that just ended/)
    // nm3: data_access is the rule, not a fault; no closing offer of another source; no contact retry after a miss.
    expect(text).toMatch(/`data_access` only, which state the rule, not a fault: no unlinked account, processing or recording cause/)
    expect(text).toMatch(/end by asking for the email or role, never offering another source/)
    expect(text).toMatch(/no shortened, partial or variant terms, and no retry on `default:contact`/)
  })

  test("no text says outreach is off while two asking writes still act on candidates", () => {
    const write = read("metaview-write").replace(/\s+/g, " ")
    expect(write).toContain("`update_screen_outreach` with `reject_at_deadline: true` rejects candidates automatically at their deadline")
    expect(write).toContain("`manage_sequence` with `set_enabled: true` restarts outreach to everyone enrolled. Before either call, say whom it reaches")
    expect(write).toContain("Two changes that only ask still act on candidates")
    for (const text of [...NAMES.map(read), readFileSync(new URL("../../SECURITY.md", import.meta.url), "utf8")]) {
      expect(text.replace(/\s+/g, " ")).not.toMatch(/(?:rejecting candidates|candidate outreach|decisions and outreach|decisions, candidate outreach)(?: and [^.]*)? are (?:off|denied)/)
    }
  })

  test("the skills fence other sources: a calendar gives only the interview's time and title, and nothing searches mail for a candidate", () => {
    for (const name of ["metaview", "metaview-candidate-brief"]) {
      const text = read(name).replace(/\s+/g, " ")
      expect(text).toMatch(/only (?:that|this) interview's (?:own )?time and title/)
      expect(text).toMatch(/no attendees or descriptions/)
      expect(text).toMatch(/never name (?:or list )?other meetings/)
      expect(text).toMatch(/Never search mail, chat, Drive,? (?:other notes tools )?or the web for (?:a|the) candidate/)
    }
  })

  test("metaview-write says whom each kind of change reaches before asking, and that submit_feedback is off", () => {
    const text = read("metaview-write")
    for (const words of ["whom it reaches", "**Candidates:**", "**The ATS:**", "**The whole workspace:**", "**Credits:**", "**Anyone with the link:**"]) expect(text).toContain(words)
    expect(text).toContain('{ "action": "metaview_submit_feedback", "resource": "*", "effect": "ask" }')
    expect(text).toMatch(/never choose a\s+template for the user/)
  })

  test("metaview-write says what a write does and whom it reaches, then makes the call: the permission prompt is the yes", () => {
    const text = read("metaview-write").replace(/\s+/g, " ")
    expect(text).toMatch(/Before each write call, write one sentence in your reply on what the call does and \*\*whom it reaches\*\* \(a job post edit: every workspace member who can see the post\), then make the call in the same turn/)
    expect(text).toMatch(/That sentence is chat text, not a question: the permission prompt shows only the tool input and is the user's yes/)
    expect(text).toMatch(/Ask in chat first only when something must be chosen/)
    expect(text).toMatch(/Declined: say nothing changed, and offer your drafted text or a retry, never a workaround/)
    expect(text).not.toMatch(/wait for a yes|get a yes|only after a yes/)
  })

  test("metaview-write says a job-post edit reaches the shared post, and that checks change it too", () => {
    const text = read("metaview-write").replace(/\s+/g, " ")
    expect(text).toContain("an edit lands in the post that every workspace member with access sees")
    expect(text).not.toContain("contacts no one")
    expect(text).toMatch(/`run_job_post_checks\(\{ job_post_id, check_ids, rationale \}\)` records new results on the post/)
  })

  test("metaview-write names every denied tool as off, gives the ask rule that turns it on, and never works around it", () => {
    const text = read("metaview-write")
    const off = text.split("## Off by default")[1]?.split("\n## ")[0] ?? ""
    for (const name of DENIED_TOOLS) expect(off).toContain(`\`${name}\``)
    expect(off).toContain('{ "action": "metaview_manage_candidate_sequence", "resource": "*", "effect": "ask" }')
    expect(off).toMatch(/Never\s+work around the deny/)
    // The manual route, and no catalog probe for a tool the deny hides.
    expect(off).toMatch(/make the decision themselves in\s+Metaview's web app/)
    expect(off).toMatch(/Don't `search\(\)` for these tools/)
    expect(off).not.toMatch(/"effect": "allow"/)
  })

  test.each(NAMES)("%s links only to plain files an agent can read, never to a GitHub page", (name) => {
    const links = read(name).match(/https?:\/\/[^\s)>]*[^\s)>.,]/g) ?? []
    for (const link of links) expect(link).toMatch(/^https:\/\/raw\.githubusercontent\.com\/joe-broadhead\/opencode-metaview\/HEAD\//)
  })

  test("metaview's scripts section creates a session for the script and never borrows one", () => {
    const scripts = read("metaview").split("## Elsewhere, sign-in and scripts")[1]?.split("\n## ")[0] ?? ""
    expect(scripts).toContain("opencode api post /api/session")
    expect(scripts).toMatch(/never borrow/i)
    expect(scripts).toContain("metaview.workspace.tools")
  })
})
