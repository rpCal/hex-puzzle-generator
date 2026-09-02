/** A point or vector in board space. Board space is y-down, matching both canvas and SVG. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const vec2 = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const lengthSq = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const distanceSq = (a: Vec2, b: Vec2): number => lengthSq(sub(a, b));

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Rotate 90 degrees. In y-down space this turns "along the edge" into "left of the edge". */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export function rotate(a: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const equals = (a: Vec2, b: Vec2, epsilon = 1e-9): boolean =>
  Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;

/** Axis-aligned bounding box. `min` is top-left in y-down space. */
export interface Aabb {
  readonly min: Vec2;
  readonly max: Vec2;
}

export function aabbOf(points: readonly Vec2[]): Aabb {
  if (points.length === 0) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

export const aabbUnion = (a: Aabb, b: Aabb): Aabb => ({
  min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y) },
  max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y) },
});

export const aabbCenter = (a: Aabb): Vec2 => ({
  x: (a.min.x + a.max.x) / 2,
  y: (a.min.y + a.max.y) / 2,
});

export const aabbSize = (a: Aabb): Vec2 => ({
  x: a.max.x - a.min.x,
  y: a.max.y - a.min.y,
});

export const aabbExpand = (a: Aabb, by: number): Aabb => ({
  min: { x: a.min.x - by, y: a.min.y - by },
  max: { x: a.max.x + by, y: a.max.y + by },
});

export const aabbContains = (a: Aabb, p: Vec2): boolean =>
  p.x >= a.min.x && p.x <= a.max.x && p.y >= a.min.y && p.y <= a.max.y;
