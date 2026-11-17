// Metaview's answers, read for the conversations source: the signed-in user from get_user_context, and a page of
// conversations from search_conversations. Only metadata is read: ids, the start, the event's title, the conversation
// type, the link, and the candidates' and interviewers' participant ids and names as Metaview labels them. Emails,
// phone numbers, transcripts, summaries and every other field are never read, whatever the answer holds.
//
// The shapes are the ones Metaview's server answered with on 17 November 2026 (its tools declare no output schema):
//   get_user_context:     { organization_id, workspace_name, user_id, participant_id, is_admin, ... }
//   search_conversations: { field_definitions, conversations: [{ id, url, has_transcript, fields: { "<field id>":
//                           [{ value, label, details? }] } }], total_count, has_more, message? }
// A start is "YYYY-MM-DD HH:MM:SS+HH:MM".

/** The fields a listing asks search_conversations for, and the only ones it reads. */
export const FIELDS = {
  start: "default:start_time",
  title: "default:calendar_event_title",
  candidate: "default:candidate",
  interviewer: "default:interviewer",
  type: "default:conversation_type",
} as const

/** A participant as Metaview labels one: its participant id, and the name it shows. */
export interface Participant {
  readonly id: string
  readonly name?: string
}

/** What the source keeps of one conversation. */
export interface ConversationFacts {
  readonly id: string
  readonly time?: number
  readonly title?: string
  readonly type?: string
  readonly url?: string
  readonly candidates: readonly Participant[]
  readonly interviewers: readonly Participant[]
}

/** One page of search_conversations. */
export interface ConversationsPage {
  readonly conversations: readonly ConversationFacts[]
  /** How many conversations the page answered with, readable or not: the offset moves by this. */
  readonly count: number
  /** How many of them it could not read: not an object, or no id. */
  readonly invalid: number
  /** Metaview's `has_more`, when it gives one. */
  readonly more?: boolean
  /** Metaview's `total_count`, when it gives one. */
  readonly total?: number
}

/** The signed-in user, as get_user_context names it: the organization and user ids. */
export interface UserFacts {
  readonly organization: string
  readonly user: string
}

type Result = { readonly output?: unknown; readonly content?: unknown }

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** A result's text parts, joined. */
export function resultText(result: Result): string {
  const content = result.content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.flatMap((part) => (record(part) && part["type"] === "text" && typeof part["text"] === "string" ? [part["text"]] : [])).join("\n")
}

/** The answer as an object: the structured output when it is one, else the text parsed as JSON. */
export function answerOf(result: Result): Record<string, unknown> | undefined {
  for (const candidate of [parse(result.output), parse(resultText(result))]) if (record(candidate)) return candidate
  return undefined
}

/** A numeric id as a string of digits; undefined for anything else. */
function idOf(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value)
  if (typeof value === "string" && /^\d{1,20}$/.test(value)) return value.replace(/^0+(?=\d)/, "")
  return undefined
}

/** One line, trimmed; undefined when empty. */
function line(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim()
  return text === "" ? undefined : text
}

/** The signed-in user from a get_user_context answer, at the top level or one level down; undefined without both ids. */
export function userOf(result: Result): UserFacts | undefined {
  const answer = answerOf(result)
  if (!answer) return undefined
  for (const fields of [answer, ...Object.values(answer).filter(record)]) {
    const organization = idOf(fields["organization_id"])
    const user = idOf(fields["user_id"])
    if (organization === undefined || user === undefined) continue
    return { organization, user }
  }
  return undefined
}

/** A start as Metaview writes it ("2026-11-10 09:30:00+00:00"), or any ISO time with a zone; undefined otherwise. */
export function timeOf(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined
  const text = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) (?=\d)/, "$1T")
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(text)) return undefined
  const time = Date.parse(text)
  return Number.isFinite(time) ? time : undefined
}

