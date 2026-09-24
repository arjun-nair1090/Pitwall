export interface Searchable {
  label: string;
  keywords?: readonly string[];
}

const normalize = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();

// Lower is better; null means no match.
function score(query: string, item: Searchable): number | null {
  const label = normalize(item.label);
  if (label.startsWith(query)) return 0;
  if (label.split(/[\s\-–—/]+/).some((word) => word.startsWith(query))) return 1;
  if (label.includes(query)) return 2;
  const keywords = (item.keywords ?? []).map(normalize);
  if (keywords.some((k) => k.startsWith(query))) return 3;
  if (keywords.some((k) => k.includes(query))) return 4;
  return null;
}

export function rankMatches<T extends Searchable>(query: string, items: readonly T[], limit = Infinity): T[] {
  const q = normalize(query);
  if (!q) return items.slice(0, limit);
  return items
    .map((item, index) => ({ item, index, score: score(q, item) }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}
