import { describe, it, expect } from 'vitest';
import {
  vec2,
  add,
  sub,
  scale,
  dot,
  cross,
  length,
  lengthSq,
  distance,
  distanceSq,
  normalize,
  perp,
  lerp,
  rotate,
  equals,
  aabbOf,
  aabbUnion,
  aabbCenter,
  aabbSize,
  aabbExpand,
  aabbContains,
} from '@core/math/vec2.ts';

describe('vector arithmetic', () => {
  it('adds, subtracts and scales', () => {
    expect(add(vec2(1, 2), vec2(3, 4))).toEqual(vec2(4, 6));
    expect(sub(vec2(1, 2), vec2(3, 4))).toEqual(vec2(-2, -2));
    expect(scale(vec2(2, -3), 2.5)).toEqual(vec2(5, -7.5));
  });

  it('computes dot and cross products', () => {
    expect(dot(vec2(1, 0), vec2(0, 1))).toBe(0);
    expect(dot(vec2(2, 3), vec2(4, 5))).toBe(23);
    expect(cross(vec2(1, 0), vec2(0, 1))).toBe(1);
    expect(cross(vec2(0, 1), vec2(1, 0))).toBe(-1);
  });

  it('measures length and distance, squared and not', () => {
    expect(length(vec2(3, 4))).toBe(5);
    expect(lengthSq(vec2(3, 4))).toBe(25);
    expect(distance(vec2(1, 1), vec2(4, 5))).toBe(5);
    expect(distanceSq(vec2(1, 1), vec2(4, 5))).toBe(25);
  });

  it('normalises to unit length', () => {
    const n = normalize(vec2(3, 4));
    expect(length(n)).toBeCloseTo(1, 12);
    expect(n).toEqual(vec2(0.6, 0.8));
  });

  it('returns zero rather than NaN when normalising a zero vector', () => {
    expect(normalize(vec2(0, 0))).toEqual(vec2(0, 0));
  });

  it('perp rotates a quarter turn and is orthogonal to its input', () => {
    // `-0` is a legitimate result of negating `0`; compare numerically rather than structurally.
    expect(equals(perp(vec2(1, 0)), vec2(0, 1))).toBe(true);
    expect(dot(vec2(3, -7), perp(vec2(3, -7)))).toBe(0);
  });

  it('lerps between endpoints', () => {
    expect(lerp(vec2(0, 0), vec2(10, 20), 0)).toEqual(vec2(0, 0));
    expect(lerp(vec2(0, 0), vec2(10, 20), 1)).toEqual(vec2(10, 20));
    expect(lerp(vec2(0, 0), vec2(10, 20), 0.25)).toEqual(vec2(2.5, 5));
  });

  it('rotates while preserving length', () => {
    const r = rotate(vec2(1, 0), Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(1, 12);
    expect(length(rotate(vec2(3, 4), 1.234))).toBeCloseTo(5, 12);
  });

  it('compares with an epsilon', () => {
    expect(equals(vec2(1, 1), vec2(1 + 1e-12, 1))).toBe(true);
    expect(equals(vec2(1, 1), vec2(1.1, 1))).toBe(false);
    expect(equals(vec2(1, 1), vec2(1 + 1e-12, 1), 1e-15)).toBe(false);
  });
});

describe('bounding boxes', () => {
  const points = [vec2(1, 5), vec2(-3, 2), vec2(4, -1)];

  it('bounds a set of points', () => {
    expect(aabbOf(points)).toEqual({ min: vec2(-3, -1), max: vec2(4, 5) });
  });

  it('returns a degenerate box for no points rather than +/-Infinity', () => {
    expect(aabbOf([])).toEqual({ min: vec2(0, 0), max: vec2(0, 0) });
  });

  it('unions two boxes', () => {
    const a = { min: vec2(0, 0), max: vec2(1, 1) };
    const b = { min: vec2(-5, 2), max: vec2(0, 3) };
    expect(aabbUnion(a, b)).toEqual({ min: vec2(-5, 0), max: vec2(1, 3) });
  });

  it('reports centre and size', () => {
    const box = aabbOf(points);
    expect(aabbCenter(box)).toEqual(vec2(0.5, 2));
    expect(aabbSize(box)).toEqual(vec2(7, 6));
  });

  it('expands in every direction', () => {
    const box = aabbExpand({ min: vec2(0, 0), max: vec2(2, 2) }, 1);
    expect(box).toEqual({ min: vec2(-1, -1), max: vec2(3, 3) });
  });

  it('tests containment inclusively', () => {
    const box = { min: vec2(0, 0), max: vec2(2, 2) };
    expect(aabbContains(box, vec2(1, 1))).toBe(true);
    expect(aabbContains(box, vec2(0, 0))).toBe(true);
    expect(aabbContains(box, vec2(2, 2))).toBe(true);
    expect(aabbContains(box, vec2(2.1, 1))).toBe(false);
    expect(aabbContains(box, vec2(-0.1, 1))).toBe(false);
  });
});
