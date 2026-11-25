# Security policy

Report a vulnerability through GitHub's private vulnerability reporting on this repository. Do not open a public issue
with a credential, a token or a candidate's data in it.

Include the OpenCode version, the plugin version (`status` reports it), the account alias, and the smallest reproduction
you can. A report is acknowledged within seven days. A confirmed issue is fixed on a branch and released as a new tag;
the release notes say what changed.

This plugin never stores a credential. Metaview's MCP server holds the sign-in; OpenCode keys it per account server. If a
credential is exposed, revoke the Metaview sign-in in the Metaview workspace and sign in again.
