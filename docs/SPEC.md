# SPEC — HEXFORGE

A GPU-driven hexagonal jigsaw puzzle for the browser.

Version 1.0 · 2026-09-02 · derived from [`RESEARCH.md`](./RESEARCH.md)

---

## 0. One-paragraph statement

**HEXFORGE** takes an image — bundled art, your own upload, or a procedurally generated one — and
shatters it into interlocking hexagonal jigsaw pieces with organic, hand-made-looking cuts. You
reassemble it by dragging pieces that weld into clusters as they connect. Every piece is rendered by
the GPU in a single instanced draw call, its silhouette evaluated analytically in WGSL as a signed
distance field, so a 2000-piece board runs as cheaply as a 20-piece one and looks identical at any
zoom. The cut is a pure function of a seed, so a URL reproduces an exact board for anyone. And
because the project it grew from was a jig for printing paper puzzles, it still exports the cut
pattern as a print-ready SVG.

---

## 1. Goals and non-goals

### 1.1 Goals

- **G1** — A puzzle that is genuinely *satisfying* to play, not a tech demo with pieces in it.
- **G2** — GPU-driven rendering: piece count is bounded by memory, not by draw calls.
- **G3** — Fully deterministic. `(seed, rings, difficulty)` → byte-identical cut, everywhere.
- **G4** — Pure logic core with zero DOM/GPU imports, so the rules of the game are unit-testable.
- **G5** — Real tests: unit (Node), GPU (real device, real shaders), e2e (real browser, real input).
- **G6** — Ships to GitHub Pages from CI on every push to `master`.
- **G7** — Honours its ancestry: the print-a-real-puzzle export survives.
- **G8** — Loads fast and works offline.

### 1.2 Non-goals

- **NG1** — No WebGL/Canvas2D fallback renderer. WebGPU is Baseline; a second renderer doubles the
  bug surface to serve a shrinking minority. Non-WebGPU browsers get a designed capability screen.
- **NG2** — No multiplayer server, no accounts, no backend of any kind. Static hosting only.
- **NG3** — No 3D. The board is a plane. Depth is faked with shadow and bevel, which is enough.
- **NG4** — No game engine (Three, Babylon, PixiJS). The rendering need is one instanced pipeline
  and two post passes; an engine would be more code to configure than to write.
- **NG5** — No UI framework. The HUD is ~12 elements. Vanilla TS + a 60-line reactive store.

### 1.3 Success criteria

| # | Criterion | Measurement |
|---|---|---|
| S1 | 60 fps with 1000 pieces on integrated graphics | `perf` e2e asserts p95 frame ≤ 16.6 ms |
| S2 | Cold load to interactive < 2 s on Fast 3G | Lighthouse CI budget in e2e |
| S3 | Core logic ≥ 90 % line coverage | `vitest run --coverage` gate in CI |
| S4 | Every WGSL shader compiles with zero errors | GPU test enumerates and asserts |
| S5 | Same seed ⇒ identical cut | Property test over 500 random seeds, hashed |
| S6 | Bundle ≤ 150 kB gzipped, zero runtime deps | `size-limit` gate in CI |
| S7 | Keyboard-only completion possible | e2e solves a 7-piece board with no pointer events |

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  src/core/            PURE. No DOM. No GPU. No side effects.   │
│  ────────────────────────────────────────────────────────────  │
│  math/      hex axial coords, affine2d, bezier, easing         │
│  rng/       counter-based hash PRNG (deterministic, seekable)  │
│  cut/       edge curve generation, tessellation, piece meshes  │
│  board/     Board model: pieces, adjacency graph, transforms   │
│  solve/     snap resolution, union-find clusters, win check    │
│  score/     par times, star rating, stats                      │
│  seed/      seed <-> URL codec                                 │
└────────────────────────────────────────────────────────────────┘
              │ plain data (Float32Array, structs)
              ▼
