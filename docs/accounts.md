# Accounts

Several aliases at once, each signed in separately.

<!-- generated:accounts -->
Accounts are held by the **mcp** mechanism: the vendor's MCP server holds them.

The profile has no fields.
<!-- /generated:accounts -->

## Sign in

The mechanism is `mcp`: Metaview's own MCP server holds the credentials. OpenCode adds one server per alias, named
`metaview` for `default` and `metaview-work` / `metaview-personal` for the other aliases. Each server has its own OAuth,
so two aliases are two independent sessions. Run `/connect` and choose the server, or in a terminal:

```sh
opencode mcp auth metaview
opencode mcp auth metaview-work
```

Each alias can belong to a different Metaview workspace, because the workspace is decided at sign-in.

## Picking an account

Pass `account: "<alias>"` on `probe` and `events_list`. `status` takes no account: it reports every alias, and
`register` refuses an `account` field on it as `INPUT_INVALID`. Metaview's pass-through tools are named per server, so
the agent picks the alias by the server prefix (`metaview_` for the first account, `metaview-work_` for `work`).

With two aliases and no account, a call is refused with `ACCOUNT_REQUIRED`, whose next step lists the aliases. An alias
the plugin does not serve is `ACCOUNT_UNKNOWN`.

Cursors are bound to the account. A cursor issued for `work` and passed with `personal` is `CURSOR_INVALID`, never a
silent restart.

## Status

`status` lists every alias in the order the options name them, with `ready`, `needs_sign_in` or `error`. A failure's
reason is one line of at most 160 characters, with query values, bearer credentials and token-shaped words replaced.
