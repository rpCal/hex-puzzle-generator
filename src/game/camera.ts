import { affine, invert, apply, type Affine2D } from '@core/math/affine2d.ts';
import { type Aabb, type Vec2 } from '@core/math/vec2.ts';

/**
 * A 2D camera over the board.
 *
 * `zoom` is in screen pixels per board unit, which is the unit the snap tolerance is expressed
 * against — keeping them in the same currency is what lets "close enough" mean the same thing to
 * the player at every magnification.
 */

export interface CameraLimits {
  readonly minZoom: number;
  readonly maxZoom: number;
}

export const DEFAULT_LIMITS: CameraLimits = { minZoom: 0.04, maxZoom: 8 };

export class Camera {
  position: Vec2 = { x: 0, y: 0 };
  zoom = 1;
  viewportWidth = 1;
  viewportHeight = 1;
  limits: CameraLimits;

  constructor(limits: CameraLimits = DEFAULT_LIMITS) {
    this.limits = limits;
  }

  setViewport(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
  }

  clampZoom(zoom: number): number {
    return Math.min(this.limits.maxZoom, Math.max(this.limits.minZoom, zoom));
  }

  /**
   * World -> clip space, as a single affine transform.
   *
   * The `-2 * zoom / height` in the `d` slot is the y flip: the board is authored y-down, matching
   * canvas and SVG, while clip space is y-up. Doing it here means every other layer — cut, print,
   * hit-testing — can stay in one consistent coordinate system.
   */
  get viewProjection(): Affine2D {
    const sx = (2 * this.zoom) / this.viewportWidth;
    const sy = (-2 * this.zoom) / this.viewportHeight;
    return affine(sx, 0, 0, sy, -this.position.x * sx, -this.position.y * sy);
  }

  /** World -> screen pixels, with the origin at the top-left of the viewport. */
  worldToScreen(p: Vec2): Vec2 {
    return {
      x: (p.x - this.position.x) * this.zoom + this.viewportWidth / 2,
      y: (p.y - this.position.y) * this.zoom + this.viewportHeight / 2,
    };
  }

  /** Screen pixels -> world. */
  screenToWorld(p: Vec2): Vec2 {
    return {
      x: (p.x - this.viewportWidth / 2) / this.zoom + this.position.x,
      y: (p.y - this.viewportHeight / 2) / this.zoom + this.position.y,
    };
  }

  /** Pan by a screen-space delta, so dragging the board tracks the cursor exactly. */
  panByScreen(dx: number, dy: number): void {
    this.position = { x: this.position.x - dx / this.zoom, y: this.position.y - dy / this.zoom };
  }

  /**
   * Zoom about a screen point, keeping the world point under it pinned.
   *
   * Zooming about the viewport centre instead is the single most common way to make a pan/zoom
   * canvas feel wrong: the thing you are looking at slides away as you scroll.
   */
  zoomAbout(screenPoint: Vec2, factor: number): void {
    const before = this.screenToWorld(screenPoint);
    this.zoom = this.clampZoom(this.zoom * factor);
    const after = this.screenToWorld(screenPoint);
    this.position = {
      x: this.position.x + (before.x - after.x),
      y: this.position.y + (before.y - after.y),
    };
  }

  /** Frame a region with margin. Used by "fit board" and at board start. */
  fit(bounds: Aabb, margin = 1.1): void {
    const width = Math.max(1e-6, bounds.max.x - bounds.min.x) * margin;
    const height = Math.max(1e-6, bounds.max.y - bounds.min.y) * margin;
    this.zoom = this.clampZoom(
      Math.min(this.viewportWidth / width, this.viewportHeight / height),
    );
    this.position = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
    };
  }

  /** Round-trip check used by tests: the inverse of `viewProjection` maps clip back to world. */
  clipToWorld(clip: Vec2): Vec2 | null {
    const inverse = invert(this.viewProjection);
    return inverse === null ? null : apply(inverse, clip);
  }
}
