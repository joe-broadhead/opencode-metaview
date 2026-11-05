// A loopback Streamable-HTTP MCP server. By default it lists two known reads (one the account read), one known write,
// the three denied tools and one tool the plugin has never seen. With `catalog: "metaview"` it lists every tool in
// src/metaview-tools.ts and the new tool. It answers JSON-RPC POSTs with plain JSON (no SSE stream) and records every
// tool call, its path and every request header. A `tools/call` answers with the tool's name, the path and its
// arguments as structured content; for a `query` that starts with "text", with text alone; or, for a `query` that
// starts with "fail", with an upstream error (`isError`) whose first line holds a signed URL. `get_user_context`
// answers with a fake account, in Metaview's shape. The same server is also an LM Studio-compatible model API for a
// scripted model (`model.script`), so a host test can run a real session turn that calls Metaview's tools.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { DENIED_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/metaview-tools.js"

const schema = { type: "object", properties: { query: { type: "string" }, rationale: { type: "string" } } }
/** A tool the plugin has never seen. */
export const NEW_TOOL = { name: "shiny_new_tool", description: "A tool added upstream after the tool lists were written", annotations: {} }
const tool = (name: string, readOnlyHint: boolean) => ({ name, description: `Metaview ${name}`, annotations: { readOnlyHint }, inputSchema: schema })
const TOOLS = [tool("search_conversations", true), tool("get_user_context", true), tool("create_snippet", false), ...DENIED_TOOLS.map((name) => tool(name, false)), { ...NEW_TOOL, inputSchema: schema }]
const CATALOG = [...READ_TOOLS.map((name) => tool(name, true)), ...[...WRITE_TOOLS, ...DENIED_TOOLS].map((name) => tool(name, false)), { ...NEW_TOOL, inputSchema: schema }]

/** The upstream error a "fail" query gets: two lines, the first with a signed URL. */
export const UPSTREAM_FAILURE = "Metaview refused https://files.metaview.ai/a.png?signature=fake-signature-123 for this input\nTraceback: second line"

/** A fake account, in get_user_context's shape. */
export const ACCOUNT = { workspace_name: "Acme Recruiting", participant_id: "p_fake_1", user_id: "u_fake_1", is_admin: false, is_paying_plan: true, data_access: "Your own conversations" }

export interface FakeMcpOptions {
  /** `metaview` lists every tool the plugin knows, and the new tool. */
  readonly catalog?: "metaview"
}

/** The scripted model's id, as the fake's model API lists it. */
export const MODEL_ID = "fake-model"

/** A tool call the scripted model makes: the n-th call follows n tool results. */
interface ScriptedCall {
  readonly tool: string
  readonly arguments: Record<string, unknown>
}

export interface FakeMcp {
  readonly url: string
  /**
   * While true, every MCP request gets 401 with a bearer challenge, as Metaview's server answers before a sign-in or
   * after its tokens are revoked. The model API keeps answering.
   */
  challenge: boolean
  /** The server's origin; `${origin}/v1` is the model API. */
  readonly origin: string
  readonly model: {
    /** The calls the model makes, one per turn, before it answers with text. */
    script: ScriptedCall[]
    /** Every chat request body, in order. */
    readonly requests: unknown[]
  }
  /** Tool names called, in order. */
  readonly calls: string[]
  /** Each tool call with the path it was sent to, in order. */
  readonly called: { readonly tool: string; readonly path: string }[]
  /** Each tool call's arguments, in order. */
  readonly inputs: { readonly tool: string; readonly arguments: unknown }[]
  /** The `x-metaview-test` header of every request, to tell whose server config the host used. */
  readonly markers: (string | undefined)[]
  /** The `authorization` header of every request. */
  readonly authorizations: (string | undefined)[]
  close(): Promise<void>
}

type Message = { jsonrpc: "2.0"; id?: number | string; method: string; params?: { protocolVersion?: string; name?: string; arguments?: { query?: unknown } } }

