/** Near matches for "not found" hints. */
function distance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0] as number;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j] as number;
      dp[j] = Math.min(
        (dp[j] as number) + 1,
        (dp[j - 1] as number) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[b.length] as number;
}

export function nearMatches(query: string, candidates: readonly string[], limit = 3): string[] {
  const q = query.toLowerCase();
  return candidates
    .map((c) => {
      const lc = c.toLowerCase();
      const score = lc.includes(q) || q.includes(lc) ? 0 : distance(q, lc);
      return { c, score };
    })
    .filter((x) => x.score <= Math.max(3, Math.floor(q.length / 2)))
    .sort((a, b) => a.score - b.score || a.c.localeCompare(b.c))
    .slice(0, limit)
    .map((x) => x.c);
}
