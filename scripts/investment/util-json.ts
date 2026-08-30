/**
 * Claude 出力から JSON を取り出すユーティリティ。
 *
 * Claude は時々 ```json ... ``` のフェンスや前置きを付けてくる。
 * 最初に出現する { から対応する } までを抽出してパースする。
 */

export function extractJson(text: string): unknown {
  const stripped = text.replace(/```json\s*/g, "").replace(/```\s*$/g, "").trim();
  const start = stripped.indexOf("{");
  const arrayStart = stripped.indexOf("[");
  let firstBracket = -1;
  let opener = "{";
  let closer = "}";
  if (start !== -1 && (arrayStart === -1 || start < arrayStart)) {
    firstBracket = start;
  } else if (arrayStart !== -1) {
    firstBracket = arrayStart;
    opener = "[";
    closer = "]";
  }
  if (firstBracket === -1) throw new Error(`No JSON object/array found in:\n${text}`);

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBracket; i < stripped.length; i++) {
    const c = stripped[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === opener) depth++;
    else if (c === closer) {
      depth--;
      if (depth === 0) {
        const slice = stripped.slice(firstBracket, i + 1);
        return JSON.parse(slice);
      }
    }
  }
  throw new Error(`Unterminated JSON in:\n${text}`);
}