┌────────────────────────────────────────────────────────────────┐
│  src/gfx/             WebGPU. Knows nothing about game rules.  │
│  ────────────────────────────────────────────────────────────  │
│  device.ts      adapter/device bootstrap + capability report   │
│  renderer.ts    frame graph, passes, resize                    │
│  pipelines/     piece, particle, post, print                   │
│  shaders/*.wgsl piece SDF, particle compute, bloom, composite  │
│  atlas.ts       source-image upload + mip generation           │
└────────────────────────────────────────────────────────────────┘
              ▲                            │
              │ instance buffer            │ picking readback
┌────────────────────────────────────────────────────────────────┐
│  src/game/            Orchestration. Owns the loop.            │
│  ────────────────────────────────────────────────────────────  │
│  app.ts      bootstrap, capability gate                        │
│  loop.ts     fixed-step sim + interpolated render              │
│  input.ts    pointer/touch/keyboard/gamepad -> intents         │
│  camera.ts   pan/zoom, screen<->world                          │
│  session.ts  state machine: menu -> playing -> solved          │
│  audio.ts    WebAudio, procedural SFX (no asset files)         │
└────────────────────────────────────────────────────────────────┘
              │
┌────────────────────────────────────────────────────────────────┐
│  src/ui/    HUD, menus, dialogs. DOM overlay above canvas.     │
│  src/pwa/   service worker, offline shell                      │
│  src/print/ SVG cut-pattern export (the ancestral feature)     │
└────────────────────────────────────────────────────────────────┘
```

**The dependency rule is one-directional and enforced by a lint rule:** `core` imports nothing from
the project; `gfx` may import `core`; `game` may import `core` and `gfx`; `ui` may import `core` and
`game`. A violation fails CI. This is what keeps G4 true over time.

---

## 3. Hex geometry

Pointy-top hexagons in **axial coordinates** `(q, r)`, inheriting the original's layout constants.

For circumradius `R`:
- inradius `h = R·√3/2`
- horizontal pitch `hs = 2h = R√3`
- vertical pitch `vs = 1.5R`
- centre of `(q, r)` = `( hs·(q + r/2), vs·r )`
- vertex `k ∈ [0,6)` at angle `60k + 90` degrees from centre, radius `R`

The board is a **hexagonal region of `n` rings** (not the original's rectangle), because a hex-of-hexes
has no ragged edge, no special-cased dangling stubs (the original needed one), and a piece count with
a clean closed form:

```
pieces(n) = 3n² + 3n + 1        n=1 → 7,  n=3 → 37,  n=8 → 217,  n=18 → 1027
```

Rectangular boards remain available as a layout option for the print export, where paper is
rectangular and the ragged edge is the point.

**Edge ownership.** Each interior edge is shared by exactly two hexes. It is owned by the hex with the
lexicographically smaller `(q, r)`, and the neighbour references the same edge reversed. This is the
direct descendant of the original's `drawWithoudRepeat` insight — one edge, one curve — but expressed
as data rather than as a loop that avoids re-visiting. It is what guarantees two pieces interlock:
they are cut by literally the same curve.

---

## 4. The cut

### 4.1 Edge curve

Adopted from the surveyed prior art (§3 of RESEARCH) and re-derived in edge-local space. An edge runs
from vertex `A` to vertex `B`; `l ∈ [0,1]` is the parameter along `A→B`, `w` is perpendicular
displacement in units of edge length. Ten control points define a tab:

```
p0 = (0,              0)
p1 = (0.2,            a)
p2 = (0.5 + b + d,   -t + c)
p3 = (0.5 - t + b,    t + c)
p4 = (0.5 - 2t + b - d, 3t + c)
p5 = (0.5 + 2t + b - d, 3t + c)
p6 = (0.5 + t + b,    t + c)
p7 = (0.5 + b + d,   -t + c)
p8 = (0.8,            e)
p9 = (1,              0)
```

`t` = tab size (difficulty-dependent), `a..e` = per-edge jitter drawn uniformly from `[-j, j]`, and a
per-edge `flip` boolean negates every `w` so the tab bulges to the other side. Consecutive points are
joined as three cubic Bézier segments (`p0p1p2p3`, `p3p4p5p6`, `p6p7p8p9`). Border edges of the board
are straight (`w = 0` throughout).

### 4.2 Randomness

The reference implementation used `Math.sin(seed)*10000 - floor(...)`, which is not a PRNG — it has
visible structure and is not portable across engines. Replaced with a **counter-based hash**
(PCG-style 32-bit, integer-only, no state threading):

```
value(seed, edgeId, channel) = hash32(seed ^ (edgeId * 0x9E3779B1) ^ (channel * 0x85EBCA6B))
```

Consequences: any edge's parameters can be computed independently, in any order, on CPU or GPU, with
no sequential dependency. Determinism (G3) is structural, not incidental. `edgeId` is derived from the
owning axial coordinate and the edge index `0..5`, so it is stable under any iteration order.

### 4.3 Rendering the cut — SDF, not geometry

Pieces are **not** tessellated into triangle meshes. Each piece is drawn as a quad (its bounding box);
the fragment shader evaluates the signed distance to the piece's boundary and discards outside it.

Rationale:
- Resolution independence — zoom to 50× and the cut is still a perfect curve.
- Analytic anti-aliasing from the distance field, one `smoothstep`, no MSAA cost.
- The same distance field drives the bevel, the inner shadow and the rim light for free
  (`normal = normalize(∇d)` gives a fake 3D edge from a 2D field).
- No CPU tessellation step, so board generation is instant even at 2000 pieces.

Each piece's boundary is six edge-curves. The shader evaluates distance to 18 cubic Béziers
(6 edges × 3 segments). Cubic Bézier SDF is expensive, so the curves are **pre-flattened on the CPU
into line segments** (adaptive, ~8 segments per Bézier at generation time) and uploaded to a storage
buffer; the shader does 144 point-segment distance tests per fragment, which SwiftShader survives and
real hardware does not notice. A per-piece coarse bounding circle plus early-out keeps the common case
cheap.

---

## 5. Rendering

### 5.1 Frame graph

```
[compute] particles.wgsl     simulate + integrate particle system (storage buffer)
[compute] cluster.wgsl       apply cluster transforms to per-piece instance data
[render]  piece.wgsl         instanced quads -> HDR colour target + piece-id target
[render]  particle.wgsl      additive points -> HDR colour target
[compute] bloom_down/up.wgsl 5-level dual-filter blur of bright pass
[render]  composite.wgsl     tonemap + bloom + vignette + grain -> swapchain
```

**One instanced draw call for all pieces.** Per-instance data (48 bytes): `mat2x3` transform, atlas
UV rect, piece flags (`held`, `snapped`, `ghost`), highlight intensity. Instance buffer is written by
a compute pass from the cluster transform table, so dragging a 400-piece cluster costs one uniform
write, not 400 buffer updates.

### 5.2 Picking

A second colour attachment writes `piece_id + 1` as `r32uint`. Pointer-down copies the single texel
under the cursor into a 4-byte staging buffer and maps it. Exact, no CPU-side hit testing against
Bézier curves, and correct for overlapping pieces because it respects the depth/z-order the GPU
already resolved.

### 5.3 Visual identity

Dark slate board (`oklch(0.22 0.02 265)`) with a subtle grain. Pieces cast a soft drop shadow that
lifts on pick-up. The held piece gets a rim light. On a successful snap: a 120 ms bloom pulse along
the joined edge, a 40-particle burst emitted from the edge midpoint tinted from the image itself, and
a short procedural "click" (WebAudio, two detuned sine bursts through a fast decay envelope — no
audio files, so no asset budget). On completion, the whole board pulses once and the cut lines fade
out over 800 ms leaving the seamless image.

---

## 6. Gameplay

### 6.1 Modes

| Mode | Rule |
|---|---|
| **Classic** | Timed. Par time by piece count. Star rating on finish. |
| **Zen** | No timer, no score. Ambient. |
| **Rotation** | Pieces spawn rotated by a random multiple of 60°. Rotate with `Q`/`E`, wheel, or two-finger twist. Snap requires correct rotation. |
| **Mirror** | The reference image is hidden. You solve by cut shape and local colour only. |
| **Blitz** | Pieces fade toward transparent over 20 s of not being touched. Keep moving. |

### 6.2 Difficulty

Difficulty sets rings, tab size `t` and jitter `j`:

| Name | Rings | Pieces | `t` | `j` |
|---|---|---|---|---|
| Sampler | 1 | 7 | 0.20 | 0.04 |
| Casual | 3 | 37 | 0.18 | 0.05 |
| Standard | 5 | 91 | 0.16 | 0.06 |
| Hard | 8 | 217 | 0.14 | 0.07 |
| Brutal | 12 | 469 | 0.12 | 0.09 |
| Forge | 18 | 1027 | 0.10 | 0.11 |

### 6.3 Interaction

- **Drag** — pointer down picks the topmost piece under the cursor (via §5.2) and its whole cluster.
  Motion is spring-damped toward the cursor, giving weight without lag. Release with velocity tosses.
- **Snap** — on release, for each piece in the moved cluster, check each unconnected neighbour. If the
  offset from the correct relative position is within tolerance, snap. Tolerance is
  `0.28 · R · (1/zoom)` clamped to `[0.12R, 0.5R]` — i.e. **screen-space constant**, per RESEARCH §3.1.
- **Weld** — snapped pieces union-find merge into one cluster with one shared transform. Clusters drag,
  rotate and snap as rigid bodies.
- **Camera** — wheel/pinch zoom about the cursor, drag on empty board to pan, `F` to fit board.
- **Keyboard** — `Tab`/`Shift+Tab` cycles pieces, arrows nudge, `Enter` attempts a snap, `Q`/`E` rotate.
  Full completion without a pointer is a tested requirement (S7).
- **Gamepad** — left stick moves the held piece, `A` grab/release, shoulders rotate.

### 6.4 Assist

- **Edge sort** (`S`) — gathers all border pieces into a ring around the board.
- **Hint** (`H`, limited uses, costs time in Classic) — briefly glows two pieces that connect.
- **Tray** — unplaced pieces scatter in an outer annulus; `G` re-scatters without losing progress.

---

## 7. Persistence

`localStorage` only. No backend (NG2).

- `hexforge.stats.v1` — per `(imageId, seed, difficulty, mode)`: best time, completions, stars.
- `hexforge.session.v1` — full in-progress board state (cluster transforms + union-find) so a reload
  resumes exactly where you were. Written debounced at 2 s.
- `hexforge.prefs.v1` — volume, reduced motion, colourblind mode, high-contrast cuts.

All reads are `try/catch`-wrapped and degrade to defaults; storage may be unavailable or full.

---

## 8. Sharing and seeds

The board is `(imageId | imageHash, seed, rings, mode)`, encoded into the URL hash as a compact
base64url string: `#p=<12 chars>`. Opening the link reproduces the identical board, which makes
races meaningful. `imageId` refers to bundled art; a user-uploaded image encodes its hash and the
link then prompts the recipient for the same file (the image is never uploaded anywhere).

On completion the game renders a **share card** — the solved image, time, stars, seed — to an offscreen
canvas and offers it via `navigator.share` where available, clipboard otherwise.

---

## 9. Print export — the ancestral feature

The project began as an A4 print jig and that capability is kept, upgraded from "stroke a lattice onto
a canvas" to a real vector export.

`Export → Print pattern` produces an **SVG** containing:
- the cut curves as `<path>` elements at true Bézier precision (not the flattened polyline),
- optionally the source image embedded as a base64 `<image>` beneath the cuts,
- correct physical dimensions in `mm` for A4/A3/Letter with a configurable margin,
- a registration mark set and a piece-count legend,
- `stroke-width` in `mm`, single-stroked per edge — the original's whole reason for existing.

Because the cut is deterministic, the printed puzzle and the on-screen puzzle for a given seed are the
same puzzle. That is the nicest thing in the whole spec.

---

## 10. Accessibility

- Respects `prefers-reduced-motion`: it seeds the preference's default, and turning it on disables
  particles, grain and most of the bloom. A stored choice overrides the system setting in both
  directions, because someone who moved the toggle has expressed the stronger opinion.
- **Deviation from the original plan:** the HUD does not follow `prefers-color-scheme`. The board is
  a dark surface in every mode by design, and a light HUD floating over it looked worse than the
  dark one in every arrangement tried. A high-contrast toggle covers the accessibility need that
  the light theme was there to serve.
- High-contrast cut mode draws a bright outline along every piece boundary.
- Colourblind-safe HUD palette; status is never encoded by colour alone.
- Full keyboard operation (S7) with a visible focus ring on the active piece and `aria-live`
  announcements for snaps, hints and completion.
- All controls reachable at 200 % browser zoom; HUD is DOM, so it scales natively.

---

## 11. Testing strategy

Three tiers, all required to pass in CI.

### 11.1 Unit — Vitest, Node environment, no browser

Targets `src/core/**` exclusively; ≥ 90 % line coverage gate (S3).

- hex axial↔pixel round-trips, ring enumeration, neighbour tables, `pieces(n) = 3n²+3n+1`
- edge ownership: every interior edge owned exactly once; every piece has exactly 6 edge references
- PRNG: distribution sanity, and **independence** — computing edge 900's params without computing
  0..899 gives the same result
- **determinism property test** (S5): 500 random seeds, hash the full flattened cut, assert stability
  against a committed golden hash
- Bézier flattening error bound; affine compose/invert round-trip
- union-find: merge correctness, cluster transform application, no cycles
- snap resolution: tolerance scaling with zoom, correct/incorrect neighbour acceptance
- scoring: par curve monotonic in piece count, star thresholds
- seed codec: encode∘decode is identity over fuzzed inputs; rejects malformed hashes
- WGSL static checks (source imported as text): every shader declares its entry points, no binding
  index collisions within a group, no use of optional features without a guard

### 11.2 GPU — Vitest browser mode, Playwright provider, real WebGPU device

Runs with the verified variant-D Chromium flags (RESEARCH §2.2).

- device bootstrap reports required limits and fails cleanly when they are unmet
- **every `.wgsl` in the tree compiles**; `getCompilationInfo()` asserted to contain zero `error`
  messages (S4). This is the single highest-value GPU test — it catches shader breakage that no
  amount of CPU testing can.
- the piece SDF shader, run as a compute kernel over a grid of sample points, produces a distance
  field whose sign changes exactly at the expected boundary for a known seed
- the cluster-transform compute pass produces instance data matching the CPU reference implementation
  (exact `f32` comparison; both do the same arithmetic)
- the particle compute pass conserves particle count and respects lifetimes
- picking: render a known board, read the id target at known coordinates, assert the right piece id
- atlas upload + mip generation produces expected texel values at each level

### 11.3 e2e — Playwright, real browser, real input

- boot: canvas present, adapter acquired, first frame drawn (asserted by non-uniform screenshot)
- capability gate: with WebGPU disabled, the fallback screen renders and is readable
- **solve a 7-piece board end-to-end by dragging**, assert the win state and the recorded time
- **solve a 7-piece board with keyboard only** (S7)
- seed reproducibility: load `#p=...` twice, screenshots match within tolerance
- resume: solve partially, reload, assert board state restored
- print export: click export, intercept the download, assert the SVG parses and has the expected
  path count
- perf: 1000-piece board, measure 300 frames, assert p95 ≤ 16.6 ms (S1) — **hardware runners only**,
  skipped on SwiftShader with an explicit skip message rather than a silent pass
- visual regression on 4 key screens with a tolerant pixel threshold

### 11.4 Media generation

A Playwright script (`npm run media`) drives real gameplay and captures:
- PNG screenshots at 1600×1000 for the README,
- frame sequences encoded to GIF via the `ffmpeg` binary Playwright already ships,
for: board generation, a drag-and-snap with the particle burst, cluster welding, the completion
sequence, and the print export. Output committed under `docs/media/`. Regenerating is one command,
so the README never goes stale.

---

## 12. CI/CD

`.github/workflows/ci.yml` on push/PR:

1. `typecheck` (tsgo, strict)
2. `lint` (oxlint + the import-boundary rule from §2)
3. `test:unit` + coverage gate
4. `test:gpu` (Chromium, variant-D flags)
5. `test:e2e` (Chromium, variant-D flags)
6. `build` + `size-limit` gate (S6)

`.github/workflows/deploy.yml` on push to `master`: build with `base: '/hex-puzzle-generator/'`,
upload artifact, `actions/deploy-pages`. Requires flipping the repo's Pages `build_type` from
`legacy` to `workflow` (RESEARCH §2.5).

---

## 13. Definition of done

- [x] All of §11 passing in CI on a clean checkout
- [~] S1–S7 measured. S1 (frame budget) is **not** measured: the test skips on a software adapter
      rather than reporting a CPU rasteriser's timings, and CI has no hardware GPU. No frame time
      is claimed anywhere. S2–S7 hold.
- [x] Live at `https://rpcal.github.io/hex-puzzle-generator/`
- [x] README with generated GIFs and screenshots, controls, architecture and the story of the rewrite
- [x] Print export produces a physically correct A4 SVG (asserted against a browser's own XML parser
      in e2e, and against the `210mm × 297mm` viewBox in unit tests)
- [x] Zero runtime dependencies (asserted by a test)
- [x] The original's five documented bugs (RESEARCH §1.4) verifiably absent

### Open

- **S1, the frame budget on real hardware.** Everything needed to measure it is in place; it needs a
  runner with a GPU. Until then the number is not claimed.

  A software-rasteriser floor *has* been measured by hand: the 1027-piece board at 1280×800 under
  SwiftShader generates in 306 ms and holds p50 7.5 ms / p95 14.3 ms over 335,122 triangles. Real
  hardware can only be faster, but "faster than a CPU rasteriser" is not the same statement as S1
  and is not recorded as one.
- Rectangular boards are generated and exported but are not offered in the UI; they exist for the
  print path, where paper is rectangular.
