// Purely presentational: turns a datagen/pitch_grid.py zone label
// ("z{col}_{row}" over a 6x4 grid) into a short, readable description for
// the Tactical Evolution panel. Depth is left-to-right from this team's
// own attacking direction -- "defensive"/"attacking" here means relative
// to the team, not an absolute pitch side.
const DEPTH_LABELS = ["sa surface", "défense profonde", "tiers défensif", "milieu de terrain", "tiers offensif", "dernier tiers"];
const WIDTH_LABELS = ["couloir gauche", "axe gauche", "axe droit", "couloir droit"];

export function describeZone(zoneLabel: string): string {
  const match = /^z(\d+)_(\d+)$/.exec(zoneLabel);
  if (!match) return zoneLabel;
  const col = Number(match[1]);
  const row = Number(match[2]);
  const depth = DEPTH_LABELS[col] ?? zoneLabel;
  const width = WIDTH_LABELS[row] ?? "";
  return width ? `${depth}, ${width}` : depth;
}
