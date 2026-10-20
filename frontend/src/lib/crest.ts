const PALETTES: [string, string][] = [
  ["#1d4ed8", "#1e3a8a"],
  ["#dc2626", "#7f1d1d"],
  ["#059669", "#065f46"],
  ["#d97706", "#92400e"],
  ["#7c3aed", "#4c1d95"],
  ["#0891b2", "#164e63"],
  ["#db2777", "#831843"],
  ["#4f46e5", "#312e81"],
];

const SHIELD_VARIANTS = [
  "M16 1 29 6V16C29 24 23 29 16 31 9 29 3 24 3 16V6Z",
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
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export interface Crest {
  initials: string;
  colorA: string;
  colorB: string;
  shieldPath: string;
}

export function teamCrest(name: string): Crest {
  const h = hashString(name);
  const [colorA, colorB] = PALETTES[h % PALETTES.length];
  const shieldPath = SHIELD_VARIANTS[h % SHIELD_VARIANTS.length];
  return { initials: initials(name), colorA, colorB, shieldPath };
}
