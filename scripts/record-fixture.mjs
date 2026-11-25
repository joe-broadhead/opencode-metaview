// Rewrites fixtures/conformance.json from the plugin's fake Metaview server.
//
//   npm run fixtures
//
// The fake server is deterministic and its payloads are recorded from Metaview's own tool contract, so every answer can
// be rebuilt. A real deployment records from two signed-in accounts with `npx plugin-kit record --account <alias>`.
import { mkdirSync, writeFileSync } from "node:fs"
import { manifest, packageName } from "../src/manifest.ts"
import { run, runtimeFor } from "../test/support/handlers.ts"

const runtime = runtimeFor()
const source = manifest.sources[0]
if (source === undefined) throw new Error("the manifest declares no source")
const sourceName = typeof source.input?.["source"] === "string" ? source.input["source"] : source.id
const since = "2026-11-01T00:00:00.000Z"

const page = (input) => run(runtime, "events_list", input, input.account ?? "work")
const workPage = await page({ source: sourceName, account: "work", since })
const personalPage = await page({ source: sourceName, account: "personal", since })
const scopedPage = await page({ source: sourceName, account: "work", since, scope: { reports: ["rpt-research"] } })
const emptyPage = await page({ source: sourceName, account: "work", since: "2026-11-24T00:00:00.000Z" })

async function refusal(input, chosen = "work") {
  try {
    await run(runtime, "events_list", input, chosen)
  } catch (error) {
    if (error instanceof Error) return error.message
    throw error
  }
  throw new Error("expected a refusal")
}

const cursorRefusal = await refusal({ source: sourceName, cursor: workPage.cursor }, "personal")
const sourceRefusal = await refusal({ source: "other" })

const probe = await run(runtime, "probe", { source: sourceName }, "work")
const status = await run(runtime, "status", {})

const fixture = {
  plugin: packageName,
  accounts: {
    real: true,
    aliases: ["work", "personal"],
    required: { method: "events_list", code: "ACCOUNT_REQUIRED" },
    unknown: { method: "events_list", account: "nobodyhere", code: "ACCOUNT_UNKNOWN" },
    cursors: [{ method: "events_list", account: "work", other: "personal", code: "CURSOR_INVALID" }],
  },
  sources: {
    [source.id]: {
      cases: [
        { name: "a work page", input: { source: sourceName, account: "work", since }, expect: "page", answer: workPage },
        { name: "a personal page", input: { source: sourceName, account: "personal", since }, expect: "page", answer: personalPage },
        {
          name: "only the confirmed report",
          input: { source: sourceName, account: "work", since, scope: { reports: ["rpt-research"] } },
          expect: "page",
          answer: scopedPage,
        },
        { name: "an empty window", input: { source: sourceName, account: "work", since: "2026-11-24T00:00:00.000Z" }, expect: "empty", answer: emptyPage },
        {
          name: "another account's cursor is refused",
          input: { source: sourceName, account: "personal", cursor: workPage.cursor },
          expect: "CURSOR_INVALID",
          refuses: cursorRefusal,
        },
        { name: "an unknown source is refused", input: { source: "other", account: "work" }, expect: "SOURCE_UNKNOWN", refuses: sourceRefusal },
      ],
      probe: { input: { source: sourceName, account: "work" }, answer: probe },
    },
  },
  events: { emitted: [], status },
  namespace: manifest.plugin.summary,
}

mkdirSync("fixtures", { recursive: true })
writeFileSync("fixtures/conformance.json", `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`recorded fixtures/conformance.json for ${packageName}`)
