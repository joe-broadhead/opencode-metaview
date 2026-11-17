import type { ErrorCode } from "@we-the-rebel-alliance/source-contract/events"
import { upstreamText } from "@we-the-rebel-alliance/source-contract/tools-rpc"

// events_list's and probe's failures, in the plugin's one error shape, `CODE: What happened. Next step: What to do.` The
// codes are the source contract's own (`ERROR_CODES` in its `events` module), so a consumer reads them without a mapping.

/** One failure: the contract's code, what happened (a sentence) and the next step (a sentence). */
export interface Problem {
  readonly code: ErrorCode
  readonly message: string
  readonly next: string
}

/** The plugin's one error shape. */
export const describe = (problem: Problem) => `${problem.code}: ${problem.message} Next step: ${problem.next}`

/** A failure of events_list or probe. The tool shows it as a Tool.Error; the tools RPC as the script's code and next step. */
export class EventsFailure extends Error {
  readonly problem: Problem
  constructor(problem: Problem) {
    super(describe(problem))
    this.name = "EventsFailure"
    this.problem = problem
  }
}

/** Metaview's or OpenCode's text as one line without tokens or signed URLs, without its final full stop. */
const reasonOf = (text: string) => upstreamText(text).replace(/[.\s]+$/, "")

export function invalidInput(method: string, problems: readonly string[]): Problem {
  return {
    code: "INPUT_INVALID",
    message: `The ${method} input is invalid: ${reasonOf(problems.join("; "))}.`,
    next:
      method === "probe"
        ? "Pass only source and account, as probe's schema describes."
        : "Pass account (the signed-in Metaview account, as probe names it), and only since, cursor, limit (1 to 500) and source besides, as the tool's schema describes.",
  }
}

export function accountRequired(): Problem {
  return {
    code: "INPUT_INVALID",
    message: "A listing of Metaview conversations names the account it reads, and this events_list call names none.",
    next: "Pass account, the signed-in Metaview account that probe answers, with since or the previous result's cursor.",
  }
}

export function cursorInvalid(): Problem {
  return {
    code: "CURSOR_INVALID",
    message: "The cursor was not issued by Metaview's events_list for this account.",
    next: "Pass a cursor from a previous result for the same account, or start again with since.",
  }
}

export function accountMismatch(account: string, why: "cursor" | "signed-in"): Problem {
  return why === "cursor"
    ? {
        code: "ACCOUNT_MISMATCH",
        message: `The cursor is for another Metaview account than ${account}.`,
        next: "Pass the cursor with the account it was issued for, or start again for this account with since.",
      }
    : {
        code: "ACCOUNT_MISMATCH",
        message: `Metaview is signed in to another account than ${account}.`,
        next: "Sign in to Metaview as that account (/connect, Metaview), or read as the account probe names.",
      }
}

export function sourceUnknown(): Problem {
  return {
    code: "SOURCE_UNKNOWN",
    message: "This plugin lists one source, metaview.",
    next: 'Leave source out, or pass "metaview".',
  }
}

export function ownerUnknown(): Problem {
  return {
    code: "UNAVAILABLE",
    message: "Metaview's get_user_context did not name the signed-in user and organization.",
    next: "Run /metaview-status, and sign in to Metaview again if it shows a problem.",
  }
}

export function readFailed(tool: string, reason: string, method: string): Problem {
  return {
    code: "UNAVAILABLE",
    message: `Metaview's ${tool} failed: ${reasonOf(reason)}.`,
    next: `Call ${method} again${method === "events_list" ? " with the same cursor" : ""}; if it keeps failing, run /metaview-status.`,
  }
}

export function unreadable(tool: string, method: string): Problem {
  return {
    code: "UNAVAILABLE",
    message: `Metaview's ${tool} answered in a shape this plugin does not read.`,
    next: `Call ${method} again; if it keeps failing, run /metaview-status and update the plugin.`,
  }
}

/** Metaview's server is not connected, or OpenCode does not list the tool a read needs. */
export function notConnected(state: string, tool: string): Problem {
  if (state === "needs_auth") {
    return {
      code: "NEEDS_SIGN_IN",
      message: "Metaview needs a sign-in.",
      next: "Run /connect and choose Metaview, then press o or Enter to open the link.",
    }
  }
  const what =
    state === "connected"
      ? `OpenCode does not list Metaview's ${tool} on the connected server`
      : state === "pending"
        ? "Metaview's server is still connecting"
        : state === "disabled"
          ? "Metaview's server is disabled"
          : state === "failed"
            ? "Metaview's server could not connect"
            : "Metaview's server is not registered"
  return { code: "UNAVAILABLE", message: `${what}.`, next: "Run /metaview-status and follow its next step, then call the method again." }
}
