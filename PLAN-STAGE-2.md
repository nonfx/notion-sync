# Notion Rsync - Stage 2: Two-Way Sync

## Overview

Stage 2 extends the one-way sync from Stage 1 to support bidirectional synchronization, allowing modifications made to local markdown files to be pushed back to Notion.

**Status**: Future implementation (after Stage 1 is complete and stable)

---

## Scope & Limitations

### The Lossy Problem

Notion → Markdown is inherently **lossy**. Not everything can round-trip:

| Feature | Notion → MD | MD → Notion | Notes |
|---------|-------------|-------------|-------|
| Paragraphs, Headings | ✅ | ✅ | Full support |
| Bold, Italic, Code, Links | ✅ | ✅ | Full support |
| Bulleted/Numbered lists | ✅ | ✅ | Full support |
| To-do checkboxes | ✅ | ✅ | `- [ ]` / `- [x]` |
| Code blocks | ✅ | ✅ | Language preserved |
| Quotes | ✅ | ✅ | `>` blockquotes |
| Dividers | ✅ | ✅ | `---` |
| Tables | ✅ | ✅ | Basic tables |
| Images (external URL) | ✅ | ✅ | `![](url)` |
| **Callouts** | ⚠️ | ❌ | Renders as quote, can't recreate |
| **Toggle blocks** | ⚠️ | ❌ | Renders as `<details>`, can't recreate |
| **Columns** | ⚠️ | ❌ | Flattened, can't recreate layout |
| **Colors/Backgrounds** | ❌ | ❌ | Lost entirely |
| **Mentions (@user)** | ⚠️ | ❌ | Renders as text |
| **Page links** | ⚠️ | ⚠️ | `notion://` URLs, need resolver |
| **Database properties** | ✅ | ❌ | Frontmatter only, read-only |
| **Embeds** | ⚠️ | ⚠️ | URL only, embed type may differ |
| **AI blocks** | ❌ | ❌ | API doesn't support |
| **Synced blocks** | ✅ | ❌ | Resolved content, loses sync |
| **Comments** | ❌ | ❌ | Not exposed in API |
| **File attachments** | ⚠️ | ❌ | URL only, expires |

### What Two-Way Sync WILL Support

1. **Text content changes** - Edit paragraphs, headings, lists, quotes
2. **Add new blocks** - Append new markdown content
3. **Delete blocks** - Remove content (with confirmation)
4. **Reorder blocks** - Move content within a page
5. **Basic formatting** - Bold, italic, code, links, strikethrough

### What Two-Way Sync will NOT Support

1. **Recreating lost features** - Can't turn `<details>` back into toggles
2. **Database property edits** - Frontmatter is read-only
3. **Creating new pages** - Only sync existing pages
4. **Moving pages** - Directory structure is read-only
5. **Rich features** - Callouts, columns, colors, mentions

### Guardrails

To prevent data loss:

1. **Preserve unknown HTML** - Don't delete `<div class="notion-unsupported">` blocks
2. **Warn on lossy edits** - If user edits a toggle's content, warn that toggle formatting will be lost
3. **Block ID tracking** - Map markdown sections to Notion block IDs to enable updates
4. **Dry-run by default** - Show what would change before applying
5. **Backup before sync** - Auto-backup Notion content before pushing changes

### Recommended Workflow

For teams using two-way sync:

1. **Notion is source of truth** for rich content (callouts, toggles, embeds)
2. **Markdown is for text edits** - Fix typos, update docs, add paragraphs
3. **Don't restructure in markdown** - Keep page structure changes in Notion
4. **Review before push** - Always dry-run first

---

## Core Challenges

### 1. Conflict Resolution
When both Notion and local files are modified between syncs, we need to determine which changes take precedence.

**Conflict Scenarios**:
- Same page edited in both locations
- Page moved in Notion, content edited locally
- Page deleted in Notion, edited locally
- Page structure changed in Notion (parent changed)

