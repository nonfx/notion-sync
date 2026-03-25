# Changelog

All notable changes to this project will be documented in this file.

## [0.1.5] - 2026-01-29

### Changed

- **Package metadata** - Added repository, homepage, and bugs URLs to package.json for npm page
- **README improvements** - Added npm badges, quick links, contributing section, and updated roadmap

## [0.1.4] - 2026-01-29

### Added

- **Inline database tables** - Embedded databases (`child_database` blocks) now render as markdown tables showing page titles and properties, instead of just a link. Tables include up to 3 property columns for readability.

## [0.1.3] - 2026-01-29

### Fixed

- **Link resolution** - Internal page links (mentions) are now resolved to relative local markdown paths instead of `notion://` URLs. Links between pages in the same directory use `./`, links across directories use proper relative paths like `../other/page.md`.

- **List formatting** - Removed extra blank lines between consecutive list items. Bulleted, numbered, and todo lists now render correctly without double-spacing.

### Added

- **Unit tests** - Added 56 tests for markdown conversion covering blocks, rich text, and link resolution.

## [0.1.2] - 2026-01-28

### Fixed

- **Nested database discovery** - Databases embedded inside column layouts, toggles, and other container blocks are now correctly discovered and synced. Previously, only top-level databases were found.

- **Rate limit handling** - Added retry with exponential backoff for Notion API rate limits (429 errors). Respects the `Retry-After` header when provided. Reduced default concurrency from 5 to 2 to minimize rate limiting.

## [0.1.1] - 2026-01-27

### Changed

- Switched from compiled Bun binary to bundled JS for npm compatibility
- Package now works with both Node.js (>=18) and Bun
- Changed CLI shebang from `#!/usr/bin/env bun` to `#!/usr/bin/env node`

## [0.1.0] - 2026-01-27

### Added

- Initial release
- One-way sync from Notion pages/databases to local Markdown files
- CLI commands: `init`, `sync`, `status`
- Support for all common Notion block types
- Frontmatter with Notion metadata and database properties
- Idempotent sync with state tracking
- Stale file cleanup (removes deleted pages)
- `--dry-run` mode for previewing changes
- Unsupported blocks rendered as HTML comments with metadata
