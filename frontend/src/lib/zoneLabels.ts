// Purely presentational: turns a datagen/pitch_grid.py zone label
// ("z{col}_{row}" over a 6x4 grid) into a short, readable description for
// the Tactical Evolution panel. Depth is left-to-right from this team's
// own attacking direction -- "defensive"/"attacking" here means relative
// to the team, not an absolute pitch side.
import type { I18n } from "../i18n";

const DEPTHS = 6;
const WIDTHS = 4;

export function describeZone(i18n: I18n, zoneLabel: string): string {
  const match = /^z(\d+)_(\d+)$/.exec(zoneLabel);
  if (!match) return zoneLabel;
  const col = Number(match[1]);
  const row = Number(match[2]);
  if (col >= DEPTHS) return zoneLabel;
  const depth = i18n.t(`panels.zone.depth.${col}`);
  if (row >= WIDTHS) return depth;
  return i18n.t("panels.zone.format", { depth, width: i18n.t(`panels.zone.width.${row}`) });
}
