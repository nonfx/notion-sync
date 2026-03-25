# Notion Rsync - Implementation Plan

## Project Overview

**Goal**: Create a robust, idempotent synchronization tool between a Notion page hierarchy and a local markdown file tree.

**Stage 1 (Current)**: One-way sync from Notion to local markdown files  
**Stage 2 (Future)**: Two-way sync supporting bidirectional updates

## Technology Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Linting**: OXLint
- **Formatting**: OXFmt
- **Notion API**: @notionhq/client
- **Markdown Parsing**: markdown-it or unified (remark)

## Architecture Analysis (Reference: sourcegraph/notionreposync)

### Key Learnings from Reference Implementation

The sourcegraph/notionreposync project (written in Go) provides valuable architectural patterns:

1. **Repository Structure**
   - Tree-based representation (Folders → Documents)
   - Path tracking relative to root
   - Document ID mapping to Notion page IDs

2. **Core Flow**
   ```
   CLI Input → Notion Client → Fetch Page Metadata → 
   Sync Pages DB → Walk Repository → Convert MD → Append Blocks
   ```

3. **Pages Database Pattern**
   - Creates inline database in root Notion page
   - Tracks: Title, _path (original file path), _rev (version)
   - Enables stable page IDs across syncs

4. **Markdown to Notion Conversion**
   - Uses AST walker (goldmark in Go)
   - Converts AST nodes to Notion blocks
   - Handles nested structures carefully (depth limits)
   - Link resolution for internal cross-references

