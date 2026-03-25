/**
 * Test fixtures for markdown conversion
 * These are anonymized/simplified versions of real Notion API responses
 */

import type { NotionBlock } from "../blocks.ts";

// Helper to create a minimal block with required fields
function createBlock<T extends NotionBlock["type"]>(
  type: T,
  data: Partial<NotionBlock>
): NotionBlock {
  return {
    id: "block-" + Math.random().toString(36).slice(2, 10),
    type,
    created_time: "2024-01-01T00:00:00.000Z",
    last_edited_time: "2024-01-01T00:00:00.000Z",
    created_by: { id: "user-1", object: "user" },
    last_edited_by: { id: "user-1", object: "user" },
    has_children: false,
    archived: false,
    in_trash: false,
    object: "block",
    parent: { type: "page_id", page_id: "page-1" },
    ...data,
  } as NotionBlock;
}

// Helper to create rich text
function richText(text: string, options: {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  link?: string;
} = {}) {
  return {
    type: "text" as const,
    text: {
      content: text,
      link: options.link ? { url: options.link } : null,
    },
    annotations: {
      bold: options.bold ?? false,
      italic: options.italic ?? false,
      strikethrough: options.strikethrough ?? false,
      underline: false,
      code: options.code ?? false,
      color: "default" as const,
    },
    plain_text: text,
    href: options.link ?? null,
  };
}

// Helper to create page mention
function pageMention(pageId: string, title: string) {
  return {
    type: "mention" as const,
    mention: {
      type: "page" as const,
      page: { id: pageId },
    },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default" as const,
    },
    plain_text: title,
    href: `https://www.notion.so/${pageId.replace(/-/g, "")}`,
  };
}

// ============== BLOCK FIXTURES ==============

export const paragraphBlock = createBlock("paragraph", {
  paragraph: {
    rich_text: [richText("This is a simple paragraph.")],
    color: "default",
  },
});

export const paragraphWithFormatting = createBlock("paragraph", {
  paragraph: {
    rich_text: [
      richText("This has "),
      richText("bold", { bold: true }),
      richText(", "),
      richText("italic", { italic: true }),
      richText(", "),
      richText("strikethrough", { strikethrough: true }),
      richText(", and "),
      richText("code", { code: true }),
      richText(" formatting."),
    ],
    color: "default",
  },
});

export const paragraphWithLink = createBlock("paragraph", {
  paragraph: {
    rich_text: [
      richText("Check out "),
      richText("this link", { link: "https://example.com" }),
      richText(" for more info."),
    ],
    color: "default",
  },
});

export const paragraphWithPageMention = createBlock("paragraph", {
  paragraph: {
    rich_text: [
      richText("See the "),
      pageMention("2c3e4ea0-0265-80c8-8670-c7f63e97b0e3", "Statement"),
      richText(" page for details."),
    ],
    color: "default",
  },
});

export const heading1Block = createBlock("heading_1", {
  heading_1: {
    rich_text: [richText("Main Heading")],
    color: "default",
    is_toggleable: false,
  },
});

export const heading2Block = createBlock("heading_2", {
  heading_2: {
    rich_text: [richText("Section Heading")],
    color: "default",
    is_toggleable: false,
  },
});

export const heading3Block = createBlock("heading_3", {
  heading_3: {
    rich_text: [richText("Subsection Heading")],
    color: "default",
    is_toggleable: false,
  },
});

export const bulletedListItems = [
  createBlock("bulleted_list_item", {
    bulleted_list_item: {
      rich_text: [richText("First item")],
      color: "default",
    },
  }),
  createBlock("bulleted_list_item", {
    bulleted_list_item: {
      rich_text: [richText("Second item")],
      color: "default",
    },
  }),
  createBlock("bulleted_list_item", {
    bulleted_list_item: {
      rich_text: [richText("Third item")],
      color: "default",
    },
  }),
];

export const numberedListItems = [
  createBlock("numbered_list_item", {
    numbered_list_item: {
      rich_text: [richText("Open Audit tab")],
      color: "default",
    },
  }),
  createBlock("numbered_list_item", {
    numbered_list_item: {
      rich_text: [richText("Click \"New Audit\"")],
      color: "default",
    },
  }),
  createBlock("numbered_list_item", {
    numbered_list_item: {
      rich_text: [richText("Enter: name, description, and other fields")],
      color: "default",
    },
  }),
];

export const todoItems = [
  createBlock("to_do", {
    to_do: {
      rich_text: [richText("Unchecked task")],
      checked: false,
      color: "default",
    },
  }),
  createBlock("to_do", {
    to_do: {
      rich_text: [richText("Completed task")],
      checked: true,
      color: "default",
    },
  }),
];

export const codeBlock = createBlock("code", {
  code: {
    rich_text: [richText("function hello() {\n  console.log(\"Hello, world!\");\n}")],
    language: "typescript",
    caption: [],
  },
});

export const codeBlockWithCaption = createBlock("code", {
  code: {
    rich_text: [richText("npm install notion-rsync")],
    language: "bash",
    caption: [richText("Install the package")],
  },
});

export const quoteBlock = createBlock("quote", {
  quote: {
    rich_text: [richText("This is a quote block.")],
    color: "default",
  },
});

export const calloutBlock = createBlock("callout", {
  callout: {
    rich_text: [richText("Important note here!")],
    icon: { type: "emoji", emoji: "💡" },
    color: "default",
  },
});

export const dividerBlock = createBlock("divider", {
  divider: {},
});

export const imageBlock = createBlock("image", {
  image: {
    type: "external",
    external: { url: "https://example.com/image.png" },
    caption: [richText("Example image caption")],
  },
});

export const bookmarkBlock = createBlock("bookmark", {
  bookmark: {
    url: "https://github.com/example/repo",
    caption: [richText("Example repository")],
  },
});

export const toggleBlock = createBlock("toggle", {
  toggle: {
    rich_text: [richText("Click to expand")],
    color: "default",
  },
  has_children: true,
  children: [paragraphBlock],
});

export const tableBlock = createBlock("table", {
  table: {
    table_width: 3,
    has_column_header: true,
    has_row_header: false,
  },
  has_children: true,
  children: [
    createBlock("table_row", {
      table_row: {
        cells: [
          [richText("Header 1")],
          [richText("Header 2")],
          [richText("Header 3")],
        ],
      },
    }),
    createBlock("table_row", {
      table_row: {
        cells: [
          [richText("Cell 1")],
          [richText("Cell 2")],
          [richText("Cell 3")],
        ],
      },
    }),
  ],
});

export const childPageBlock = createBlock("child_page", {
  child_page: {
    title: "Child Page Title",
  },
});

export const childDatabaseBlock = createBlock("child_database", {
  child_database: {
    title: "My Database",
  },
});

export const equationBlock = createBlock("equation", {
  equation: {
    expression: "E = mc^2",
  },
});

// ============== MIXED CONTENT FIXTURES ==============

export const mixedContentBlocks: NotionBlock[] = [
  heading1Block,
  paragraphBlock,
  heading2Block,
  ...bulletedListItems,
  paragraphWithFormatting,
  codeBlock,
  dividerBlock,
  quoteBlock,
];

// Document with page links that need resolution
export const documentWithLinks: NotionBlock[] = [
  createBlock("paragraph", {
    paragraph: {
      rich_text: [
        richText("A Clause is an atomic, normalized activity extracted from a "),
        pageMention("2c3e4ea0-0265-80c8-8670-c7f63e97b0e3", "Statement"),
        richText(" - the fundamental unit that gets mapped to Starmaps."),
      ],
      color: "default",
    },
  }),
  createBlock("paragraph", {
    paragraph: {
      rich_text: [
        richText("See also: "),
        pageMention("abc12345-1234-5678-9012-def456789012", "Another Page"),
        richText(" and "),
        richText("external link", { link: "https://example.com" }),
        richText("."),
      ],
      color: "default",
    },
  }),
];
