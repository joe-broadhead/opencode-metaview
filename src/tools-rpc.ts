/**
 * Metaview's part of the tools RPC (`metaview.workspace.tools`): the plugin value and the method table that the source
 * contract's `tools-rpc` module takes. The module (`@we-the-rebel-alliance/source-contract/tools-rpc`, bundled into
 * `dist/index.js`) is the transport every plugin of the family shares:
 *
 *   POST /api/rpc/metaview.workspace.tools/<method>
 *   { "input": { "sessionID": "<session>", "input": <the tool's input> } }
 *
 * A script runs as a session and the agent it names; the rule for the method's permission action is resolved before
 * dispatch, and only `allow` runs. An MCP method then runs through OpenCode's own executor, which checks
 * `metaview_<tool>` against the same rules and sends OpenCode's own credential. The table is the native Metaview tools
 * only; this standalone build registers no collection methods. `docs/scripting.md` describes the calls.
 */
import type { McpResult, MethodSpec, NextSteps, ShapeCall, ToolsRpcPlugin } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { toolsRpcId } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { ACCOUNT_TOOL, captureAccount } from "./account.js"
import { PLUGIN_ID, SERVER_NAME } from "./constants.js"
import { DESTRUCTIVE_TOOLS, READ_TOOLS, SEND_TOOLS, WRITE_TOOLS } from "./metaview-tools.js"

export { PLUGIN_ID }

/** The RPC's id: the plugin's id and `.tools`, `metaview.workspace.tools`. Scripts call it by name, so it never changes. */
export const TOOLS_RPC_ID = toolsRpcId(PLUGIN_ID)

/**
 * Every tool this plugin knows, by exact upstream name, with the class the tools RPC reports. An allowlist: a tool the
 * server adds later is not a method until it is classified in `src/metaview-tools.ts`, and `describe` lists it as
 * unclassified. Any tool is a method, the destructive ones included: the class says what it does, and the rules decide
 * whether a call runs. There are no plugin-owned methods: the collection-only source methods are not part of this build.
 */
export const METHODS: readonly MethodSpec[] = [
  ...READ_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: "read" })),
  ...WRITE_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: SEND_TOOLS.includes(name) ? "send" : "write" })),
  ...DESTRUCTIVE_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: "destructive" })),
]

/** What the model path's `execute.before` hooks do to an MCP call's arguments, which the executor skips. Metaview has none. */
export function shapeInput(_method: string, input: unknown, _call: ShapeCall): unknown {
  return input
}

/**
 * What the model path's `execute.after` hook does to a result, which the executor skips: the account read records the
 * workspace, role and plan that status shows, with the hook's own function. The result itself is unchanged.
 */
export function shapeResult(method: string, result: McpResult, _call: ShapeCall): McpResult {
  if (method === ACCOUNT_TOOL) captureAccount({ output: result.output, content: result.text })
  return result
}

/** The next step for each code. Each is one sentence that ends with a full stop. */
export const NEXT_STEPS: NextSteps = {
  SESSION_UNKNOWN: `Create a session in the location you mean, such as POST /api/session with {"agent":"build"} sent with the header "x-opencode-directory: <dir>" or the location[directory] query, and pass its id.`,
  SESSION_AGENT_REQUIRED: `Create a session that names an agent this project has, with its project as the location, such as POST /api/session with {"agent":"build","location":{"directory":"/path/to/project"}}, and pass its id.`,
  PERMISSION_DENIED: "Add an allow rule for the tool to the session's agent or to the session, or use a session whose agent allows it.",
  SERVER_CONFLICT: `Run /metaview-status, then point your own mcp.servers.${SERVER_NAME} in opencode.json at the URL it names or remove it, and restart OpenCode.`,
  AUTH_REQUIRED: `Run /connect and choose Metaview, then press o or Enter to open the link (in a terminal, opencode mcp auth ${SERVER_NAME} opens it automatically).`,
  CONNECTING: "Wait a few seconds, then call the method again.",
  CONNECTION_FAILED: "Check your network, then run /metaview-status and follow its next step.",
  DISABLED: `Enable the ${SERVER_NAME} server in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`,
  NOT_REGISTERED: "Run /metaview-status and follow its next step.",
  TOOL_UNAVAILABLE: "Call describe to see which methods OpenCode lists now; Metaview lists only the tools for the products your account has.",
  UPSTREAM_ERROR: "Check the input against the method's schema from describe, and run /metaview-status if it keeps failing.",
  CANCELLED: "Call the method again if you still need the result.",
}

/** Metaview's plugin value for the tools RPC. */
export const PLUGIN: ToolsRpcPlugin = { id: PLUGIN_ID, nextSteps: NEXT_STEPS, shapeInput, shapeResult }
