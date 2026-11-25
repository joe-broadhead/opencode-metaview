# Contributing

The plugin follows [the plugin standard](https://github.com/we-the-rebel-alliance/plugin-contract/blob/master/docs/plugin-standard.md);
where this file is silent, the standard and [the contract](https://github.com/we-the-rebel-alliance/plugin-contract/blob/master/docs/contract.md)
decide.

## Set up

```sh
npm ci --ignore-scripts
npm run check
```

`npm run check` runs the lint, typecheck, bundle, tests, `plugin-kit check` and `plugin-kit docs --check`. It needs
Node 24. The tests use Node's own test runner.

## Change the plugin

1. Change the `capabilities` manifest in `package.json` first: a method, source or action, its class, its operations and
   its accounts.
2. Write the handler in `src/handlers/`, with the Metaview call in `src/provider/`.
3. Add unit tests. For a read that a consumer binds to, record the conformance fixture with
   `npx plugin-kit record --account <alias>` from two signed-in accounts, or `npm run fixtures` for the deterministic
   fake server.
4. Run `npm run docs`, then `npm run check`.
5. Open a pull request against `master`. Never push to `master` and never merge.

## Install from a release

A consumer installs a released tag:

```sh
opencode plugin add github:we-the-rebel-alliance/metaview-plugin#v0.0.0
```

## Report a problem

Open an issue with the OpenCode version, the plugin version (`status` reports it), the account alias and the error's
first line. Never include a credential, a token or a candidate's data.
