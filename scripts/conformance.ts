// The conformance stage of `npm run check`: source-contract's kit over this plugin's own reads and the offline fixture
// (test/support/conformance.ts), with its report written to reports/conformance-report.json for the release to attach
// beside SHA256SUMS. Fails when any source's report is not ok. The report holds no time or path, so every run writes
// the same bytes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ROOT, conformanceReports, installed } from "../test/support/conformance.js"

const contract = JSON.parse(readFileSync(join(ROOT, "node_modules", "@we-the-rebel-alliance", "source-contract", "package.json"), "utf8")) as { version: string }
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { name: string; version: string }
const reports = await conformanceReports()
const ok = reports.every((report) => report.ok)
const file = join(ROOT, "reports", "conformance-report.json")
mkdirSync(join(ROOT, "reports"), { recursive: true })
const report = {
  plugin: pkg.name,
  version: pkg.version,
  contract: `source-contract ${contract.version}`,
  descriptorHash: installed().hash,
  fixture: "test/fixtures/conformance.json",
  ok,
  reports,
}
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
for (const entry of reports) {
  const ran = entry.checks.filter((check) => check.ran).length
  const skipped = entry.checks.filter((check) => check.notApplicable).map((check) => check.name)
  console.log(`${entry.ok ? "ok" : "NOT OK"}: ${entry.source}: ${ran} checks ran${skipped.length > 0 ? `; not applicable: ${skipped.join(", ")}` : ""}`)
  for (const problem of entry.problems) console.error(`  - ${problem}`)
  if (entry.incomplete) console.error(`  incomplete: ${entry.checks.filter((check) => !check.ran && !check.notApplicable).map((check) => check.name).join(", ")}`)
}
console.log("wrote reports/conformance-report.json")
process.exit(ok ? 0 : 1)
