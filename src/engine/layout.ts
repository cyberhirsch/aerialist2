/**
 * Layout helpers — first slice of the PRD layout engine.
 * Greedy word-wrap using real font metrics (1/1000-em units).
 */

/**
 * Wrap text into lines no wider than maxWidthEm (1/1000-em units).
 * `measure` returns the width of a string in the target font, or null
 * if it can't be measured (treated as fitting, so text is never lost).
 * A single word wider than the limit gets its own overflowing line.
 */
export function wrapText(
  text: string,
  measure: (s: string) => number | null,
  maxWidthEm: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    const width = measure(candidate)
    if (width === null || width <= maxWidthEm || !current) {
      current = candidate
      continue
    }
    lines.push(current)
    current = word
  }
  if (current) lines.push(current)
  return lines
}
