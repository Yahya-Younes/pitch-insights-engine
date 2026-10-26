// Modulo indexing always lands in range, but noUncheckedIndexedAccess can't
// prove that -- the first entries double as typed fallbacks.
const DEFAULT_PALETTE: [string, string] = ["#1d4ed8", "#1e3a8a"];
const PALETTES: [string, string][] = [
  DEFAULT_PALETTE,
  ["#dc2626", "#7f1d1d"],
  ["#059669", "#065f46"],
  ["#d97706", "#92400e"],
  ["#7c3aed", "#4c1d95"],
  ["#0891b2", "#164e63"],
  ["#db2777", "#831843"],
  ["#4f46e5", "#312e81"],
];

const DEFAULT_SHIELD = "M16 1 29 6V16C29 24 23 29 16 31 9 29 3 24 3 16V6Z";
const SHIELD_VARIANTS = [
  DEFAULT_SHIELD,
  "M16 1 29 5V15C29 25 23 30 16 31 9 30 3 25 3 15V5Z",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function initials(name: string): string {
  const words = name.split(" ").filter(Boolean);
  const first = words[0];
  const last = words[words.length - 1];
  if (!first || !last) return "?";
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

export interface Crest {
  initials: string;
  colorA: string;
  colorB: string;
  shieldPath: string;
}

export function teamCrest(name: string): Crest {
  const h = hashString(name);
  const [colorA, colorB] = PALETTES[h % PALETTES.length] ?? DEFAULT_PALETTE;
  const shieldPath = SHIELD_VARIANTS[h % SHIELD_VARIANTS.length] ?? DEFAULT_SHIELD;
  return { initials: initials(name), colorA, colorB, shieldPath };
}