5. **Block Update Strategy**
   - Batches blocks to respect API limits
   - Handles depth limits (max 2 levels of nesting per API call)
   - Currently appends only (doesn't update existing)

6. **Link Resolution**
   - Resolves relative markdown links to Notion page IDs
   - External links pass through unchanged
   - Non-markdown files link to code views

## Stage 1: One-Way Sync (Notion → Markdown)

### Phase 1: Project Setup

**Goal**: Establish project foundation with proper tooling

**Tasks**:
- [x] Initialize bun project with TypeScript
- [ ] Configure OXLint with strict rules
- [ ] Configure OXFmt for consistent formatting
- [ ] Set up project structure
- [ ] Add @notionhq/client dependency
- [ ] Add markdown processing library (remark/unified)
- [ ] Configure TypeScript with strict mode
- [ ] Create .gitignore and .env.example
- [ ] Set up basic CLI structure (using commander or similar)

**File Structure**:
```
notion-rsync/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── index.ts            # Main export
│   ├── config.ts           # Configuration management
│   ├── notion/
│   │   ├── client.ts       # Notion API client wrapper
│   │   ├── pages.ts        # Page operations
│   │   ├── blocks.ts       # Block fetching & parsing
│   │   └── types.ts        # Notion type definitions
│   ├── markdown/
│   │   ├── writer.ts       # Markdown file writer
│   │   ├── converter.ts    # Notion blocks → Markdown
│   │   └── types.ts        # Markdown structure types
│   ├── sync/
│   │   ├── engine.ts       # Main sync orchestration
│   │   ├── tree.ts         # Page tree representation
│   │   ├── index.ts        # Index management (state tracking)
│   │   └── diff.ts         # Change detection
│   └── utils/
│       ├── logger.ts       # Logging utility
│       ├── errors.ts       # Custom error types
│       └── paths.ts        # Path utilities
├── tests/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── oxlint.json
└── README.md
```

### Phase 2: Notion API Integration

**Goal**: Fetch and parse Notion page hierarchies

**Core Operations**:

1. **Page Fetching**
   ```typescript
   interface PageNode {
     id: string;
     title: string;
     type: 'page' | 'database';
     parentId: string | null;
     children: PageNode[];
     lastEditedTime: string;
   }
   
   async function fetchPageTree(pageId: string): Promise<PageNode>
   ```

2. **Block Fetching**
   - Recursively fetch all blocks in a page
   - Handle pagination (max 100 blocks per request)
   - Parse block types (paragraph, heading, list, code, etc.)

3. **Block Type Support** (Priority order)
   - Phase 2.1: Basic blocks
     - Paragraph
     - Headings (1-3)
     - Code blocks
     - Bulleted lists
     - Numbered lists
     - Blockquotes
   - Phase 2.2: Rich blocks
     - Tables
     - Callouts
     - Toggles
     - Dividers
   - Phase 2.3: Media blocks
     - Images (download or link)
     - Files (link)
     - Embeds (convert to links)

4. **Rich Text Parsing**
   ```typescript
   interface RichText {
     text: string;
     annotations: {
       bold?: boolean;
       italic?: boolean;
       strikethrough?: boolean;
       underline?: boolean;
       code?: boolean;
     };
     link?: string;
   }
   ```

### Phase 3: Markdown Conversion

**Goal**: Convert Notion blocks to clean, idiomatic markdown

**Conversion Rules**:

1. **Text Formatting**
   - Bold: `**text**`
   - Italic: `*text*`
   - Strikethrough: `~~text~~`
   - Code: `` `code` ``
   - Links: `[text](url)`

2. **Block Types**
   - Heading 1: `# Title`
   - Heading 2: `## Title`
   - Heading 3: `### Title`
   - Paragraph: Plain text with blank lines
   - Code: Fenced code blocks with language
   - Lists: Proper markdown lists with nesting
   - Blockquote: `> text`
   - Divider: `---`

3. **Special Handling**
   - Tables: GitHub-flavored markdown tables
   - Callouts: Convert to blockquotes with emoji prefix
   - Toggles: Convert to collapsible details (HTML)
   - Nested blocks: Proper indentation

4. **Link Management**
   - Internal page links: Convert to relative paths
   - External links: Preserve as-is
   - Anchor links: Generate from heading slugs

### Phase 4: File System Operations

**Goal**: Write markdown files with proper structure

**Operations**:

1. **Directory Structure**
   ```
   output/
   ├── index.md              # Root page
   ├── page-1.md
   ├── page-2.md
   └── subfolder/
       ├── index.md          # Database or parent page
       ├── child-1.md
       └── child-2.md
   ```

2. **File Naming Strategy**
   - Sanitize page titles for filenames
   - Use slugified titles: `My Page Title` → `my-page-title.md`
   - Handle duplicates with suffix: `page-1.md`, `page-2.md`
   - Use `index.md` for parent pages

3. **Metadata Frontmatter**
   ```yaml
   ---
   notion_id: abc123
   title: Original Page Title
   last_synced: 2026-01-28T10:00:00Z
   last_edited: 2026-01-27T15:30:00Z
   ---
   ```

### Phase 5: Sync Engine & State Management

**Goal**: Implement idempotent sync with change detection

**State Tracking**:

1. **Index File** (`.notion-rsync/index.json`)
   ```json
   {
     "version": "1.0.0",
     "root_page_id": "abc123",
     "last_sync": "2026-01-28T10:00:00Z",
     "pages": {
       "abc123": {
         "path": "index.md",
         "title": "Root Page",
         "last_edited": "2026-01-27T15:30:00Z",
         "checksum": "sha256hash"
       }
     }
   }
   ```

2. **Change Detection**
   - Compare `last_edited_time` from Notion
   - Compare local file checksums
   - Determine: add, update, delete, no-change

3. **Sync Strategy**
   ```typescript
   type SyncAction = 'create' | 'update' | 'delete' | 'skip';
   
   interface SyncPlan {
     actions: Array<{
       action: SyncAction;
       pageId: string;
       path: string;
       reason: string;
     }>;
   }
   
   async function planSync(): Promise<SyncPlan>
   async function executeSync(plan: SyncPlan): Promise<void>
   ```

4. **Conflict Resolution**
   - Stage 1 is read-only from Notion
   - Local changes are overwritten (with warning)
   - Option to backup before sync

### Phase 6: CLI Interface

**Goal**: User-friendly command-line interface

**Commands**:

```bash
# Initialize sync
bun run notion-rsync init <notion-page-id> --output ./docs

# Perform sync
bun run notion-rsync sync

# Check status without syncing
bun run notion-rsync status

# Configuration
bun run notion-rsync config set notion-token <token>
bun run notion-rsync config set output-dir ./docs
```

**CLI Options**:
- `--dry-run`: Show what would be synced without changes
- `--force`: Ignore cache and re-sync everything
- `--verbose`: Detailed logging
- `--output <dir>`: Output directory
- `--include-metadata`: Add frontmatter to markdown files

**Environment Variables**:
- `NOTION_TOKEN`: Notion integration token (required)
- `NOTION_PAGE_ID`: Root page ID (can be in config file)

### Phase 7: Error Handling & Logging

**Goal**: Robust error handling and useful diagnostics

**Error Scenarios**:
1. Invalid Notion token
2. Page not accessible
3. Network failures
4. Rate limiting
5. File system errors
6. Invalid page structure

**Logging Levels**:
- `error`: Critical failures
- `warn`: Non-critical issues (e.g., unsupported block types)
- `info`: Sync progress, summary
- `debug`: Detailed operations (--verbose)

**Error Recovery**:
- Retry logic with exponential backoff
- Partial sync continuation after errors
- Clear error messages with suggestions

### Phase 8: Testing & Documentation

**Goal**: Ensure reliability and usability

**Testing Strategy**:

1. **Unit Tests**
   - Block conversion functions
   - Link resolution
   - Path sanitization
   - Checksum calculation

2. **Integration Tests**
   - Mock Notion API responses
   - Full sync workflow
   - Change detection

3. **E2E Tests**
   - Real Notion workspace (test pages)
   - Complete sync cycles

**Documentation**:

1. **README.md**
   - Quick start guide
   - Installation instructions
   - Configuration examples
   - Common use cases

2. **ARCHITECTURE.md**
   - System design
   - Data flow diagrams
   - Extension points

3. **API.md**
   - Library usage (for programmatic use)
   - Type definitions
   - Examples

4. **CONTRIBUTING.md**
   - Development setup
   - Code style guide
   - Testing requirements
   - PR process

## Implementation Priorities

### Must Have (v0.1.0)
- [x] Project setup with Bun + TypeScript
- [ ] Notion API client integration
- [ ] Basic block types (paragraph, heading, list)
- [ ] Markdown conversion
- [ ] File writing with proper structure
- [ ] Simple CLI (init, sync)
- [ ] State tracking for idempotency
- [ ] Basic error handling

### Should Have (v0.2.0)
- [ ] Rich block types (tables, callouts, code)
- [ ] Internal link resolution
- [ ] Dry-run mode
- [ ] Progress indicators
- [ ] Better error messages
- [ ] Configuration file

### Nice to Have (v0.3.0)
- [ ] Image downloading
- [ ] Incremental sync optimization
- [ ] Watch mode (continuous sync)
- [ ] Multiple root pages
- [ ] Custom templates
- [ ] Hooks for pre/post processing

## Technical Considerations

### Notion API Limits
- **Rate Limit**: 3 requests per second
- **Block Children**: Max 100 per request (requires pagination)
- **Request Size**: Unknown, but should batch operations

### Idempotency Strategy
1. **State-based**: Track last sync state in index file
2. **Checksum-based**: Verify file content hasn't changed
3. **Timestamp-based**: Use Notion's `last_edited_time`

### Performance Optimizations
1. **Parallel Fetching**: Fetch multiple pages concurrently (respect rate limits)
2. **Caching**: Cache Notion responses during single sync run
3. **Incremental Updates**: Only process changed pages
4. **Lazy Loading**: Only fetch blocks for changed pages

### Edge Cases
1. **Circular References**: Prevent infinite loops in page trees
2. **Large Pages**: Handle pages with 1000+ blocks
3. **Special Characters**: Sanitize filenames properly
4. **Duplicate Titles**: Handle multiple pages with same name
5. **Deleted Pages**: Clean up orphaned markdown files
6. **Empty Pages**: Generate minimal markdown files

## Dependencies

### Core
- `@notionhq/client` - Official Notion SDK
- `commander` - CLI framework
- `chalk` - Terminal colors
- `ora` - Loading spinners

### Markdown
- `remark` - Markdown processing
- `remark-gfm` - GitHub-flavored markdown
- `unified` - Text processing framework

### Utilities
- `dotenv` - Environment variables
- `fs-extra` - Enhanced file system operations
- `gray-matter` - Frontmatter parsing
- `slugify` - URL-safe slug generation

### Development
- `@types/node` - Node.js types
- `oxlint` - Fast linter
- `bun:test` - Built-in test runner
- `typescript` - Type checking

## Success Metrics

### Functionality
- ✅ Successfully syncs nested page hierarchy
- ✅ Preserves formatting (bold, italic, links)
- ✅ Handles all basic block types
- ✅ Idempotent (multiple runs produce same result)
- ✅ Detects and syncs only changes

### Performance
- ✅ Syncs 100 pages in < 30 seconds
- ✅ Respects Notion API rate limits
- ✅ Minimal memory footprint

### Usability
- ✅ Clear CLI interface
- ✅ Helpful error messages
- ✅ Progress feedback
- ✅ Easy configuration

### Quality
- ✅ 80%+ test coverage
- ✅ No TypeScript errors
- ✅ Passes OXLint checks
- ✅ Well-documented code

## Development Phases Timeline

### Week 1-2: Foundation
- Project setup
- Notion API integration
- Basic block fetching

### Week 3-4: Core Conversion
- Markdown conversion engine
- File system operations
- Basic sync logic

### Week 5-6: Robustness
- State management
- Error handling
- Testing

### Week 7-8: Polish
- CLI refinement
- Documentation
- Performance optimization

## References

- **Notion API Docs**: https://developers.notion.com/
- **Reference Implementation**: https://github.com/sourcegraph/notionreposync
- **Markdown Spec**: https://spec.commonmark.org/
- **GFM Spec**: https://github.github.com/gfm/

---

**Next Steps**: See PLAN-STAGE-2.md for two-way sync implementation details.
