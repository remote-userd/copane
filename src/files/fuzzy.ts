export interface FuzzyMatch {
  item: string
  score: number
  /** Indices into item that matched, for highlighting. */
  positions: number[]
}

const isBoundary = (s: string, i: number) => i === 0 || "/\\_-. ".includes(s[i - 1]!) || (s[i]! >= "A" && s[i]! <= "Z" && s[i - 1]! >= "a" && s[i - 1]! <= "z")

/**
 * Subsequence match with bonuses for word/path boundaries, consecutive runs,
 * and matches in the file name. Returns null when the query is not a subsequence.
 */
export function fuzzyScore(query: string, item: string): FuzzyMatch | null {
  if (!query) return { item, score: 0, positions: [] }
  const q = query.toLowerCase().replace(/\s+/g, "")
  const s = item.toLowerCase()
  const nameStart = Math.max(item.lastIndexOf("/"), item.lastIndexOf("\\")) + 1
  const positions: number[] = []
  let score = 0
  let si = 0
  let prev = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!
    // Prefer a boundary occurrence if one exists before the next plain occurrence's run breaks.
    let found = -1
    for (let j = si; j < s.length; j++) {
      if (s[j] !== ch) continue
      if (found === -1) found = j
      if (j === prev + 1 || isBoundary(item, j)) {
        found = j
        break
      }
    }
    if (found === -1) return null
    let bonus = 1
    if (found === prev + 1) bonus += 5
    if (isBoundary(item, found)) bonus += 8
    if (found >= nameStart) bonus += 3
    bonus -= Math.min(3, (found - si) * 0.1)
    score += bonus
    positions.push(found)
    prev = found
    si = found + 1
  }
  // Shorter paths win ties; exact file-name prefix gets a big boost.
  score -= item.length * 0.05
  if (item.slice(nameStart).toLowerCase().startsWith(q)) score += 15
  return { item, score, positions }
}

export function fuzzyFilter(query: string, items: readonly string[], limit = 200): FuzzyMatch[] {
  const out: FuzzyMatch[] = []
  for (const item of items) {
    const m = fuzzyScore(query, item)
    if (m) out.push(m)
  }
  out.sort((a, b) => b.score - a.score || a.item.localeCompare(b.item))
  return out.slice(0, limit)
}
