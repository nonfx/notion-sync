# Notion Rsync

One-way sync from Notion pages to local markdown files. Idempotent.

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
├── notion/          # Notion API client (TODO)
├── markdown/        # Block → Markdown conversion (TODO)
├── sync/            # Sync engine, state tracking
│   ├── engine.ts    # Main sync orchestration
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
