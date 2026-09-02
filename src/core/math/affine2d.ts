import type { Vec2 } from './vec2.ts';

/**
 * A 2D affine transform, stored row-major as
 *
 *   | a  c  tx |
 *   | b  d  ty |
 *
 * Deliberately hand-written rather than pulled from a matrix library. The game is 2D: it needs
 * compose, invert, apply and a TRS constructor, which is this file. A 3D library would ship unused
 * 4x4 and quaternion code, add a dependency to a project whose policy is zero runtime dependencies,
 * and — the real cost — remove ~80 lines of prime unit-test surface from the core.
 *
 * The memory layout matches WGSL `mat2x3<f32>` column padding when uploaded as 8 floats
 * (`a b 0 0 c d 0 0` is *not* what we use; see `writeToInstance` for the exact packing), so the same
 * transform can be handed to the GPU without a conversion pass.
 */
export interface Affine2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export const IDENTITY: Affine2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export const affine = (a: number, b: number, c: number, d: number, tx: number, ty: number): Affine2D => ({
  a,
  b,
  c,
  d,
  tx,
  ty,
});

export const translation = (x: number, y: number): Affine2D => ({ a: 1, b: 0, c: 0, d: 1, tx: x, ty: y });

export const scaling = (sx: number, sy: number = sx): Affine2D => ({
  a: sx,
  b: 0,
  c: 0,
  d: sy,
  tx: 0,
  ty: 0,
});

export function rotation(radians: number): Affine2D {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { a: c, b: s, c: -s, d: c, tx: 0, ty: 0 };
}

/**
 * Translate * Rotate * Scale, applied to a point in that reading order: scale first, then rotate,
 * then translate. This is the natural piece transform: pieces have a position, an orientation and a
 * uniform scale, in that order of authority.
 */
export function trs(position: Vec2, radians: number, scale = 1): Affine2D {
  const c = Math.cos(radians) * scale;
  const s = Math.sin(radians) * scale;
  return { a: c, b: s, c: -s, d: c, tx: position.x, ty: position.y };
}

/**
 * Rotate `radians` about `pivot`, then translate. The form the drag code actually needs, because a
 * cluster rotates about the grabbed piece rather than about the origin.
 */
export function trsAbout(pivot: Vec2, position: Vec2, radians: number, scale = 1): Affine2D {
  const c = Math.cos(radians) * scale;
  const s = Math.sin(radians) * scale;
  return {
    a: c,
    b: s,
    c: -s,
    d: c,
    tx: position.x - (c * pivot.x - s * pivot.y),
    ty: position.y - (s * pivot.x + c * pivot.y),
  };
}

/** `m` applied to point `p`. */
export function apply(m: Affine2D, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty };
}

/** `m` applied to a direction: translation is ignored. */
export function applyVector(m: Affine2D, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y };
}

/** `outer * inner` — the transform that applies `inner` first, then `outer`. */
export function compose(outer: Affine2D, inner: Affine2D): Affine2D {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
  };
}

export const determinant = (m: Affine2D): number => m.a * m.d - m.b * m.c;

/** Inverse, or `null` if singular. Callers must handle `null` rather than silently getting identity. */
export function invert(m: Affine2D): Affine2D | null {
  const det = determinant(m);
  if (det === 0 || !Number.isFinite(det)) return null;
  const inv = 1 / det;
  const a = m.d * inv;
  const b = -m.b * inv;
  const c = -m.c * inv;
  const d = m.a * inv;
  return { a, b, c, d, tx: -(a * m.tx + c * m.ty), ty: -(b * m.tx + d * m.ty) };
}

/** Uniform scale factor, assuming the transform is a similarity (which every piece transform is). */
export const scaleOf = (m: Affine2D): number => Math.hypot(m.a, m.b);

/** Rotation angle in radians, assuming a similarity transform. */
export const rotationOf = (m: Affine2D): number => Math.atan2(m.b, m.a);

export const translationOf = (m: Affine2D): Vec2 => ({ x: m.tx, y: m.ty });

export function equals(x: Affine2D, y: Affine2D, epsilon = 1e-9): boolean {
  return (
    Math.abs(x.a - y.a) <= epsilon &&
    Math.abs(x.b - y.b) <= epsilon &&
    Math.abs(x.c - y.c) <= epsilon &&
    Math.abs(x.d - y.d) <= epsilon &&
    Math.abs(x.tx - y.tx) <= epsilon &&
    Math.abs(x.ty - y.ty) <= epsilon
  );
}

/**
 * Write as six consecutive floats `[a, b, c, d, tx, ty]`.
 *
 * The GPU instance buffer reads these as three `vec2f` columns, which is how WGSL sees a
 * `mat3x2<f32>`. Keeping the CPU and GPU layouts identical means the cluster-transform compute pass
 * and the CPU reference implementation can be compared bit-for-bit in a GPU test.
 */
export function writeTo(m: Affine2D, out: Float32Array, offset = 0): void {
  out[offset + 0] = m.a;
  out[offset + 1] = m.b;
  out[offset + 2] = m.c;
  out[offset + 3] = m.d;
  out[offset + 4] = m.tx;
  out[offset + 5] = m.ty;
}

export function readFrom(src: Float32Array, offset = 0): Affine2D {
  return {
    a: src[offset + 0] ?? 1,
    b: src[offset + 1] ?? 0,
    c: src[offset + 2] ?? 0,
    d: src[offset + 3] ?? 1,
    tx: src[offset + 4] ?? 0,
    ty: src[offset + 5] ?? 0,
  };
}
