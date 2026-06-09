# TODO - Notion Rsync

## Phase 1: Project Setup

- [x] Initialize Bun project with package.json
- [x] Configure TypeScript (tsconfig.json)
- [x] Set up OXLint configuration
- [x] Set up OXFmt for formatting
- [x] Create project directory structure
- [x] Add .gitignore and .env.example
- [x] Install core dependencies
- [x] Create basic CLI entry point
- [x] Verify all tools work together (lint, format, run)

## Phase 2: Notion API Integration

- [x] Create Notion client wrapper
- [x] Implement page fetching
- [x] Implement block fetching with pagination
- [x] Implement page tree traversal
- [x] Support databases as root (query entries as pages)
- [x] Support nested databases (child_database blocks)
- [x] Parallel fetching with concurrency limit
- [x] Handle unsupported block types gracefully (ai_block, etc.)
- [x] Test with real Notion database

## Phase 3: Markdown Conversion

- [x] Set up markdown writer
- [x] Convert basic blocks (paragraph, headings)
- [x] Convert lists (bulleted, numbered, to-do)
- [x] Convert code blocks
- [x] Convert rich text (bold, italic, strikethrough, code, links)
- [x] Convert tables
- [x] Convert callouts and quotes
- [x] Handle images and files (images, video, file, pdf)
- [x] Convert toggle blocks (details/summary)
- [x] Convert equations (inline and block)
- [x] Handle embeds, bookmarks, link previews
- [x] Handle column layouts
- [x] Handle synced blocks
- [x] Add "do not edit" header to generated files

## Phase 4: File System Operations

- [x] Implement directory structure creation
- [x] Implement file naming/slugification
- [x] Add frontmatter support (notion_id, title, last_edited)
- [x] Add database properties to frontmatter (all property types)
- [x] Handle file writing with proper encoding
- [x] Handle unique filenames for duplicates
- [x] Pages with children become directories with index.md

## Phase 5: Sync Engine

- [x] Create state index structure
- [x] Implement sync execution (pull and overwrite)
- [x] Add idempotency (safe to run repeatedly)
- [x] Handle deleted pages (remove stale local files)

## Phase 6: CLI Interface

- [x] Add `init` command
- [x] Add `sync` command  
- [x] Add `status` command
- [x] Add --dry-run support

## Phase 7: npm Publishing

- [x] Move @notionhq/client to devDependencies (bundled into dist)
- [x] Add build script using Bun bundler (target: node, format: esm)
- [x] Update CLI to use process.argv (Node.js compatible)
- [x] Change shebang to #!/usr/bin/env node
- [x] Create .npmignore
- [x] Add GitHub Actions CI workflow
- [x] Update README with correct package/CLI names
- [x] Publish to npm as `notion-rsync`

## Current: Polish

- [x] Render unsupported blocks as HTML with metadata (maintain relationships)

---

## Stage 2: Two-Way Sync (Future)

See [PLAN-STAGE-2.md](./PLAN-STAGE-2.md) for full details.

### Phase 2.1: Markdown to Notion Conversion
- [x] Implement Markdown parser (hand-rolled, zero deps — `markdown/parser.ts`)
- [x] Build markdown → Notion block-request converter
- [x] Handle the block types Stage 1 emits + common hand-authored markdown
- [x] Inline parser for rich text (`markdown/inline.ts`): bold/italic/strike/code/links/equations/mentions
- [x] Frontmatter + body extraction (`markdown/frontmatter.ts`)

