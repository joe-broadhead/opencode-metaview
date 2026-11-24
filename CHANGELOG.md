# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.0.0 (unreleased)

The first release under the new name and organization.

### Changed

- Renamed to `@we-the-rebel-alliance/metaview-plugin` and restarted the version at `0.0.0`.
- Supports OpenCode 2.4.1 exactly (`>=2.4.1 <2.5.0`), tested on 2.4.1 only.
- The Code Mode namespace line and skill descriptions are within the fixed-context budget: at most 400 and 300
  characters.
- Packaged as a single `ci` job on Node 24.

### Removed

- The Jelly guide, `docs/jelly.md`.
- The collection source and its `events_list` and `probe` methods; the plugin registers Metaview's native tools only.