**Resolution Strategies**:
```
Strategy 1: Last-Write-Wins (LWW)
- Compare timestamps
- Most recent change wins
- Simple but can lose data

Strategy 2: Three-Way Merge
- Track common ancestor state
- Identify changes from both sides
- Merge non-conflicting changes
- Flag true conflicts for user resolution

Strategy 3: Manual Resolution
- Detect conflicts
- Present options to user
- User chooses resolution strategy
- Can set default strategy per conflict type
```

### 2. Notion API Write Operations

Unlike reading, writing to Notion has more constraints:

**Block Operations**:
- Appending children to blocks
- Updating block content
- Deleting blocks
- Reordering blocks (limited)

**Challenges**:
- Cannot directly replace all content (must append or update)
- Need to diff existing blocks vs new content
- Some block types are immutable
- Nested block depth limits

### 3. Markdown to Notion Block Conversion

Reverse of Stage 1: parse markdown and create Notion blocks.

**Parsing Strategy**:
```typescript
// Use markdown AST parser (remark/unified)
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

function parseMarkdownToAST(markdown: string) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown);
}

function astToNotionBlocks(ast: AST): NotionBlock[] {
  // Walk AST and convert to Notion blocks
}
```

**Conversion Challenges**:
- Markdown allows more flexibility than Notion
- Some markdown features don't map to Notion
- Preserving IDs of unchanged blocks
- Handling custom HTML in markdown

### 4. Change Detection

Detect what changed locally since last sync:

**Detection Methods**:

1. **Content-Based Diff**
   ```typescript
   interface FileDiff {
     type: 'added' | 'modified' | 'deleted' | 'unchanged';
     path: string;
     oldChecksum?: string;
     newChecksum?: string;
     oldContent?: string;
     newContent?: string;
   }
   ```

2. **Git Integration** (Optional)
   - Use git to track changes
   - More reliable change detection
   - Can show who made changes
   - Requires git repository

3. **Filesystem Watcher** (Optional)
   - Real-time change detection
   - No need to scan all files
   - Enables continuous sync

## Architecture

### Extended Data Flow

```
┌─────────────────┐         ┌──────────────────┐
│  Local Markdown │◄────────┤  Notion Pages    │
│      Files      │────────►│                  │
└────────┬────────┘         └────────┬─────────┘
         │                           │
         │                           │
         ▼                           ▼
    ┌────────────────────────────────────┐
    │      Sync Engine (Stage 2)         │
    │                                    │
    │  ┌──────────────────────────────┐ │
    │  │   Change Detection           │ │
    │  │  - Local file changes        │ │
    │  │  - Notion page changes       │ │
    │  │  - Timestamp comparison      │ │
    │  └──────────────────────────────┘ │
    │                                    │
    │  ┌──────────────────────────────┐ │
    │  │   Conflict Detection         │ │
    │  │  - Three-way diff            │ │
    │  │  - Identify conflicts        │ │
    │  └──────────────────────────────┘ │
    │                                    │
    │  ┌──────────────────────────────┐ │
    │  │   Merge Strategy             │ │
    │  │  - Apply non-conflicting     │ │
    │  │  - Resolve conflicts         │ │
    │  └──────────────────────────────┘ │
    │                                    │
    │  ┌──────────────────────────────┐ │
    │  │   Bidirectional Update       │ │
    │  │  - Update Notion blocks      │ │
    │  │  - Update local files        │ │
    │  └──────────────────────────────┘ │
    └────────────────────────────────────┘
              │
              ▼
    ┌──────────────────┐
    │   State Store    │
    │  (Index + Diffs) │
    └──────────────────┘
```

### Enhanced State Management

Extend Stage 1 index to track more state:

