# Notion Rsync

Sync between Notion pages and local markdown files. Idempotent.

- **Pull** (`sync`): Notion → local markdown (Stage 1).
- **Push** (`push`): local markdown → Notion, mirroring folder hierarchy and
  re-creating internal links as page mentions (Stage 2). Works for round-trip
  (files with `notion_id` frontmatter) and brand-new folders.

## Stack

- **Runtime**: Bun (not Node)
- **Language**: TypeScript (strict mode)
- **Linting**: OXLint
- **Formatting**: OXFmt

## Commands

```bash
bun run dev          # Run CLI
bun run lint         # Lint with oxlint
bun run format       # Format with oxfmt
bun run test         # Run tests
```

## Project Structure

```
src/
├── cli.ts           # CLI entry point
├── notion/          # Notion API client
│   ├── client.ts    # Read operations (pages, blocks, databases)
│   ├── tree.ts      # Build page tree from Notion
│   └── writer.ts    # Write operations (create/update pages, append blocks)
├── markdown/        # Block ↔ Markdown conversion
│   ├── blocks.ts    # Notion block → Markdown (pull)
│   ├── rich-text.ts # Notion rich text → Markdown (pull)
│   ├── links.ts     # notion:// → relative path (pull)
│   ├── parser.ts    # Markdown → Notion blocks (push)
│   ├── inline.ts    # Markdown → Notion rich text (push)
│   └── frontmatter.ts # Parse frontmatter + body (push)
├── local/           # Local markdown tree (push source)
│   ├── scan.ts      # Directory → page tree
│   └── links.ts     # relative path → notion:// (push)
├── sync/            # Sync engines, state tracking
│   ├── engine.ts    # Pull orchestration (Notion → local)
│   ├── push.ts      # Push orchestration (local → Notion)
│   ├── partial.ts   # Sync specific pages by id
│   ├── init.ts      # Initialize config
│   ├── index.ts     # State index for idempotency
│   └── status.ts    # Show sync status
└── utils/
    └── logger.ts    # Leveled logging
```

## Key Files

- `TODO.md` - Current tasks and learnings
- `PLAN.md` - Stage 1 implementation plan
- `PLAN-STAGE-2.md` - Future two-way sync plan

## Code Style

- Pragmatic over pedantic
- Use `Bun.file()` and `Bun.write()` for file I/O
- Use `null` where appropriate (not forced `undefined`)
- Function declarations are fine (no forced arrow functions)

## Environment

Requires `NOTION_TOKEN` env var for API access.