/** A field's entries: Metaview gives each field as a list of `{ value, label }`. */
function entries(fields: Record<string, unknown>, id: string): Record<string, unknown>[] {
  const value = fields[id]
  return Array.isArray(value) ? value.filter(record) : []
}

/** Metaview's participant ids are UUIDs; anything else (an address, say) is not an id an event carries. */
const PARTICIPANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** An email address; not a URL's user and password, which the secret screening refuses whole. */
const EMAIL = /(?<![\w.+:/-])[^\s@<>()"',;:/]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi
/**
 * A phone number: 9 to 15 digits, with spaces, dots, dashes, brackets or a leading +, not inside a word or a URL. A
 * date (`2026-11-12 10`) is not one.
 */
const PHONE = /(?<![\w/=#?&.:-])\+?\(?\d(?:[\s().-]*\d){8,14}(?![\w/])/g
const DATE = /^\d{4}-\d{2}-\d{2}/

/** Whether text holds an email address or a phone number. */
export const holdsContact = (text: string) => maskContacts(text) !== text

/** Text with every email address and phone number masked. */
export const maskContacts = (text: string) => text.replace(EMAIL, "[email]").replace(PHONE, (match) => (DATE.test(match) ? match : "[phone]"))

/**
 * The participants of a participant field: the id, and the name as Metaview labels it. Contact details are never read:
 * an entry whose id is not a participant UUID is dropped, and a label that holds an address or a number is not a name.
 */
function participants(fields: Record<string, unknown>, id: string): Participant[] {
  return entries(fields, id).flatMap((entry) => {
    const participant = line(entry["value"])
    if (participant === undefined || !PARTICIPANT_ID.test(participant)) return []
    const label = line(entry["label"]) ?? (record(entry["details"]) ? line(entry["details"]["name"]) : undefined)
    const name = label === undefined || holdsContact(label) ? undefined : label
    return [{ id: participant.toLowerCase(), ...(name === undefined ? {} : { name }) }]
  })
}

/** One conversation of a search_conversations answer; undefined without an id. */
function conversationOf(value: Record<string, unknown>): ConversationFacts | undefined {
  const id = idOf(value["id"])
  if (id === undefined) return undefined
  const fields = record(value["fields"]) ? value["fields"] : {}
  const time = timeOf(entries(fields, FIELDS.start)[0]?.["value"])
  // A calendar title can carry a candidate's address or number: masked before it reaches an event.
  const rawTitle = line(entries(fields, FIELDS.title)[0]?.["value"])
  const title = rawTitle === undefined ? undefined : maskContacts(rawTitle)
  const type = line(entries(fields, FIELDS.type)[0]?.["label"])
  const url = typeof value["url"] === "string" && /^https:\/\/\S+$/.test(value["url"]) ? value["url"] : undefined
  return {
    id,
    ...(time === undefined ? {} : { time }),
    ...(title === undefined ? {} : { title }),
    ...(type === undefined ? {} : { type }),
    ...(url === undefined ? {} : { url }),
    candidates: participants(fields, FIELDS.candidate),
    interviewers: participants(fields, FIELDS.interviewer),
  }
}

/** A search_conversations answer as a page; undefined when it is not one. */
export function conversationsPage(result: Result): ConversationsPage | undefined {
  const answer = answerOf(result)
  if (!answer || !Array.isArray(answer["conversations"])) return undefined
  const list = answer["conversations"] as unknown[]
  const conversations = list.flatMap((item) => {
    const conversation = record(item) ? conversationOf(item) : undefined
    return conversation ? [conversation] : []
  })
  const total = typeof answer["total_count"] === "number" && Number.isSafeInteger(answer["total_count"]) ? answer["total_count"] : undefined
  return {
    conversations,
    count: list.length,
    invalid: list.length - conversations.length,
    ...(typeof answer["has_more"] === "boolean" ? { more: answer["has_more"] } : {}),
    ...(total === undefined ? {} : { total }),
  }
}
