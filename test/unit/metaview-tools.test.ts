// The tool lists in src/metaview-tools.ts are the one record of Metaview's tools; everything else derives from them.
import { describe, expect, test } from "bun:test"
import { classify, DESTRUCTIVE_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/metaview-tools.js"

const ALL = [...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]

describe("Metaview's tool lists", () => {
  test("name each tool once, in one list only, as a plain lower-case name without the server prefix", () => {
    expect(new Set(ALL).size).toBe(ALL.length)
    for (const name of ALL) expect(name).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
    expect(ALL.filter((name) => name.startsWith("metaview_"))).toEqual([])
    for (const list of [READ_TOOLS, WRITE_TOOLS]) expect([...list]).toEqual([...list].sort())
  })

  test("classify each tool by its list, and everything else as unknown", () => {
    for (const tool of READ_TOOLS) expect(classify(tool)).toBe("read")
    for (const tool of WRITE_TOOLS) expect(classify(tool)).toBe("write")
    for (const tool of DESTRUCTIVE_TOOLS) expect(classify(tool)).toBe("destructive")
    for (const tool of ["shiny_new_tool", "", "metaview_search_conversations", "SEARCH_CONVERSATIONS", "describe"]) expect(classify(tool)).toBe("unknown")
  })

  test("reads never change anything: no create, send, update or other change verb is a read", () => {
    const change = /^(create|send|update|upsert|manage|give|post|enrich|generate|resolve|restore|run|submit|delete)_/
    expect(READ_TOOLS.filter((tool) => change.test(tool))).toEqual([])
    expect(WRITE_TOOLS.filter((tool) => !change.test(tool))).toEqual([])
  })

  test("the account read is a known read; feedback to Metaview, candidate decisions and outreach are the destructive three", () => {
    expect(READ_TOOLS).toContain("get_user_context")
    expect([...DESTRUCTIVE_TOOLS].sort()).toEqual(["give_application_review_candidate_feedback", "manage_candidate_sequence", "submit_feedback"])
  })
})