```json
{
  "version": "2.0.0",
  "root_page_id": "abc123",
  "last_sync": "2026-01-28T10:00:00Z",
  "sync_direction": "bidirectional",
  "pages": {
    "abc123": {
      "path": "index.md",
      "title": "Root Page",
      "last_edited_notion": "2026-01-27T15:30:00Z",
      "last_edited_local": "2026-01-28T09:00:00Z",
      "last_synced_checksum": "sha256hash",
      "last_synced_content": "base64encodedcontent",
      "block_map": {
        "para-1": "notion-block-id-1",
        "para-2": "notion-block-id-2"
      },
      "status": "synced" | "conflict" | "modified_local" | "modified_notion"
    }
  },
  "conflicts": [
    {
      "page_id": "abc123",
      "detected_at": "2026-01-28T10:00:00Z",
      "strategy": "manual",
      "resolved": false
    }
  ]
}
```

## Implementation Phases

### Phase 1: Markdown to Notion Conversion

**Goal**: Convert local markdown changes to Notion blocks

**Tasks**:
1. Implement markdown parser (remark-based)
2. Build AST → Notion blocks converter
3. Handle all block types from Stage 1
4. Test roundtrip conversion (Notion → MD → Notion)

**Key Functions**:
```typescript
// Parse markdown to AST
function parseMarkdown(content: string): MarkdownAST

// Convert AST to Notion blocks
function astToNotionBlocks(ast: MarkdownAST): NotionBlock[]

// Extract frontmatter
function extractFrontmatter(content: string): { 
  metadata: Metadata; 
  content: string; 
}

// Validate block structure
function validateNotionBlocks(blocks: NotionBlock[]): boolean
```

### Phase 2: Block Diffing & Updates

**Goal**: Efficiently update Notion pages with minimal API calls

**Strategies**:

1. **Block Identification**
   - Assign stable IDs to markdown content
   - Map markdown sections to Notion block IDs
   - Track ID mapping in index

2. **Diff Algorithm**
   ```typescript
   interface BlockDiff {
     operation: 'insert' | 'update' | 'delete' | 'move';
     blockId?: string;  // For update/delete
     position?: number; // For insert/move
     content?: NotionBlock;
   }
   
   function diffBlocks(
     oldBlocks: NotionBlock[], 
     newBlocks: NotionBlock[]
   ): BlockDiff[]
   ```

3. **Update Operations**
   ```typescript
   // Update single block
   async function updateBlock(
     blockId: string, 
     content: NotionBlock
   ): Promise<void>
   
   // Append new blocks
   async function appendBlocks(
     parentId: string, 
     blocks: NotionBlock[]
   ): Promise<void>
   
   // Delete blocks
   async function deleteBlocks(
     blockIds: string[]
   ): Promise<void>
   
   // Replace all content (delete + append)
   async function replacePageContent(
     pageId: string, 
     blocks: NotionBlock[]
   ): Promise<void>
   ```

### Phase 3: Change Detection

**Goal**: Detect what changed since last sync

**Local Change Detection**:
```typescript
interface LocalChanges {
  added: string[];      // New files
  modified: string[];   // Changed files
  deleted: string[];    // Deleted files
  renamed: Array<{      // Moved/renamed files
    from: string;
    to: string;
  }>;
}

async function detectLocalChanges(): Promise<LocalChanges>
```

**Implementation Options**:

1. **Checksum Comparison** (Simple)
   - Compare current checksums vs index
   - Fast for small repos
   - Scans all files

2. **Git Integration** (Advanced)
   ```typescript
   // Use git diff to find changes
   async function getGitChanges(
     since: string  // commit hash or timestamp
   ): Promise<LocalChanges>
   ```

3. **File System Watcher** (Real-time)
   ```typescript
   // Watch for file changes
   import { watch } from 'fs';
   
   function watchFiles(
     directory: string, 
     onChange: (changes: LocalChanges) => void
   ): void
   ```

### Phase 4: Conflict Detection & Resolution

**Goal**: Handle simultaneous edits gracefully

**Conflict Detection**:
```typescript
interface Conflict {
  pageId: string;
  type: 'content' | 'structure' | 'deletion';
  localChange: Change;
  notionChange: Change;
  ancestor?: string;  // Last synced state
}

function detectConflicts(
  localChanges: LocalChanges,
  notionChanges: NotionChanges,
  index: SyncIndex
): Conflict[]
```

