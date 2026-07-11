/**
 * ContextFence accepts a deliberately conservative regular-expression subset.
 * The v1 subset has no repetition, grouping, lookaround, backreferences, or
 * alternation. Literals, escapes, anchors, dot, and character classes remain
 * useful while guaranteeing that target-controlled text cannot trigger
 * catastrophic backtracking on the main event loop.
 */
export function isSafeRegularExpression(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > 256) return false;
  let escaped = false;
  let inCharacterClass = false;
  for (const character of pattern) {
    if (escaped) {
      if (!inCharacterClass && /[1-9k]/.test(character)) return false;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[" && !inCharacterClass) {
      inCharacterClass = true;
      continue;
    }
    if (character === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (!inCharacterClass && "*+?{}()|".includes(character)) return false;
  }
  return !escaped && !inCharacterClass;
}