export async function startFakeMcp(options: FakeMcpOptions = {}): Promise<FakeMcp> {
  const calls: string[] = []
  const called: { tool: string; path: string }[] = []
  const inputs: { tool: string; arguments: unknown }[] = []
  const markers: (string | undefined)[] = []
  const authorizations: (string | undefined)[] = []
  const answer = (message: Message, path: string) => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result })
    switch (message.method) {
      case "initialize":
        return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-metaview", version: "0.0.0" } })
      case "tools/list":
        return reply({ tools: options.catalog === "metaview" ? CATALOG : TOOLS })
      case "tools/call": {
        const name = message.params?.name ?? ""
        calls.push(name)
        called.push({ tool: name, path })
        const args = message.params?.arguments ?? {}
        inputs.push({ tool: name, arguments: args })
        if (name === "get_user_context") return reply({ content: [{ type: "text", text: JSON.stringify(ACCOUNT) }], structuredContent: ACCOUNT })
        if (String(args.query ?? "").startsWith("fail")) return reply({ content: [{ type: "text", text: UPSTREAM_FAILURE }], isError: true })
        if (String(args.query ?? "").startsWith("text")) return reply({ content: [{ type: "text", text: `text from ${name}` }] })
        return reply({ content: [{ type: "text", text: `called ${name}` }], structuredContent: { tool: name, path, arguments: args } })
      }
      case "ping":
        return reply({})
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }
    }
  }
  const model = { script: [] as ScriptedCall[], requests: [] as unknown[] }
  // Filled once the server listens; the request handler reads `challenge` and `origin` from it.
  const fake = { challenge: false } as FakeMcp
  /**
   * One streamed chat completion. A request that offers tools is an agent turn: after n tool results the model makes
   * the n-th scripted call, then answers "Done.". Any other request, such as a title, gets text.
   */
  const chat = (response: ServerResponse, body: string) => {
    const request = JSON.parse(body) as { tools?: unknown[]; messages?: { role: string }[] }
    model.requests.push(request)
    const results = (request.messages ?? []).filter((message) => message.role === "tool").length
    const call = request.tools?.length ? model.script[results] : undefined
    const chunk = (delta: unknown, finish: string | null) =>
      `data: ${JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model: MODEL_ID, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const usage = `data: ${JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model: MODEL_ID, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`
    const delta = call
      ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${results + 1}`, type: "function", function: { name: call.tool, arguments: JSON.stringify(call.arguments) } }] }
      : { role: "assistant", content: "Done." }
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end(`${chunk(delta, null)}${chunk({}, call ? "tool_calls" : "stop")}${usage}data: [DONE]\n\n`)
  }
  const server = createServer(async (request, response) => {
    const route = new URL(request.url ?? "/", "http://127.0.0.1").pathname
    if (route === "/api/v1/models") {
      const models = [{ type: "llm", key: MODEL_ID, display_name: "Fake model", loaded_instances: [], max_context_length: 32_000, capabilities: { vision: false, trained_for_tool_use: true } }]
      return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ models }))
    }
    if (route === "/v1/chat/completions") return chat(response, await read(request))
    markers.push(header(request, "x-metaview-test"))
    authorizations.push(header(request, "authorization"))
    if (fake.challenge) {
      const metadata = `${fake.origin}/.well-known/oauth-protected-resource`
      return void response
        .writeHead(401, { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${metadata}", scope="openid offline_access"` })
        .end(JSON.stringify({ error: "invalid_token" }))
    }
    if (request.method !== "POST") return void response.writeHead(405, { allow: "POST" }).end()
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname
    const body = JSON.parse(await read(request)) as Message | Message[]
    const replies = (Array.isArray(body) ? body : [body]).filter((message) => message.id !== undefined).map((message) => answer(message, path))
    if (!replies.length) return void response.writeHead(202).end()
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Array.isArray(body) ? replies : replies[0]))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  Object.assign(fake, {
    url: `http://127.0.0.1:${port}/mcp`,
    origin: `http://127.0.0.1:${port}`,
    model,
    calls,
    called,
    inputs,
    markers,
    authorizations,
    close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  })
  return fake
}

const header = (request: IncomingMessage, name: string) => [request.headers[name]].flat()[0]

async function read(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}