**Resolution Strategies**:

1. **Automatic Resolution**
   ```typescript
   enum ResolutionStrategy {
     LOCAL_WINS = 'local',
     NOTION_WINS = 'notion',
     LAST_WRITE_WINS = 'lww',
     MERGE = 'merge',
     MANUAL = 'manual'
   }
   
   async function resolveConflict(
     conflict: Conflict,
     strategy: ResolutionStrategy
   ): Promise<Resolution>
   ```

2. **Three-Way Merge** (Advanced)
   ```typescript
   // Merge non-conflicting changes
   function threeWayMerge(
     ancestor: string,
     local: string,
     notion: string
   ): MergeResult
   
   interface MergeResult {
     success: boolean;
     merged?: string;
     conflicts?: ConflictMarker[];
   }
   ```

3. **Interactive Resolution**
   ```typescript
   // Present conflict to user
   async function promptConflictResolution(
     conflict: Conflict
   ): Promise<Resolution>
   
   // CLI interface:
   // ? Conflict detected in "page.md"
   // > Use local version
   //   Use Notion version  
   //   Open merge tool
   //   Skip this file
   ```

### Phase 5: Bidirectional Sync Engine

**Goal**: Orchestrate complete two-way sync

**Sync Flow**:
```typescript
async function syncBidirectional(): Promise<SyncResult> {
  // 1. Fetch current state
  const localState = await scanLocalFiles();
  const notionState = await fetchNotionPages();
  
  // 2. Load last sync state
  const index = await loadIndex();
  
  // 3. Detect changes
  const localChanges = detectLocalChanges(localState, index);
  const notionChanges = detectNotionChanges(notionState, index);
  
  // 4. Detect conflicts
  const conflicts = detectConflicts(
    localChanges, 
    notionChanges, 
    index
  );
  
  // 5. Resolve conflicts
  const resolutions = await resolveConflicts(
    conflicts, 
    config.conflictStrategy
  );
  
  // 6. Apply changes
  await applyNotionChanges(notionChanges, resolutions);
  await applyLocalChanges(localChanges, resolutions);
  
  // 7. Update index
  await updateIndex(localState, notionState);
  
  // 8. Return summary
  return {
    success: true,
    localUpdated: localChanges.length,
    notionUpdated: notionChanges.length,
    conflicts: conflicts.length,
    resolved: resolutions.length
  };
}
```

### Phase 6: Advanced Features

**Goal**: Enhance usability and robustness

**Features**:

1. **Dry-Run Mode**
   ```bash
   bun run notion-rsync sync --dry-run --direction both
   # Shows what would be synced without making changes
   ```

2. **Selective Sync**
   ```bash
   # Only sync specific paths
   bun run notion-rsync sync --include "docs/**" --exclude "drafts/**"
   ```

3. **Conflict Management**
   ```bash
   # List conflicts
   bun run notion-rsync conflicts list
   
   # Resolve specific conflict
   bun run notion-rsync conflicts resolve <page-id> --strategy local
   
   # Resolve all with strategy
   bun run notion-rsync conflicts resolve-all --strategy lww
   ```

4. **History & Rollback**
   ```bash
   # Show sync history
   bun run notion-rsync history
   
   # Rollback to previous state
   bun run notion-rsync rollback --to <timestamp>
   ```

5. **Backup Before Sync**
   ```bash
   # Auto-backup before sync
   bun run notion-rsync sync --backup
   
   # Backup location: .notion-rsync/backups/
   ```

## Configuration

Extend Stage 1 config with two-way options:

