# Configuration

The options and their defaults, generated from `capabilities.options`.

<!-- generated:configuration -->
| Option | Type | Default | Description |
|---|---|---|---|
| `access` | `all` \| `ask-changes` \| `read-only` | `"all"` | How much the plugin's methods and Metaview's pass-through tools may do. |
| `accounts` | object | — | One profile per account alias; each alias has its own Metaview MCP server and sign-in. |
| `allowUntestedHost` | boolean | `false` | Start outside the tested OpenCode range. |
<!-- /generated:configuration -->

## Configure two accounts

```json
{
  "access": "ask-changes",
  "accounts": {
    "work": {},
    "personal": {}
  },
  "allowUntestedHost": false
}
```

- `access` is the ceiling. `all` runs every read and every Metaview tool, `ask-changes` asks before a non-read, and
  `read-only` refuses one. It applies to the plugin's methods and to Metaview's pass-through tools.
- `accounts` is one profile per alias. Metaview decides the workspace at sign-in, so a profile has no fields; the alias
  is the name the MCP server and the permission resource use.
- `allowUntestedHost` starts the plugin outside `>=2.4.1 <2.5.0`. Leave it `false`: the plugin refuses an untested host
  with `HOST_UNTESTED` and a next step.

## Narrow one tool

A rule in an agent's own `permissions` wins for one action. Metaview's tools are permitted per alias, as
`metaview_<tool>` for the first account and `metaview-<alias>_<tool>` for the others. The plugin's own methods are
`metaview.<method>`.

```json
{
  "permissions": [
    { "action": "metaview.events_list", "resource": "*", "effect": "deny" },
    { "action": "metaview-work_create_snippet", "resource": "*", "effect": "ask" }
  ]
}
```

Replace either action with the method or tool from the capabilities table. A rule that names no real action changes
nothing.
