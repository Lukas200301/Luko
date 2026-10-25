const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

// "30m", "2h", "1d12h", "1w" → milliseconds; null when the text isn't a duration.
export function parseDuration(text: string): number | null {
  const clean = text.trim().toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+[smhdw])+$/.test(clean)) return null;
  let total = 0;
  for (const [, value, unit] of clean.matchAll(/(\d+)([smhdw])/g)) total += Number(value) * UNITS[unit];
  return total > 0 ? total : null;
}
