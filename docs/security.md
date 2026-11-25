# Security

## What leaves the machine

The plugin makes no network call of its own. Every Metaview read and write is Metaview's own MCP tool, executed by
OpenCode against the server a person signed in to. What leaves the machine is what those tools send to Metaview, and
nothing else.

## Credentials

Metaview's MCP server holds the credentials. OpenCode adds one MCP server per alias and keys OAuth per server, so the
plugin never sees a token, a refresh token or a password. The plugin stores no credential and prints none.

## Scopes

The plugin requests no OpenCode scope of its own. Metaview's MCP OAuth scopes are the provider's; each sign-in is one
alias, and the workspace's role decides which conversations an account can read.

## Untrusted data

Every page is marked `trust: "untrusted"`. A conversation's title, candidate and interviewer names, and its link are
data: the plugin never follows them, never puts them in `status`, and never uses them to choose a tool or a recipient.
Every event passes through the contract's screening: an item whose JSON holds a credential is refused (`refused[]`,
reason `secret`) and never delivered.

## Candidate data is personal data

The source is metadata only: a conversation's start, its candidate and interviewers by name and Metaview id, and a link
into Metaview. It never carries a transcript, a summary, an AI field, an email, a phone number or a scorecard. Reading
those is the agent's choice through Metaview's own tools, under that tool's permission rule.

## Redaction

`status.nextStep` and every account reason go through the contract's `redactReason`: query values, bearer credentials,
JWTs and token-shaped words are replaced, and the line is cut to 160 characters. Status and logs never carry a URL query
string, a token or a credential.

## Confirmation

The plugin makes no Metaview write of its own: every change is the vendor's MCP tool with its own action. Under
`access: "ask-changes"` every non-read tool asks first; under `"read-only"` it is off. A person's own rule still wins for
one tool. The plugin never widens the level and never works around a rule that asks or denies.

## Reporting

Report a vulnerability through GitHub's private vulnerability reporting on this repository. Do not open a public issue
with a credential, a token or a candidate's data in it.