### Phase 2.2: Block Diffing & Updates
- [x] Notion write client (`notion/writer.ts`): create/setTitle/clearBlocks/appendBlocks
- [x] Batch appends (100/req) and recursive append for deep nesting
- [x] Preserve child_page/child_database on clear (don't archive subpages)
- [ ] True block-level diffing (currently clear-and-replace content blocks)

### Phase 2.3: Change Detection
- [ ] Checksum-based local change detection
- [ ] Optional git integration for change detection
- [ ] Detect added/modified/deleted/renamed files

### Phase 2.4: Conflict Detection & Resolution
- [ ] Detect simultaneous edits
- [ ] Implement resolution strategies (LWW, merge, manual)
- [ ] Three-way merge for non-conflicting changes
- [ ] Interactive conflict resolution CLI

### Phase 2.5: Bidirectional Sync Engine
- [x] Local directory scanner → page tree (`local/scan.ts`)
- [x] Reverse link resolution: relative `.md` links → page mentions (`local/links.ts`)
- [x] Push engine (`sync/push.ts`): create/update pages, mirror folder hierarchy, resolve links
- [x] `push` CLI command (round-trip via frontmatter ids, or brand-new under a target page)
- [x] Update index after push
- [ ] Atomic operations with rollback

### Phase 2.6: Advanced Features
- [ ] Selective sync (include/exclude patterns)
- [ ] Sync history and rollback
- [ ] Backup before sync
- [ ] Watch mode (real-time sync)

---

## Learnings

> Concise, specific learnings from each completed task. Updated iteratively.

### Phase 1 Learnings

1. **Bun init is opinionated** - `bun init -y` creates tsconfig.json, .gitignore, and index.ts automatically. Good defaults but may need customization.

2. **OXLint/OXFmt as dev deps** - Install with `bun add -d oxlint oxfmt` to avoid relying on global installs. Bun finds binaries in node_modules/.bin automatically.

3. **OXLint default rules are strict** - Categories like `pedantic` and `style` enforce things like `sort-keys`, `func-style`, `no-magic-numbers`. For pragmatic code, stick to `correctness`, `suspicious`, and `perf`.

4. **Practical OXLint config** - Disable overly strict rules:
   ```json
   {
     "categories": { "correctness": "error", "suspicious": "warn", "perf": "warn" },
     "rules": {
       "func-style": "off",
       "sort-keys": "off",
       "no-magic-numbers": "off",
       "unicorn/no-null": "off"
     }
   }
   ```

5. **Bun.file() for file ops** - Use `Bun.file(path)` and `Bun.write(path, content)` instead of Node's fs. Cleaner API.

6. **parseArgs from util** - Node's built-in `util.parseArgs` works great for simple CLIs. No need for commander/yargs for basic use cases.

7. **Import JSON in Bun** - Can directly `import { version } from "../package.json"` - Bun handles it natively.

8. **TypeScript strict mode** - Enable `noUncheckedIndexedAccess` for safer array/object access. Catches bugs early.

9. **Project structure** - Separate concerns early: `src/notion/`, `src/markdown/`, `src/sync/`, `src/utils/`. Makes code navigable.

10. **CLI skeleton first** - Build the CLI structure with stub functions before implementing logic. Validates the interface early.

### Phase 7 Learnings

1. **Bun bundler for npm** - Use `bun build --target node --format esm` to create a single bundled JS file that works with both Node.js and Bun. Much smaller than compiled binaries (~350KB vs ~60MB).

2. **Shebang matters** - Use `#!/usr/bin/env node` for npm packages (not `#!/usr/bin/env bun`). Bun respects it and Node.js requires it.

3. **process.argv over Bun.argv** - For Node.js compatibility, use `process.argv` instead of `Bun.argv`. Both work in Bun.

4. **--outdir not --outfile** - Bun's `--outfile` flag has issues with path handling. Use `--outdir` instead.

5. **prepublishOnly hook** - Add `"prepublishOnly": "bun run build"` to ensure the package is always built before publishing.

6. **npm bin naming** - The `bin` field maps command names to scripts. Package name and CLI name can differ.

### Phase 2 Learnings

1. **@notionhq/client has great utilities** - `collectPaginatedAPI` and `iteratePaginatedAPI` handle pagination automatically. No need to write cursor logic.

2. **Type guards are essential** - `isFullPage()`, `isFullBlock()`, `isFullDatabase()` narrow types properly. Partial responses are common.

3. **Blocks can be nested** - `has_children` indicates nested content. Must fetch recursively for full content.

4. **Page title is in properties** - Not a top-level field. Look for property with `type === "title"`.

5. **Attach children to blocks** - Extend block type with `children?: NotionBlock[]` for easier tree traversal later.

6. **Tree structure simplifies sync** - `PageNode` with `id`, `title`, `children`, `blocks` makes traversal and diffing straightforward.

7. **Databases vs Pages** - Notion API distinguishes between pages and databases. A database URL returns an error if you call `pages.retrieve()`. Detect via error message containing "is a database" and fall back to `databases.retrieve()` + `databases.query()`.

8. **Nested databases via child_database blocks** - Pages can contain `child_database` blocks. Use `fetchChildren()` to get both `child_page` and `child_database` blocks, then recurse into databases.

9. **Parallel fetching with concurrency** - Sequential fetches are too slow for large workspaces. Use `Promise.all` with a concurrency limiter (e.g., 5 concurrent requests) to speed up without hitting rate limits.

10. **Unsupported block types** - Some blocks (e.g., `ai_block`) throw API errors. Catch and skip gracefully with a warning rather than failing the entire sync.

11. **Database properties are rich** - Pages from databases have properties (select, multi_select, date, people, etc.). Extract these for frontmatter using a switch on `prop.type`.

12. **Property value extraction** - Each property type has different structure. Handle all types: rich_text, number, select, multi_select, status, date, checkbox, url, email, phone_number, formula, relation, rollup, people, files, created_time, created_by, last_edited_time, last_edited_by, unique_id.

13. **Databases in column layouts** - Databases embedded inside column blocks (or other container blocks like toggles) aren't returned by `fetchChildren()`. Need to recursively scan all blocks with `has_children` to find `child_database` blocks nested anywhere in the page structure.

14. **Rate limiting is real** - Notion API returns 429 errors with parallel requests. Reduce concurrency (5 → 2) and add retry with exponential backoff. The `Retry-After` header indicates how long to wait.

15. **Inline databases need context** - When rendering `child_database` blocks, the block renderer doesn't have access to the database's entries. Solution: build a `RenderContext` from the page's children that maps database IDs to their entries, then pass it through the rendering pipeline. This allows inline databases to render as tables showing page titles and properties.

### Stage 2 Learnings (Markdown → Notion / `push`)

1. **Two-pass page creation** - Create all pages first (top-down so parents exist), then push content. Internal links resolve to page mentions only once every target page has an id, so content must come after the full hierarchy exists.

2. **Never clear child_page blocks** - In Notion, subpages appear as `child_page` blocks in the parent. `clearBlocks` before re-pushing content MUST skip `child_page`/`child_database`, otherwise it archives the very subpages being synced. Big data-loss footgun.

3. **Page mentions need existing pages** - Rich-text page mentions (`{ mention: { page: { id } } }`) require the referenced page to already exist. The two-pass approach guarantees this. Mentions are how we re-create internal links (symmetric with the reader emitting `notion://<id>`).

4. **Reverse link resolution mirrors the forward pass** - Forward sync turns `notion://<id>` → relative `.md` paths; push does the inverse on the raw markdown string (relative `.md` → `notion://<id>`) before block parsing. Keeping it a string transform keeps it symmetric and simple.

5. **`index.md` ⇄ directory page** - A directory's `index.md` is that directory's page; its siblings/subdirs are children. A root-level `index.md` roots the whole tree. Folders without an `index.md` get a synthesized page so they can still hold children.

6. **Frontmatter `notion_id` drives update-vs-create** - Round-trip files carry `notion_id`; those pages are updated in place. Files without it (brand-new folders) are created under a target parent page. This makes "edit locally and push back" and "upload a fresh folder" the same code path.

7. **Hand-rolled Markdown parser over remark** - The project has zero runtime deps and bundles for npm. A line-based parser covering the constructs the reader emits (plus common GFM) keeps it dependency-free and round-trips reliably. The triple-marker `***bold italic***` case needs explicit handling before `**` to avoid mis-splitting.

8. **Notion code `language` is an enum** - Unknown languages are rejected by the API. Normalize to the valid set and fall back to `plain text` (mapping common aliases like `ts`→`typescript`).

9. **Injectable writer for testing** - The push engine takes a `NotionWriter` interface; tests use an in-memory fake to verify hierarchy, content, and link resolution with no network/token. The real impl wraps `@notionhq/client`.