```json
{
  "version": "2.0.0",
  "notion": {
    "token": "secret_xxx",
    "rootPageId": "abc123"
  },
  "sync": {
    "direction": "bidirectional",  // "notion-to-local" | "local-to-notion" | "bidirectional"
    "conflictStrategy": "manual",  // "local" | "notion" | "lww" | "merge" | "manual"
    "autoResolve": false,
    "backupBeforeSync": true
  },
  "local": {
    "outputDir": "./docs",
    "gitIntegration": true,  // Use git for change detection
    "watchMode": false       // Real-time sync
  },
  "filters": {
    "include": ["**/*.md"],
    "exclude": ["drafts/**", "*.draft.md"]
  }
}
```

## Technical Considerations

### Performance

**Optimization Strategies**:
1. Only fetch changed pages from Notion
2. Use git for local change detection (faster than full scan)
3. Batch Notion API calls
4. Parallel processing where possible
5. Cache intermediate results

**Rate Limiting**:
- Notion API: 3 requests/second
- Implement request queue with rate limiting
- Exponential backoff on errors

### Data Integrity

**Ensuring Consistency**:
1. Atomic operations where possible
2. Transaction-like approach (prepare → validate → apply)
3. Rollback on partial failures
4. Checksum validation
5. Backup before destructive operations

**Edge Cases**:
- Network failures mid-sync
- Notion API errors
- File system errors (permissions, disk full)
- Concurrent modifications during sync
- Large files/pages

### Testing Strategy

**Test Scenarios**:
1. Local file modified, sync to Notion
2. Notion page modified, sync to local
3. Both modified, conflict detection
4. File deleted locally, page exists in Notion
5. Page deleted in Notion, file exists locally
6. File renamed locally
7. Page moved in Notion
8. New file created locally
9. New page created in Notion
10. Merge conflicts

**Test Tools**:
- Mock Notion API for unit tests
- Test Notion workspace for integration tests
- Automated conflict scenarios
- Performance benchmarks

## Migration from Stage 1

Users running Stage 1 can upgrade to Stage 2:

```bash
# Migrate index to v2 format
bun run notion-rsync migrate --from-version 1

# Enable bidirectional sync
bun run notion-rsync config set sync.direction bidirectional

# First sync in two-way mode (dry-run recommended)
bun run notion-rsync sync --dry-run
```

**Breaking Changes**:
- Index format changes (v1 → v2)
- New required config fields
- API changes if used as library

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data loss from bad conflict resolution | High | Automatic backups, dry-run mode, manual review |
| Corruption from interrupted sync | Medium | Atomic operations, transaction-like approach |
| Performance degradation | Low | Optimization, caching, parallel processing |
| API rate limiting | Low | Request queuing, backoff strategy |
| Notion API changes | Medium | Version pinning, adapter pattern |

## Success Criteria

- ✅ Local changes pushed to Notion correctly
- ✅ Conflicts detected accurately
- ✅ User can resolve conflicts manually
- ✅ Automatic resolution works for common cases
- ✅ No data loss in any scenario
- ✅ Performance acceptable for 500+ pages
- ✅ Clear feedback on sync status
- ✅ Easy rollback on issues

## Open Questions

1. **Block ID Stability**: How to maintain stable IDs across syncs?
2. **Notion Schema Changes**: How to handle when Notion adds new block types?
3. **Partial Sync**: Should we support syncing only changed sections of a page?
4. **Multi-User**: How to handle multiple users syncing same pages?
5. **Notion Database Properties**: Should we sync database properties bidirectionally?

## Timeline Estimate

- **Phase 1-2**: 3-4 weeks (Markdown → Notion conversion)
- **Phase 3-4**: 3-4 weeks (Change detection & conflict resolution)
- **Phase 5**: 2-3 weeks (Bidirectional engine)
- **Phase 6**: 2-3 weeks (Advanced features)
- **Testing & Refinement**: 2-3 weeks

**Total**: 12-17 weeks (approximately 3-4 months)

**Dependencies**: Stage 1 must be complete and stable before starting Stage 2

---

**Note**: Stage 2 is significantly more complex than Stage 1 due to conflict resolution and bidirectional sync challenges. Recommend thorough testing and gradual rollout with opt-in beta period.
