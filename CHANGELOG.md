# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Two-way sync (`push`)** - Push local markdown back up to Notion. Mirrors the
  folder hierarchy as a Notion page hierarchy and re-creates internal `.md`
  links between files as Notion page mentions. Works for round-trip (files with
  a `notion_id` in frontmatter update their page in place) and brand-new folders
  (pages created under a target parent page, recorded in the sync index).
  - New CLI command: `notion-rsync push [parent-page-id]`.
  - Markdown → Notion conversion: block parser (`markdown/parser.ts`), inline
    rich-text parser (`markdown/inline.ts`), and frontmatter/body extraction
    (`markdown/frontmatter.ts`).
  - Local directory scanner (`local/scan.ts`) and reverse link resolution
    (`local/links.ts`).
  - Notion write client (`notion/writer.ts`) with batched appends; clearing a
    page's content preserves child pages so subpages are never archived.
  - **Idempotent**: after creating pages, `push` stamps the new `notion_id`
    (and title) back into each local file's frontmatter, and materialises an
    `index.md` for folders that lack one. Re-pushing therefore updates pages in
    place instead of creating duplicates. As a fallback, the sync index is also
    consulted by path, so idempotency holds even if frontmatter is removed.

- **CI: release pipeline** - Added `.github/workflows/release.yml` to publish to
  npm on `v*` tags. Re-runs lint/format/test/build, verifies the tag matches
  `package.json`, publishes with npm provenance, and gates the publish step
  behind a protected `release` environment.

### Notes

- Content updates use clear-and-replace (no block-level diffing yet).

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
