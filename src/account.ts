import type { Plugin } from "@opencode/plugin"
import { cut, oneLine } from "./redact.js"
import { SERVER_NAME } from "./constants.js"

/**
 * What status shows about the signed-in Metaview account, from the last `get_user_context` result: the workspace's
 * name, whether the user is an admin (who sees every conversation) or a member, and whether the plan is paid. Nothing
 * else of the result is read: no IDs, names, emails or `data_access` text. Kept in memory only.
 */
export interface Account {
  readonly workspace?: string
  readonly role?: "admin" | "member"
  /** `credits`: conversations unlock on the workspace's shared platform credits rather than the user's plan. */
  readonly plan?: "paid" | "free" | "credits"
}

/** The account read; the plugin never calls it itself, so status makes no data call. */
export const ACCOUNT_TOOL = "get_user_context"

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function text(content: unknown): string | undefined {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  return content.flatMap((part) => (record(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n")
}

const clean = (name: string) => cut(oneLine(name), 80)

/**
 * Reads the three fields from a result's structured output or its JSON text, at the top level or one level down.
 * Metaview's tool declares no output schema; its description documents a flat object with `workspace_name`,
 * `is_admin` and `is_paying_plan`, and `notes_on_platform_credits` in place of `is_paying_plan` when conversations
 * unlock on shared credits. Only that key's presence is read, never its text. The shape stays unconfirmed until a
 * live call: a result in another shape leaves the rows "not read yet", never wrong.
 */
export function accountOf(result: { readonly output?: unknown; readonly content?: unknown }): Account | undefined {
  for (const candidate of [parse(result.output), parse(text(result.content))]) {
    if (!record(candidate)) continue
    for (const fields of [candidate, ...Object.values(candidate).filter(record)]) {
      const { workspace_name: name, is_admin: admin, is_paying_plan: paying } = fields
      const credits = typeof paying !== "boolean" && "notes_on_platform_credits" in fields
      const workspace = typeof name === "string" ? clean(name) : ""
      const account = {
        ...(workspace ? { workspace } : {}),
        ...(typeof admin === "boolean" ? { role: admin ? ("admin" as const) : ("member" as const) } : {}),
        ...(typeof paying === "boolean" ? { plan: paying ? ("paid" as const) : ("free" as const) } : credits ? { plan: "credits" as const } : {}),
      }
      if (Object.keys(account).length) return account
    }
  }
  return undefined
}

type AccountResult = Parameters<typeof accountOf>[0]

interface Capture {
  readonly capture: (result: AccountResult) => void
  /** The instance's server is the user's own entry without OAuth, which signs in with its own key. */
  readonly ownSignIn: () => boolean
  /** The instance's `metaview` server is Metaview's: a server at another URL is not, and its results say nothing. */
  readonly owned: () => boolean
}

/**
 * Every running plugin instance's capture. The tools RPC's reads skip the `execute.after` hook, and its result shaping
 * learns neither the instance nor the location that served the call, so it tells every instance. That is right only
 * while they share OpenCode's one Metaview sign-in. An instance whose project adopts its own entry with an API key
 * may be another person's account, so while any instance does, a script's account read updates no status: the model
 * path, whose hook belongs to its own instance, still does.
 */
const captures = new Set<Capture>()

/** Records the account from a `get_user_context` result that a script read through the tools RPC. */
export function captureAccount(result: AccountResult): void {
  if ([...captures].some((item) => item.ownSignIn())) return
  for (const item of captures) if (item.owned()) item.capture(result)
}

const RESUBSCRIBE_MS = 5_000

/**
 * Captures the account from the model's `get_user_context` calls and the tools RPC's, and forgets it when the user
 * signs out or switches accounts. Also notes when the server's status last changed, so status can tell a server that
 * is still listing its tools from one that lists none. Returns the current account and a cleanup.
 */
export async function watchAccount(
  ctx: {
    readonly tool: Pick<Plugin.Context["tool"], "hook">
    readonly mcp: Pick<Plugin.Context["mcp"], "list">
    readonly event: Pick<Plugin.Context["event"], "subscribe">
  },
  ownSignIn: () => boolean = () => false,
  owned: () => boolean = () => true,
) {
  let account: Account | undefined
  let changedAt = Date.now()
  const capture = (result: AccountResult) => void (account = accountOf(result) ?? account)
  const hook = await ctx.tool.hook("execute.after", async (event) => {
    if (event.tool === `${SERVER_NAME}_${ACCOUNT_TOOL}` && event.status === "completed" && owned()) capture(event.result)
  })
  const entry: Capture = { capture, ownSignIn, owned }
  captures.add(entry)

  const stopped = new AbortController()
  // Signed out (the server needs a sign-in again) or another account: what was read no longer holds.
  const check = async () => {
    const server = (await ctx.mcp.list()).data.find((item) => item.name === SERVER_NAME)
    if (server?.status.status !== "connected" && server?.status.status !== "pending") account = undefined
  }
  const watching = (async () => {
    while (!stopped.signal.aborted) {
      try {
        const events = ctx.event.subscribe({ types: ["mcp.status.changed", "credential.switched"], signal: stopped.signal })
        for await (const event of events) {
          if (event.type === "credential.switched") account = undefined
          else if (event.data.server === SERVER_NAME) {
            changedAt = Date.now()
            await check().catch(() => undefined)
          }
        }
      } catch {
        // The stream failed; subscribe again.
      }
      await delay(RESUBSCRIBE_MS, stopped.signal)
    }
  })()

  return {
    current: () => account,
    /** Forgets the account, for a status read that finds the server signed out. */
    forget: () => void (account = undefined),
    changedAt: () => changedAt,
    stop: async () => {
      stopped.abort()
      captures.delete(entry)
      await watching
      await hook.dispose()
    },
  }
}

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })
