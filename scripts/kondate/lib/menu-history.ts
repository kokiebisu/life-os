import { existsSync, readFileSync, writeFileSync } from "fs";

export type HistoryEntry = {
  date: string;
  menu: string;
  url: string;
  cuisine: string;
};

// Matches lines like: - [メニュー名](URL)（菜系）
const ENTRY_RE = /^- \[([^\]]+)\]\(([^)]+)\)（([^）]+)）/;
// Matches section headers like: ## YYYY-MM-DD
const DATE_HEADER_RE = /^## (\d{4}-\d{2}-\d{2})$/;

export function readHistory(path: string): HistoryEntry[] {
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n");
  const entries: HistoryEntry[] = [];
  let currentDate: string | null = null;

  for (const line of lines) {
    const dateMatch = line.match(DATE_HEADER_RE);
    if (dateMatch) {
      currentDate = dateMatch[1];
      continue;
    }

    if (currentDate) {
      const entryMatch = line.match(ENTRY_RE);
      if (entryMatch) {
        entries.push({
          date: currentDate,
          menu: entryMatch[1],
          url: entryMatch[2],
          cuisine: entryMatch[3],
        });
      }
    }
  }

  return entries;
}

export function appendHistoryEntry(path: string, entry: HistoryEntry): void {
  const newSection = `## ${entry.date}\n- [${entry.menu}](${entry.url})（${entry.cuisine}）\n`;

  if (!existsSync(path)) {
    writeFileSync(path, `# 自動生成メニュー履歴\n\n${newSection}`);
    return;
  }

  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n");

  // Find the index of the first ## date section (or end of header block)
  let insertIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (DATE_HEADER_RE.test(lines[i])) {
      insertIndex = i;
      break;
    }
  }

  if (insertIndex === -1) {
    // No existing date sections — append after header block
    const trimmed = content.trimEnd();
    writeFileSync(path, `${trimmed}\n\n${newSection}`);
  } else {
    // Insert new section before first existing date section
    const before = lines.slice(0, insertIndex).join("\n");
    const after = lines.slice(insertIndex).join("\n");
    const separator = before.trimEnd().length > 0 ? "\n\n" : "\n";
    writeFileSync(path, `${before.trimEnd()}${separator}${newSection}\n${after}`);
  }
}
