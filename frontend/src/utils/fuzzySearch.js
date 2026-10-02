/**
 * Search-as-you-type with typo tolerance ("Did you mean …?"), done in the browser.
 *
 *   searchItems(items, 'kris')     -> names starting with "kris" first, then names containing it
 *   searchItems(items, 'krisyan')  -> no direct match -> corrected to "kristan":
 *                                     { matches: [Kristan …], suggestion: 'kristan' }
 *
 * items: [{ id, label, terms: ['first', 'last', 'student id', …] }]
 */

/** Lowercase, strip accents (é -> e, ñ -> n), collapse spaces. */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words of a text: "Dela Cruz, Juan" -> ['dela', 'cruz', 'juan']. */
export function words(text) {
  return normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Optimal string alignment distance: insertions, deletions, substitutions and swapping two
 * neighbouring letters ("kirs" -> "kris") each cost 1. Stops early above `max`.
 */
export function editDistance(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prevPrev = null;
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prevPrev && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + 1);
      }
      cur.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[cols - 1];
}

/** Typos allowed for a word of this length: 1-3 letters none, 4-5 one, 6+ two. */
export function allowedTypos(length) {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  return 2;
}

function itemWords(item) {
  if (!item._words) item._words = [...new Set([item.label, ...(item.terms || [])].flatMap(words))];
  return item._words;
}

/** 0 = every query word starts a word of the item, 1 = all found somewhere, null = no match. */
function directScore(item, queryWords, queryText) {
  const itemTokens = itemWords(item);
  if (queryWords.every((q) => itemTokens.some((t) => t.startsWith(q)))) return 0;
  const haystack = normalize([item.label, ...(item.terms || [])].join(' '));
  if (queryWords.every((q) => haystack.includes(q)) || haystack.includes(queryText)) return 1;
  return null;
}

/**
 * Closest known word to a misspelled query word, or null.
 * Compares with whole words and with word beginnings ("kristn" ~ "krist…"), so a typo in the
 * first letters of a long name is still found. Numbers (Student IDs) must match exactly.
 */
function correctWord(queryWord, vocabulary) {
  if (/^\d+$/.test(queryWord)) return null;
  const max = allowedTypos(queryWord.length);
  if (!max) return null;
  let best = null;
  let bestDistance = max + 1;
  for (const word of vocabulary) {
    if (/^\d+$/.test(word)) continue;
    let distance = editDistance(queryWord, word, max);
    if (distance > max && word.length > queryWord.length) {
      distance = editDistance(queryWord, word.slice(0, queryWord.length), max);
    }
    // Prefer fewer typos, then the word whose length is closest to what was typed.
    if (distance < bestDistance || (distance === bestDistance && best && Math.abs(word.length - queryWord.length) < Math.abs(best.length - queryWord.length))) {
      best = word;
      bestDistance = distance;
    }
  }
  return bestDistance <= max ? best : null;
}

/**
 * @returns {{ matches: object[], suggestion: string|null }}
 *   matches    best first (at most `limit`)
 *   suggestion the corrected search text when the typed text had no direct match
 */
export function searchItems(items, query, { limit = 8 } = {}) {
  const queryText = normalize(query);
  const queryWords = words(query);
  if (!queryWords.length) return { matches: [], suggestion: null };

  const rank = (wordsToFind, text) => items
    .map((item, index) => ({ item, index, score: directScore(item, wordsToFind, text) }))
    .filter((row) => row.score !== null)
    .sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label) || a.index - b.index)
    .slice(0, limit)
    .map((row) => row.item);

  const direct = rank(queryWords, queryText);
  if (direct.length) return { matches: direct, suggestion: null };

  // Nothing matched as typed: correct each word against the names that exist, like
  // "Did you mean …?" in a search engine.
  const vocabulary = new Set(items.flatMap(itemWords));
  let changed = false;
  const corrected = queryWords.map((word) => {
    if ([...vocabulary].some((v) => v.startsWith(word))) return word;
    const fix = correctWord(word, vocabulary);
    if (fix && fix !== word) { changed = true; return fix; }
    return word;
  });
  if (!changed) return { matches: [], suggestion: null };
  const suggestion = corrected.join(' ');
  return { matches: rank(corrected, suggestion), suggestion };
}
