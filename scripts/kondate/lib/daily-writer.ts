import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { MealType } from "./empty-slots";
import type { MenuResult } from "./generate-menu";

const DEFAULT_BASE_DIR = "/workspaces/life/aspects/diet/daily";

export function mealTypeToSection(m: MealType): string {
  switch (m) {
    case "朝": return "朝食";
    case "昼": return "昼食";
    case "晩": return "夕食";
  }
}

export interface AppendParams {
  date: string;
  mealType: MealType;
  start: string;
  end: string;
  menu: MenuResult;
  baseDir?: string;
}

function buildMealSection(params: AppendParams): string {
  const section = mealTypeToSection(params.mealType);
  const { menu, start, end } = params;
  const { p, f, c, kcal } = menu.estimated_pfc;

  const ingredientLines = menu.ingredients
    .map((i) => `- ${i.name} ${i.amount}`)
    .join("\n");

  return [
    `## ${section} ${start}-${end}`,
    menu.menu_name,
    ingredientLines,
    `- ~${kcal} kcal | P: ${p}g | F: ${f}g | C: ${c}g`,
    "",
  ].join("\n");
}

export function appendDailyMealEntry(params: AppendParams): void {
  const baseDir = params.baseDir ?? DEFAULT_BASE_DIR;
  const filePath = join(baseDir, `${params.date}.md`);
  const section = mealTypeToSection(params.mealType);

  let content: string;

  if (!existsSync(filePath)) {
    content = `# ${params.date}\n\n`;
  } else {
    content = readFileSync(filePath, "utf-8");
  }

  // Check if section already exists (e.g. "## 夕食 ")
  if (content.includes(`## ${section} `)) {
    // Do not overwrite
    return;
  }

  // Ensure content ends with newline before appending
  if (!content.endsWith("\n")) {
    content += "\n";
  }

  content += buildMealSection(params);

  writeFileSync(filePath, content, "utf-8");
}
