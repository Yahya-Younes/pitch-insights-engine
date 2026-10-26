// Small deterministic force-directed layout for the player relations graph.
// Pure functions (no DOM, no randomness): the same input always yields the same
// output, so they are trivially unit-testable and replay-safe.

export interface Point {
  x: number;
  y: number;
}

export interface LayoutNode {
  id: string;
  team: "home" | "away";
  radius: number;
  /** Pitch coordinates (120x80) used to seed and anchor the layout. */
  pitchX: number;
  pitchY: number;
}

export interface LayoutLink {
  source: string;
  target: string;
  /** Interaction volume (pass/duel count). Heavier links pull harder and sit closer. */
  weight: number;
}

export interface LayoutBox {
  width: number;
  height: number;
  /** Inner margin kept free of nodes. */
  padding: number;
}

export interface ForceOptions {
  iterations?: number;
  /** Warm start (previous positions) for nodes that already exist -- keeps transitions calm. */
  initial?: ReadonlyMap<string, Point>;
  /** Pull home to the left third and away to the right third. Default: true when both teams are present. */
  teamClustering?: boolean;
}

export const PITCH_LENGTH = 120;
export const PITCH_WIDTH = 80;

/** Pitch rectangle (120x80 aspect) centred in the box. */
export function pitchRect(box: LayoutBox): { x: number; y: number; width: number; height: number } {
  const availW = box.width - 2 * box.padding;
  const availH = box.height - 2 * box.padding;
  const scale = Math.min(availW / PITCH_LENGTH, availH / PITCH_WIDTH);
  const width = PITCH_LENGTH * scale;
  const height = PITCH_WIDTH * scale;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

/** Maps 120x80 pitch coordinates into the pitch rectangle of the box. */
export function pitchToBox(px: number, py: number, box: LayoutBox): Point {
  const r = pitchRect(box);
  const cx = Math.min(Math.max(px, 0), PITCH_LENGTH);
  const cy = Math.min(Math.max(py, 0), PITCH_WIDTH);
  return { x: r.x + (cx / PITCH_LENGTH) * r.width, y: r.y + (cy / PITCH_WIDTH) * r.height };
}

/** Deterministic hash of a string to [0, 1). */
export function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function clampInto(p: Point, r: number, box: LayoutBox): void {
  const minX = box.padding + r;
  const maxX = box.width - box.padding - r;
  const minY = box.padding + r;
  const maxY = box.height - box.padding - r;
  p.x = minX > maxX ? box.width / 2 : Math.min(Math.max(p.x, minX), maxX);
  p.y = minY > maxY ? box.height / 2 : Math.min(Math.max(p.y, minY), maxY);
}

/** Pushes overlapping circles apart (in place). Returns true if anything moved. */
export function resolveCollisions(
  nodes: readonly LayoutNode[], pos: Map<string, Point>, box: LayoutBox, gap = 6, passes = 1,
): boolean {
  let moved = false;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (!a) continue;
      const pa = pos.get(a.id);
      if (!pa) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (!b) continue;
        const pb = pos.get(b.id);
        if (!pb) continue;
        const min = a.radius + b.radius + gap;
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1e-6) {
          // Coincident: split along a deterministic angle.
          const ang = hashUnit(a.id + b.id) * Math.PI * 2;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const push = (min - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        pa.x -= ux * push;
        pa.y -= uy * push;
        pb.x += ux * push;
        pb.y += uy * push;
        clampInto(pa, a.radius, box);
        clampInto(pb, b.radius, box);
        moved = true;
      }
    }
  }
  return moved;
}

/**
 * Where each player "belongs" in the force layout: his average pitch spot,
 * squeezed into his team's half of the box when both teams are shown (home
 * left, away right) so the two shapes don't overlap but keep their structure.
 */
export function anchorPositions(
  nodes: readonly LayoutNode[], box: LayoutBox, splitTeams: boolean,
): Map<string, Point> {
  const out = new Map<string, Point>();
  const innerW = box.width - 2 * box.padding;
  for (const n of nodes) {
    const p = pitchToBox(n.pitchX, n.pitchY, box);
    if (splitTeams) {
      const frac = Math.min(Math.max(n.pitchX / PITCH_LENGTH, 0), 1);
      const half = innerW / 2;
      const gutter = innerW * 0.04;
      const x0 = n.team === "home" ? box.padding : box.padding + half + gutter;
      p.x = x0 + frac * (half - gutter);
    }
    out.set(n.id, p);
  }
  return out;
}

