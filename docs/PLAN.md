# IMPLEMENTATION PLAN — HEXFORGE

Derived from [`SPEC.md`](./SPEC.md). Each phase maps 1:1 to a GitHub issue.

Ordering principle: **the risky, foundational and hardest-to-change things go first**, and every
phase ends in a state where CI is green. The single riskiest item (WebGPU in CI) was already
de-risked during research, before any code was written.

---

## Phase 0 — Toolchain migration

**Issue #1 · `chore: replace 2018 toolchain with Vite 8 + Vitest 4 + TypeScript 7`**

Rip out webpack 4, ts-loader, jest 23, lite-server, TypeScript 3, and the 150-line commented-out
`tsconfig.json`. Stand up:

- `vite@8.2.2` with `base: '/hex-puzzle-generator/'`
- `typescript@7` strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- `vitest@4` with three projects: `unit` (node), `gpu` (browser/playwright/chromium), `e2e` handled
  separately by `@playwright/test`
- `oxlint` + a custom import-boundary rule enforcing SPEC §2's dependency direction
- a ~40-line Vite plugin for `.wgsl` imports with `#include` composition
- `@webgpu/types`
- `npm-run-all`-free scripts; zero runtime dependencies

Delete `src/app.ts`, `src/grid.ts`, `src/color.ts`, `webpack.config.js`, `jest.config.js`,
`public/build/build.js`. The geometry knowledge from `grid.ts` moves to `src/core/math/hex.ts` in
Phase 1; nothing is lost, everything is rewritten.

**Exit:** `npm run typecheck && npm run lint && npm test` all pass on an empty-but-wired project.

---

## Phase 1 — Pure core: math, RNG, hex

**Issue #2 · `feat(core): hex axial math, affine2d, bezier, deterministic PRNG`**

`src/core/math/hex.ts` — pointy-top axial coordinates carrying forward the original's constants
(`h = R√3/2`, `hs = 2h`, `vs = 1.5R`). Ring enumeration, neighbour tables, axial↔pixel both ways,
`pieceCount(n) = 3n² + 3n + 1`, vertex positions.

`src/core/math/affine2d.ts` — 2×3 affine transform: compose, invert, apply, TRS construction. ~80
lines, replaces any need for a matrix library (RESEARCH §2.4).

`src/core/math/bezier.ts` — cubic evaluation, derivative, adaptive flattening with a stated error
bound, and a bounding-box routine.

`src/core/rng/hash32.ts` — counter-based PCG-style hash, `value(seed, id, channel)` with no
sequential state (SPEC §4.2).

Tests written first (TDD): axial round-trips, ring cardinality, `pieceCount` closed form, affine
compose/invert identity, Bézier flattening error bound, PRNG independence and distribution.

**Exit:** ≥ 95 % coverage on `src/core/math` and `src/core/rng`.

---

## Phase 2 — The cut

**Issue #3 · `feat(core): deterministic hex jigsaw cut generation`**

`src/core/cut/edges.ts` — edge identity and ownership. Every interior edge owned by exactly one hex
(the lexicographically smaller `(q,r)`), referenced reversed by its neighbour. This is the direct
descendant of the original's single-stroke insight (RESEARCH §1.4) and the reason pieces interlock.

`src/core/cut/tab.ts` — the 10-control-point tab curve from SPEC §4.1, in edge-local `(l, w)` space,
parameterised by `t` (tab size), `j` (jitter) and per-edge `flip`, all drawn from the Phase-1 hash.

`src/core/cut/board.ts` — assemble a full board: enumerate rings, generate every edge curve once,
build each piece's closed boundary from its 6 edges (owned forward, borrowed reversed), flatten to
polylines, compute per-piece bounding boxes and the adjacency graph.

Tests: edge-ownership invariants (each interior edge exactly once, each piece exactly 6 edges),
neighbour boundary curves are *identical up to reversal* (the interlock proof), and the **golden
determinism hash** over 500 seeds (SPEC S5).

**Exit:** a board of any size generates in < 50 ms and is provably deterministic.

---

## Phase 3 — Game rules

**Issue #4 · `feat(core): clusters, snapping, scoring, seed codec`**

`src/core/board/state.ts` — piece transforms, z-order, held/placed flags.
`src/core/solve/clusters.ts` — union-find with rigid cluster transforms.
`src/core/solve/snap.ts` — zoom-aware tolerance (`0.28·R/zoom` clamped), neighbour acceptance,
cluster merge on success, win detection.
`src/core/score/par.ts` — par time curve, star thresholds.
`src/core/seed/codec.ts` — `(image, seed, rings, mode)` ↔ base64url URL hash.

Tests: cluster merge correctness and transform propagation, snap accept/reject at tolerance
boundaries and across zoom levels, par monotonicity, codec round-trip under fuzzing, malformed-hash
rejection.

**Exit:** the entire game is playable as a headless simulation in unit tests, with no GPU and no DOM.
This is the payoff of SPEC §2's dependency rule.

---

## Phase 4 — WebGPU foundation

**Issue #5 · `feat(gfx): device bootstrap, frame graph, WGSL pipeline`**

