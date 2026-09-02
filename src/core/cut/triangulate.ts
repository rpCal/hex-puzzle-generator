import type { Vec2 } from '../math/vec2.ts';

/**
 * Ear-clipping triangulation for simple polygons.
 *
 * Why not a triangle fan from the centroid, which would be four lines: **piece outlines are not
 * star-shaped**. A jigsaw blank is an indentation with a neck narrower than the head it opens into
 * (the tab parameterisation puts the neck at `2t` wide and the head at `4t`), so parts of the head
 * are hidden from the piece centre. A fan would emit triangles covering area outside the piece and
 * pieces would render with visible spurs.
 *
 * Why triangulate at all, rather than evaluate the silhouette as a signed distance field in the
 * fragment shader: an exact per-fragment SDF against ~185 boundary segments costs roughly 370
 * million distance tests per frame at 1080p, which real hardware tolerates and SwiftShader — the CI
 * renderer — does not. Triangles are what a GPU is for. Anti-aliasing and the bevel come instead
 * from an interpolated edge-distance attribute (see `mesh.ts`), which costs nothing per fragment.
 */

/** Twice the signed area. Positive means the winding for which `perp(edge)` points inward. */
export function signedArea2(polygon: readonly Vec2[]): number {
  let sum = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i] as Vec2;
    const b = polygon[(i + 1) % n] as Vec2;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** Is `p` inside triangle `abc`, boundary included? Assumes `abc` is counter-clockwise. */
function pointInTriangle(a: Vec2, b: Vec2, c: Vec2, p: Vec2): boolean {
  const d1 = cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y);
  const d2 = cross(c.x - b.x, c.y - b.y, p.x - b.x, p.y - b.y);
  const d3 = cross(a.x - c.x, a.y - c.y, p.x - c.x, p.y - c.y);
  return d1 >= 0 && d2 >= 0 && d3 >= 0;
}

/**
 * Triangulate a simple polygon, returning indices into the input array.
 *
 * Returns `3 * (n - 2)` indices for a well-formed polygon. Degenerate input yields fewer rather
 * than throwing: a piece that fails to triangulate should render as nothing, not take the frame
 * down with it.
 */
export function triangulate(polygon: readonly Vec2[]): Uint32Array {
  const n = polygon.length;
  if (n < 3) return new Uint32Array(0);

  // Work in counter-clockwise order so the ear test has a fixed sign convention.
  const ccw = signedArea2(polygon) > 0;
  const remaining: number[] = [];
  for (let i = 0; i < n; i++) remaining.push(ccw ? i : n - 1 - i);

  const out = new Uint32Array((n - 2) * 3);
  let written = 0;
  // Each successful clip removes one vertex; the guard bounds the pathological case where no ear
  // is found (self-intersecting input) so the loop terminates instead of hanging the tab.
  let guard = n * n;

  while (remaining.length > 3 && guard-- > 0) {
    let clipped = false;

    for (let i = 0; i < remaining.length; i++) {
      const prev = remaining[(i - 1 + remaining.length) % remaining.length] as number;
      const cur = remaining[i] as number;
      const next = remaining[(i + 1) % remaining.length] as number;

      const a = polygon[prev] as Vec2;
      const b = polygon[cur] as Vec2;
      const c = polygon[next] as Vec2;

      // Reflex vertices cannot be ears.
      if (cross(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y) <= 0) continue;

      // No other vertex may lie inside the candidate ear.
      let contains = false;
      for (const other of remaining) {
        if (other === prev || other === cur || other === next) continue;
        if (pointInTriangle(a, b, c, polygon[other] as Vec2)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;

      out[written++] = prev;
      out[written++] = cur;
      out[written++] = next;
      remaining.splice(i, 1);
      clipped = true;
      break;
    }

    // No ear found: the polygon is not simple. Stop with what we have rather than spinning.
    if (!clipped) break;
  }

  if (remaining.length === 3) {
    out[written++] = remaining[0] as number;
    out[written++] = remaining[1] as number;
    out[written++] = remaining[2] as number;
  }

  return written === out.length ? out : out.slice(0, written);
}

/**
 * Move every vertex inward along its angle bisector.
 *
 * Used to build the bevel ring: the offset copy of the outline provides the "fully inside" end of
 * the interpolated edge-distance attribute. The scale by `1 / sin(half-angle)` is what keeps the
 * offset a constant perpendicular distance from both adjacent edges rather than pinching at
 * corners; it is clamped because at a near-cusp that factor diverges, and an inner ring that shot
 * off to infinity would produce visible shading spikes.
 *
 * Self-intersection of the inner ring is possible in principle for a feature narrower than twice
 * the offset. It is harmless here: the inner ring never contributes to the silhouette, only to
 * shading, and the offsets used are an order of magnitude smaller than the narrowest feature the
 * cut can produce.
 */
export function offsetInward(polygon: readonly Vec2[], width: number): Vec2[] {
  const n = polygon.length;
  if (n < 3) return [...polygon];

  const sign = signedArea2(polygon) > 0 ? 1 : -1;
  const out: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n] as Vec2;
    const cur = polygon[i] as Vec2;
    const next = polygon[(i + 1) % n] as Vec2;

    const inNormal = inwardNormal(prev, cur, sign);
    const outNormal = inwardNormal(cur, next, sign);

    let bx = inNormal.x + outNormal.x;
    let by = inNormal.y + outNormal.y;
    const len = Math.hypot(bx, by);
    if (len < 1e-12) {
      // Reversal (a cusp). Fall back to the outgoing edge normal.
      bx = outNormal.x;
      by = outNormal.y;
    } else {
      bx /= len;
      by /= len;
    }

    const cosHalf = bx * outNormal.x + by * outNormal.y;
    const scale = Math.min(4, 1 / Math.max(0.25, cosHalf));
    out.push({ x: cur.x + bx * width * scale, y: cur.y + by * width * scale });
  }

  return out;
}

/** Unit normal of edge `a -> b` pointing into the polygon interior. */
function inwardNormal(a: Vec2, b: Vec2, sign: number): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return { x: 0, y: 0 };
  // For positive winding, perp(edge) = (-dy, dx) points inward.
  return { x: (-dy / len) * sign, y: (dx / len) * sign };
}