/** Initial positions: warm start when available, else the anchor plus a tiny deterministic offset. */
export function seedPositions(
  nodes: readonly LayoutNode[], anchors: ReadonlyMap<string, Point>, initial?: ReadonlyMap<string, Point>,
): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const n of nodes) {
    const warm = initial?.get(n.id);
    if (warm) {
      out.set(n.id, { x: warm.x, y: warm.y });
      continue;
    }
    const p = anchors.get(n.id) ?? { x: 0, y: 0 };
    const ang = hashUnit(n.id) * Math.PI * 2;
    out.set(n.id, { x: p.x + Math.cos(ang) * 3, y: p.y + Math.sin(ang) * 3 });
  }
  return out;
}

/**
 * Runs the simulation synchronously and returns final positions (in box pixels).
 * Forces: link springs weighted by count, pairwise charge repulsion, team
 * clustering (home left / away right), anchor to the pitch spot, collision.
 */
export function computeForceLayout(
  nodes: readonly LayoutNode[], links: readonly LayoutLink[], box: LayoutBox, opts: ForceOptions = {},
): Map<string, Point> {
  const iterations = opts.iterations ?? 300;
  const teams = new Set(nodes.map((n) => n.team));
  const cluster = opts.teamClustering ?? teams.size > 1;
  const anchors = anchorPositions(nodes, box, cluster);
  const pos = seedPositions(nodes, anchors, opts.initial);
  if (nodes.length === 0) return pos;

  const vel = new Map<string, Point>(nodes.map((n) => [n.id, { x: 0, y: 0 }]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const maxW = Math.max(1, ...links.map((l) => l.weight));

  const innerW = box.width - 2 * box.padding;
  const innerH = box.height - 2 * box.padding;
  const area = innerW * innerH;
  const charge = Math.max(2500, (area / Math.max(nodes.length, 1)) * 0.45);
  const centerX = box.width / 2;
  const centerY = box.height / 2;
  const baseLen = Math.min(innerW, innerH * 1.6) * 0.22;
  const homeX = box.padding + innerW * 0.27;
  const awayX = box.padding + innerW * 0.73;

  // Only keep links whose endpoints exist, and precompute their spring parameters.
  // Strength is divided by the smaller endpoint degree (as d3 does) so dense
  // passing networks don't collapse into a ball.
  const valid = links.filter((l) => l.source !== l.target && byId.has(l.source) && byId.has(l.target));
  const degree = new Map<string, number>();
  for (const l of valid) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  const springs = valid.flatMap((l) => {
    const a = byId.get(l.source);
    const b = byId.get(l.target);
    if (!a || !b) return [];
    const w = l.weight / maxW;
    const rest = a.radius + b.radius + baseLen * (1 - 0.45 * w);
    const k = (0.25 + 0.75 * w) / Math.max(1, Math.min(degree.get(a.id) ?? 1, degree.get(b.id) ?? 1));
    return [{ a: a.id, b: b.id, rest, k }];
  });

  const alphaMin = 0.001;
  const alphaDecay = 1 - Math.pow(alphaMin, 1 / iterations);
  const velocityDecay = 0.55;
  let alpha = 1;

  for (let it = 0; it < iterations; it++) {
    // Link springs.
    for (const s of springs) {
      const pa = pos.get(s.a);
      const pb = pos.get(s.b);
      const va = vel.get(s.a);
      const vb = vel.get(s.b);
      if (!pa || !pb || !va || !vb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const f = ((d - s.rest) / d) * s.k * alpha;
      va.x += dx * f * 0.5;
      va.y += dy * f * 0.5;
      vb.x -= dx * f * 0.5;
      vb.y -= dy * f * 0.5;
    }
    // Charge repulsion (n <= ~30, so O(n^2) is fine).
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (!a) continue;
      const pa = pos.get(a.id);
      const va = vel.get(a.id);
      if (!pa || !va) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (!b) continue;
        const pb = pos.get(b.id);
        const vb = vel.get(b.id);
        if (!pb || !vb) continue;
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          const ang = hashUnit(a.id + b.id) * Math.PI * 2;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const f = (charge * alpha) / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        va.x -= fx;
        va.y -= fy;
        vb.x += fx;
        vb.y += fy;
      }
    }
    // Team clustering, anchor to pitch spot, gentle centring on y.
    for (const n of nodes) {
      const p = pos.get(n.id);
      const v = vel.get(n.id);
      const anchor = anchors.get(n.id);
      if (!p || !v || !anchor) continue;
      const tx = cluster ? (n.team === "home" ? homeX : awayX) : centerX;
      v.x += (tx - p.x) * 0.01 * alpha;
      v.y += (centerY - p.y) * 0.004 * alpha;
      v.x += (anchor.x - p.x) * 0.05 * alpha;
      v.y += (anchor.y - p.y) * 0.05 * alpha;
    }
    // Integrate.
    for (const n of nodes) {
      const p = pos.get(n.id);
      const v = vel.get(n.id);
      if (!p || !v) continue;
      v.x *= velocityDecay;
      v.y *= velocityDecay;
      p.x += v.x;
      p.y += v.y;
      clampInto(p, n.radius, box);
    }
    resolveCollisions(nodes, pos, box, 6);
    alpha += (0 - alpha) * alphaDecay;
  }
  resolveCollisions(nodes, pos, box, 6, 4);
  return pos;
}

/** "Terrain" layout: each player at his average spot, nudged apart only where circles overlap. */
export function computePitchLayout(nodes: readonly LayoutNode[], box: LayoutBox): Map<string, Point> {
  const pos = new Map<string, Point>();
  for (const n of nodes) {
    const p = pitchToBox(n.pitchX, n.pitchY, box);
    clampInto(p, n.radius, box);
    pos.set(n.id, p);
  }
  resolveCollisions(nodes, pos, box, 3, 30);
  return pos;
}

/** easeInOutCubic on [0, 1]. */
export function easeInOut(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/**
 * Interpolates between two layouts at eased progress t. Nodes only in `to`
 * appear at their target; nodes only in `from` are dropped.
 */
export function interpolatePositions(
  from: ReadonlyMap<string, Point>, to: ReadonlyMap<string, Point>, t: number,
): Map<string, Point> {
  const e = easeInOut(t);
  const out = new Map<string, Point>();
  for (const [id, b] of to) {
    const a = from.get(id);
    out.set(id, a ? { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e } : { x: b.x, y: b.y });
  }
  return out;
}

/** Node radius in px from touches: sqrt scale between minR and maxR. */
export function radiusForTouches(touches: number, maxTouches: number, minR = 12, maxR = 34): number {
  if (maxTouches <= 0) return minR;
  const k = Math.sqrt(Math.max(touches, 0) / maxTouches);
  return minR + (maxR - minR) * k;
}

/**
 * Quadratic path between two circles, bowed to the right of the travel
 * direction so A->B and B->A never overlap; trimmed to the circle edges
 * (plus `arrowGap` at the target for the arrowhead).
 */
export function curvedEdgePath(
  a: Point, ra: number, b: Point, rb: number, bend = 0.14, arrowGap = 4,
): { d: string; mid: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const off = len * bend;
  const c = { x: (a.x + b.x) / 2 + nx * off, y: (a.y + b.y) / 2 + ny * off };
  const trim = (from: Point, toward: Point, r: number): Point => {
    const vx = toward.x - from.x;
    const vy = toward.y - from.y;
    const l = Math.hypot(vx, vy) || 1;
    return { x: from.x + (vx / l) * r, y: from.y + (vy / l) * r };
  };
  const start = trim(a, c, ra + 2);
  const end = trim(b, c, rb + arrowGap);
  const mid = {
    x: 0.25 * start.x + 0.5 * c.x + 0.25 * end.x,
    y: 0.25 * start.y + 0.5 * c.y + 0.25 * end.y,
  };
  const f = (n: number) => n.toFixed(1);
  return { d: `M${f(start.x)},${f(start.y)} Q${f(c.x)},${f(c.y)} ${f(end.x)},${f(end.y)}`, mid };
}