`src/gfx/device.ts` — adapter/device acquisition, required-limits negotiation, a structured
capability report, and clean failure that the UI can render (SPEC NG1).
`src/gfx/renderer.ts` — the frame graph from SPEC §5.1, resize handling, HDR target management.
The `.wgsl` plugin from Phase 0 gets its first real consumers.

**Issue #6 · `test(gpu): Vitest browser mode against a real WebGPU device`**

Wire `@vitest/browser` with the Playwright provider and the **verified variant-D flags**
(RESEARCH §2.2). First GPU test: enumerate every `.wgsl` in the tree, compile it, assert
`getCompilationInfo()` has zero `error` messages (SPEC S4).

**Exit:** a WebGPU device is acquired and every shader compiles, in CI, on a machine with no GPU.

---

## Phase 5 — Piece rendering

**Issue #7 · `feat(gfx): SDF piece renderer, one instanced draw call`**

`shaders/piece.wgsl` — quad-per-piece instancing; fragment evaluates signed distance to the piece's
flattened boundary from a storage buffer, discards outside, and derives bevel, inner shadow and rim
light from `∇d` (SPEC §4.3). Coarse bounding-circle early-out.
`src/gfx/pipelines/piece.ts` — instance buffer layout (48 B/instance), atlas binding.
`src/gfx/atlas.ts` — source image upload, mip chain, UV rects per piece.

GPU tests: SDF sign changes exactly at the expected boundary for a known seed; instance data
produced by the cluster compute pass matches the CPU reference bit-for-bit.

**Exit:** a static board of 1027 pieces renders in one draw call.

---

## Phase 6 — Making it a game

**Issue #8 · `feat(game): loop, camera, input, picking, drag physics`**

Fixed-step simulation with interpolated rendering. Camera pan/zoom with screen↔world conversion.
Pointer/touch/keyboard/gamepad → intents. GPU picking via the `r32uint` id attachment and a 4-byte
readback (SPEC §5.2). Spring-damped drag with momentum toss.

**Issue #9 · `feat(game): snap feedback, particles, audio, completion`**

Particle compute pass, bloom pulse on snap, procedural WebAudio SFX (no asset files), and the
completion sequence where cut lines fade to reveal the seamless image.

**Exit:** it is a game. You can play it.

---

## Phase 7 — Shell

**Issue #10 · `feat(ui): HUD, menus, modes, difficulty, accessibility`**

DOM overlay, ~60-line reactive store, no framework. Mode and difficulty selection, timer, piece
counter, hint/edge-sort assists. Full keyboard operation with focus ring and `aria-live`
announcements, `prefers-reduced-motion` / `prefers-color-scheme` handling, colourblind-safe palette,
high-contrast cut mode (SPEC §10).

**Issue #11 · `feat: persistence, seed sharing, share card, PWA`**

`localStorage` stats/session/prefs with `try/catch` degradation, URL-hash seed sharing, offscreen
share-card rendering, service worker + offline shell.

**Issue #12 · `feat(print): SVG cut-pattern export — the ancestral feature`**

True-Bézier SVG at physical `mm` dimensions for A4/A3/Letter, optional embedded source image,
registration marks, single-stroked edges. The reason the original repo existed, done properly.

---

## Phase 8 — Proof

**Issue #13 · `test(e2e): Playwright — solve by mouse, solve by keyboard, perf, visual regression`**

The full SPEC §11.3 suite, including the keyboard-only solve (S7) and a perf test that **explicitly
skips with a message on SwiftShader** rather than silently passing.

**Issue #14 · `ci: GitHub Actions — typecheck, lint, unit, gpu, e2e, build gates, Pages deploy`**

Both workflows from SPEC §12. Flip the repo's Pages `build_type` from `legacy` to `workflow`.

**Issue #15 · `docs: README with generated GIFs and screenshots, plus media capture script`**

`npm run media` drives real gameplay in Playwright and emits PNGs and GIFs (via the bundled
`ffmpeg`) for board generation, drag-and-snap, cluster welding, completion and print export.
README documents controls, architecture, the measured perf number, and the story of the rewrite.

---

## Sequencing and parallelism

```
#1 ──┬─> #2 ──> #3 ──> #4 ──────────────┬─> #8 ──> #9 ──> #10 ──> #11 ──> #13 ──> #15
     └─> #5 ──> #6 ──> #7 ──────────────┘                  └─> #12 ──┘
                                                                 #14 (any time after #1)
```

Critical path is `#1 → #2 → #3 → #8 → #9 → #13 → #15`. The graphics track (`#5 → #6 → #7`) is
independent of the rules track (`#2 → #3`) once Phase 0 lands, because SPEC §2's dependency rule
means `gfx` consumes only plain `Float32Array` data from `core`.

## Risk checkpoints

| After | Verify |
|---|---|
| #1 | Empty project builds, typechecks, lints, tests, in CI |
| #3 | Golden determinism hash committed and stable |
| #6 | Real WebGPU device obtained in GitHub Actions, not just locally |
| #7 | 1027 pieces in one draw call, frame time recorded |
| #13 | Keyboard-only solve genuinely passes, not stubbed |
| #14 | Live URL serves the new build |
