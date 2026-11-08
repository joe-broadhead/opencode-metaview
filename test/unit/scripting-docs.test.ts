// docs/scripting.md and the README's scripting lines are the contract a script author copies. Every example must use a
// method this plugin registers, carry the location header and the strict envelope, and name only fields that method's
// schema accepts, so a doc example cannot drift from the code.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { METHODS, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { PARAMETERS } from "../../src/metaview-tools.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const FILES = ["docs/scripting.md", "README.md"]
const METHODS_BY_NAME = new Map(METHODS.map((method) => [method.name, method]))

interface Example {
  readonly file: string
  readonly line: number
  readonly method: string
  readonly body: unknown
  readonly statement: string
}

/** Every `opencode api post /api/rpc/…` call in a file, as its method name and its parsed body. */
function calls(text: string, file: string): Example[] {
  const out: Example[] = []
  for (const match of text.matchAll(/opencode api post \/api\/rpc\/([A-Za-z0-9.]+)\/([A-Za-z0-9_]+)/g)) {
    const start = match.index!
    // A statement runs to the end of its fenced block or the next blank line.
    const rest = text.slice(start)
    const end = rest.search(/\n\s*\n|\n```/)
    const statement = (end === -1 ? rest : rest.slice(0, end)).trim()
    out.push({ file, line: text.slice(0, start).split("\n").length, method: match[2]!, body: bodyOf(statement), statement })
  }
  return out
}

/** The `-d '{…}'` body of a statement, by matching braces. */
function bodyOf(statement: string): unknown {
  const at = statement.indexOf("-d '{")
  if (at === -1) return undefined
  let depth = 0
  let inString = false
  for (let i = at + 4; i < statement.length; i++) {
    const char = statement[i]
    if (inString) {
      if (char === "\\") i++
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{") depth++
    else if (char === "}") {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(statement.slice(at + 4, i + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

/** A parameter's bare name, without its `*` required marker or its type. */
const parameterName = (parameter: string) => parameter.replace(/\*?:.*$/s, "")

const examples = FILES.flatMap((file) => calls(readFileSync(join(ROOT, file), "utf8"), file))

describe("the scripting examples", () => {
  test("there are examples to check", () => {
    expect(examples.length).toBeGreaterThan(2)
  })

  test.each(examples)("$file:$line calls $method with this plugin's RPC id and a real method", (example) => {
    expect(example.statement).toContain("/api/rpc/metaview.workspace.tools/")
    expect(TOOLS_RPC_ID).toBe("metaview.workspace.tools")
    expect(example.method === "describe" || METHODS_BY_NAME.has(example.method)).toBe(true)
  })

  test.each(examples)("$file:$line sends the location header", (example) => {
    expect(example.statement).toContain('-H "x-opencode-directory:$PWD"')
  })

  test.each(examples)("$file:$line sends the strict envelope", (example) => {
    const envelope = (example.body as { input?: Record<string, unknown> } | undefined)?.input
    expect(envelope).toBeDefined()
    if (example.method === "describe") {
      expect(Object.keys(envelope!).filter((key) => !["sessionID", "input"].includes(key))).toEqual([])
      return
    }
    expect(Object.keys(envelope!).sort()).toEqual(["input", "sessionID"])
    expect(typeof envelope!["sessionID"]).toBe("string")
    expect(typeof envelope!["input"]).toBe("object")
  })

  test.each(examples.filter((example) => example.method !== "describe"))("$file:$line names only fields $method accepts", (example) => {
    expect(METHODS_BY_NAME.get(example.method)!.kind).toBe("mcp")
    const parameters = PARAMETERS[example.method]!
    const names = parameters.map(parameterName)
    const input = ((example.body as { input?: { input?: unknown } } | undefined)?.input?.input ?? {}) as Record<string, unknown>
    for (const key of Object.keys(input)) expect({ key, known: names.includes(key) }).toEqual({ key, known: true })
    for (const parameter of parameters.filter((entry) => entry.includes("*"))) {
      expect({ key: parameterName(parameter), given: parameterName(parameter) in input }).toEqual({ key: parameterName(parameter), given: true })
    }
  })
})
