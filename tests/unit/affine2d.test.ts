import { describe, it, expect } from 'vitest';
import {
  IDENTITY,
  affine,
  translation,
  scaling,
  rotation,
  trs,
  trsAbout,
  apply,
  applyVector,
  compose,
  determinant,
  invert,
  scaleOf,
  rotationOf,
  translationOf,
  equals,
  writeTo,
  readFrom,
} from '@core/math/affine2d.ts';
import { vec2, distance } from '@core/math/vec2.ts';

const POINTS = [vec2(0, 0), vec2(1, 0), vec2(0, 1), vec2(-3, 7), vec2(123.5, -0.25)];

const TRANSFORMS = [
  IDENTITY,
  translation(3, -4),
  scaling(2),
  scaling(2, -3),
  rotation(Math.PI / 3),
  trs(vec2(10, -5), 0.7, 1.5),
  compose(rotation(1.1), translation(4, 4)),
];

describe('identity', () => {
  it('leaves every point unchanged', () => {
    for (const p of POINTS) expect(apply(IDENTITY, p)).toEqual(p);
  });

  it('is neutral under composition on both sides', () => {
    for (const m of TRANSFORMS) {
      expect(equals(compose(IDENTITY, m), m)).toBe(true);
      expect(equals(compose(m, IDENTITY), m)).toBe(true);
    }
  });
});

describe('constructors', () => {
  it('translation moves points and leaves vectors alone', () => {
    const m = translation(5, -2);
    expect(apply(m, vec2(1, 1))).toEqual(vec2(6, -1));
    expect(applyVector(m, vec2(1, 1))).toEqual(vec2(1, 1));
  });

  it('scaling scales about the origin', () => {
    expect(apply(scaling(3), vec2(2, -1))).toEqual(vec2(6, -3));
    expect(apply(scaling(2, 5), vec2(2, -1))).toEqual(vec2(4, -5));
  });

  it('rotation preserves length', () => {
    for (const angle of [0, 0.3, 1, Math.PI / 2, Math.PI, 5.5]) {
      const m = rotation(angle);
      for (const p of POINTS) {
        expect(Math.hypot(...Object.values(apply(m, p)))).toBeCloseTo(Math.hypot(p.x, p.y), 9);
      }
    }
  });

  it('rotation by pi/2 sends +x to +y in y-down space', () => {
    const r = apply(rotation(Math.PI / 2), vec2(1, 0));
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(1, 12);
  });

  it('trs applies scale, then rotation, then translation', () => {
    const m = trs(vec2(10, 20), Math.PI / 2, 2);
    // (1,0) -> scale 2 -> (2,0) -> rotate 90 -> (0,2) -> translate -> (10,22)
    const p = apply(m, vec2(1, 0));
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.y).toBeCloseTo(22, 9);
  });

  it('trsAbout keeps the pivot pinned to the target position', () => {
    const pivot = vec2(7, -3);
    const target = vec2(100, 50);
    for (const angle of [0, 0.5, 2.2, -1.7]) {
      const m = trsAbout(pivot, target, angle, 1.3);
      const moved = apply(m, pivot);
      expect(distance(moved, target)).toBeLessThan(1e-9);
    }
  });
});

describe('composition', () => {
  it('applies the inner transform first', () => {
    const inner = translation(1, 0);
    const outer = scaling(10);
    // scale(translate(p)) => (p + 1) * 10
    expect(apply(compose(outer, inner), vec2(0, 0))).toEqual(vec2(10, 0));
    // translate(scale(p)) => p * 10 + 1
    expect(apply(compose(inner, outer), vec2(0, 0))).toEqual(vec2(1, 0));
  });

  it('agrees with applying the transforms one after the other', () => {
    for (const outer of TRANSFORMS) {
      for (const inner of TRANSFORMS) {
        const combined = compose(outer, inner);
        for (const p of POINTS) {
          const stepwise = apply(outer, apply(inner, p));
          expect(distance(apply(combined, p), stepwise)).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('is associative', () => {
    const [a, b, c] = [TRANSFORMS[3]!, TRANSFORMS[4]!, TRANSFORMS[5]!];
    expect(equals(compose(compose(a, b), c), compose(a, compose(b, c)), 1e-9)).toBe(true);
  });
});

describe('inversion', () => {
  it('compose(m, invert(m)) is the identity', () => {
    for (const m of TRANSFORMS) {
      const inv = invert(m);
      expect(inv).not.toBeNull();
      expect(equals(compose(m, inv!), IDENTITY, 1e-9)).toBe(true);
      expect(equals(compose(inv!, m), IDENTITY, 1e-9)).toBe(true);
    }
  });

  it('round-trips points', () => {
    for (const m of TRANSFORMS) {
      const inv = invert(m)!;
      for (const p of POINTS) {
        expect(distance(apply(inv, apply(m, p)), p)).toBeLessThan(1e-9);
      }
    }
  });

  it('returns null for a singular transform instead of silently returning identity', () => {
    expect(invert(scaling(0))).toBeNull();
    expect(invert(affine(1, 2, 2, 4, 0, 0))).toBeNull();
    expect(invert(affine(NaN, 0, 0, 1, 0, 0))).toBeNull();
  });

  it('determinant matches the area scale factor', () => {
    expect(determinant(IDENTITY)).toBe(1);
    expect(determinant(scaling(3))).toBeCloseTo(9, 12);
    expect(determinant(rotation(1.234))).toBeCloseTo(1, 12);
  });
});

describe('decomposition', () => {
  it('recovers scale, rotation and translation from a similarity transform', () => {
    for (const angle of [-2.5, -0.3, 0, 0.4, 1.9]) {
      for (const s of [0.25, 1, 3.75]) {
        const pos = vec2(11, -6);
        const m = trs(pos, angle, s);
        expect(scaleOf(m)).toBeCloseTo(s, 9);
        expect(rotationOf(m)).toBeCloseTo(angle, 9);
        expect(translationOf(m)).toEqual(pos);
      }
    }
  });
});

describe('GPU-compatible packing', () => {
  it('writeTo/readFrom round-trips', () => {
    const m = trs(vec2(3, 4), 0.9, 2.5);
    const buf = new Float32Array(16);
    writeTo(m, buf, 6);
    expect(equals(readFrom(buf, 6), m, 1e-6)).toBe(true);
  });

  it('writes exactly six floats at the given offset and touches nothing else', () => {
    const buf = new Float32Array(12).fill(-1);
    writeTo(IDENTITY, buf, 3);
    expect(Array.from(buf.slice(0, 3))).toEqual([-1, -1, -1]);
    expect(Array.from(buf.slice(3, 9))).toEqual([1, 0, 0, 1, 0, 0]);
    expect(Array.from(buf.slice(9))).toEqual([-1, -1, -1]);
  });

  it('readFrom degrades to identity components on a short buffer', () => {
    expect(readFrom(new Float32Array(0))).toEqual(IDENTITY);
  });
});

describe('equals', () => {
  it('respects the epsilon', () => {
    const a = IDENTITY;
    const b = affine(1 + 1e-12, 0, 0, 1, 0, 0);
    expect(equals(a, b)).toBe(true);
    expect(equals(a, b, 1e-15)).toBe(false);
  });
});
