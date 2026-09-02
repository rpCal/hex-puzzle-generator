# RESEARCH — hex-puzzle-generator → HEXFORGE

Date: 2026-09-02
Author: rewrite planning pass
Status: complete, feeds `SPEC.md` and `PLAN.md`

---

## 1. What the existing project actually is

The repo at `github.com/rpCal/hex-puzzle-generator` is a single-commit (`31b0dc9 full scrupt`)
TypeScript project from the 2018 toolchain era. 265 lines of source across three files.

### 1.1 File-by-file autopsy

| File | LOC | Role |
|---|---|---|
| `src/app.ts` | 52 | Entry point. Boots on `window.load`, wires a `<input type=file>` to a `<canvas>`. |
| `src/grid.ts` | 163 | The whole product. Draws a flat-top hexagonal tessellation onto a 2D canvas context. |
| `src/color.ts` | 50 | A packed-ARGB `number` colour helper (`0xAARRGGBB`) with static channel accessors. |
| `public/index.html` | 35 | Canvas sized `1123 × 1587`, plus print CSS that hides the file picker. |
| `webpack.config.js` | — | webpack 4, `ts-loader`, output to `public/build/build.js`. |
| `jest.config.js` | — | jest 23 + ts-jest. **Zero test files exist.** |

### 1.2 What it does, precisely

`Grid` has two renderers:

**`draw(ctx)`** — the naive one. For each row `j` and column `i` it computes a hex centre and
strokes a closed 6-gon by walking `a = 0..5`, `angle = a·60° + 90°`. Because every hex strokes its
own full outline, every interior edge is drawn **twice**. At `strokeWidth = 0.5` on a printer that
means every shared edge prints at double density — the reason the second renderer exists.

**`drawWithoudRepeat(ctx)`** (sic — typo preserved in the original) — the shipped one, called by
`app.ts`. It abandons per-hex outlines and instead emits the tessellation as a **zig-zag lattice**:
per row it walks `i = 0 .. 2·sw` in half-column steps, alternating the vertical offset by `±r/2` to
trace the up-down-up-down chevron that forms the shared top/bottom edges, then separately emits the
vertical connector segments every other `i`. Each edge is stroked exactly once. It carries a
hand-tuned special case (`if (j == sh && (i == 1 || i == swx*2) && j % 2 == 0)`) to suppress two
dangling stubs on the final row.

Geometry constants: for circumradius `r`, the inradius is `h = r·√3/2`; horizontal pitch
`hs = 2h = r√3`, vertical pitch `vs = 1.5r`. That is the standard **pointy-top axial layout**
(the `+90°` phase in `draw` rotates the 6-gon so a vertex points up).

`app.ts` then: fills white → draws the grid → on file pick, `FileReader.readAsDataURL` → `Image` →
`drawImage(i, 0, 0, canvas.width, canvas.height)` **stretched to canvas size** (aspect ratio is not
preserved) → re-strokes the grid on top.

### 1.3 What it is *for*

The commented-out line in `index.html` is the tell:

```html
<!-- Wymiary pliku w pikselach do druku w jakości 72 DPI: 842 x 1 191 px-->
```

842 × 1191 px is **A4 at 72 DPI**. The live canvas is 1123 × 1587 — A4 at 96 DPI. Combined with the
`@media print` block that hides the picker, the artefact is unambiguous: this is a **print jig**.
You load a photo, it overlays a single-stroke hex lattice, you print it on A4, and you cut along the
lines to make a physical hexagonal jigsaw puzzle.

It is not a game. It is a tool for manufacturing a game out of paper.

### 1.4 Honest assessment of what carries forward

**Worth keeping (the ideas):**
- Pointy-top hex tessellation math (`h = r√3/2`, `hs = 2h`, `vs = 1.5r`) — correct, reuse it.
- The *no-double-stroke* insight. In print it prevents ink doubling; in a GPU renderer the same
  insight becomes "own each edge exactly once" which is what makes seeded edge generation coherent
  (each shared edge must produce one cut curve, shared by both neighbours, or pieces won't interlock).
- The A4 print target. This is a genuinely good feature nobody else ships and it is being *kept*
  (see SPEC §9, the SVG cut-pattern export).

**Worth deleting (the code):**
- `Color` as packed `number`. Loses precision intent, forces `>>`/`&` at every use site, no colour
  space awareness. Replaced with typed float RGBA and OKLCH-aware palette handling.
- `drawWithoudRepeat`'s lattice walk. It is correct but it is a 60-line nested loop with two magic
  parity branches and one hardcoded special case. The same result falls out of an explicit
  half-edge / axial-coordinate model in a fraction of the code, and that model is what the game
  actually needs (adjacency graph for snapping).
- Everything about the toolchain: webpack 4, ts-loader, jest 23, TypeScript 3.0, `lite-server`.
  All EOL. `tsconfig.json` is the 2018 VS default with ~150 lines of commented-out options.
- Immediate-mode 2D canvas. Cannot express the target rendering.

**Bugs found in the original (documented, then made irrelevant by the rewrite):**
1. `drawImage(i, 0, 0, canvas.width, canvas.height)` distorts any image whose aspect ratio ≠ 1123:1587.
2. `draw()` double-strokes every interior edge (acknowledged by the existence of the second method).
3. `console.log("Grids:" + (sw*sh - ((sh-1)/2)))` — the piece count is wrong for even `sh`
   (fractional result), and it ships to production.
4. `sw`/`sh` are derived using `this.padding` but the centring offsets `px`/`py` are not, so
   `setPadding()` shrinks the grid without actually centring the padding.
5. Repeated `ctx.beginPath()/stroke()` per segment — thousands of draw calls for one static lattice.

---

## 2. Technology research

Everything below was **verified empirically in this environment**, not taken from documentation.

### 2.1 WebGPU is a legitimate deployment target as of 2026

WebGPU reached Baseline in January 2026. Chrome/Edge since 113 (2023, D3D12 on Windows, Metal on
macOS, Vulkan on Android 12+ since Chrome 121), Firefox 141 (Windows, July 2025) and 145 (macOS
Apple Silicon), Safari 26.0 (macOS Tahoe, iOS 26, iPadOS 26, visionOS 26).

**Consequence for the spec:** WebGPU-first with no WebGL fallback path is defensible. A capability
gate with an honest, well-designed "your browser doesn't have WebGPU yet" screen is the correct
handling, not a second renderer that doubles the surface area.

### 2.2 WebGPU **does** run headless in CI — verified

This was the single biggest risk in the whole project: if WebGPU cannot run in GitHub Actions, then
there are no GPU tests, no e2e tests, no automated screenshots and no GIFs. It was de-risked first.

Four Chromium launch configurations were probed with Playwright 1.62.1:

| Variant | Flags | Result |
|---|---|---|
| A | *(none)* | `no adapter` |
| B | `--enable-unsafe-swiftshader` | `no adapter` |
| C | `--enable-unsafe-webgpu --enable-unsafe-swiftshader` | adapter obtained, but `OperationError: A valid external Instance reference no longer exists` — unstable |
| **D** | `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan --use-vulkan=swiftshader --enable-unsafe-swiftshader` | **full pass** |

Variant D returned:

```json
{ "ok": true, "vendor": "google", "arch": "swiftshader",
  "compute": [1, 4, 7, 10], "renderOk": true, "maxTexture": 8192 }
```

- `compute: [1,4,7,10]` is the correct output of `data[i] = i*3 + 1` read back through a
  `MAP_READ` staging buffer — so **storage buffers, compute pipelines and buffer readback all work.**
- `renderOk: true` — a render pipeline drew a full-screen triangle into a `getContext('webgpu')`
  canvas and `queue.onSubmittedWorkDone()` resolved.
- `maxTextureDimension2D: 8192` — the budget for the source-image atlas.

**Later finding — the flag set alone is not sufficient.** Variant D was verified on a workstation
with `libvulkan1` installed. On a GitHub Actions runner, which has no Vulkan loader, the *same*
flags degrade into something that behaves like variant C: compute shaders and buffer readbacks work
perfectly, and anything that touches a canvas swapchain drops the Dawn instance. The failure then
surfaces as `mapAsync` rejecting with *"A valid external Instance reference no longer exists"* from
whichever readback happened to be in flight — naming neither the cause nor the culprit.

Chromium bundles SwiftShader, but reaching it through ANGLE needs the system loader, so CI installs
`libvulkan1` and `mesa-vulkan-drivers`. The diagnostic that isolated it was that the compute-only
tests passed in CI while every canvas-based test failed; a GPU test now checks the swapchain
immediately after the device is acquired so the failure names itself.

**Additional finding — `navigator.gpu` requires a secure context.** `data:` URLs are opaque origins
and `navigator.gpu` is `undefined` there. `http://localhost` is a secure context and works. All GPU
tests must be served over localhost, never navigated to as a data URL.

### 2.3 WebGPU canvas content **is** captured by `page.screenshot()` — verified

Not a given: some headless GPU paths render correctly but never composite into the screenshot
surface, which would silently produce black images for every screenshot, GIF and visual-regression
baseline. Probed with a gradient shader `vec4f(fragCoord.x/200, 0.15, 0.85, 1)` on a 200×200 canvas:

```
size 200 200  bitdepth 8  colortype 2 (RGB)
pixel(0,0) = rgb(1, 38, 217)
```

Expected `(0.0·255, 0.15·255, 0.85·255)` = `(0, 38, 217)`. Match within one LSB of the gradient.
**Screenshot compositing of WebGPU canvases works headless.** Visual regression, README screenshots
and frame-sequence GIF capture are all viable in CI.

### 2.4 Toolchain versions (resolved from the registry, 2026-09-02)

| Package | Version | Note |
|---|---|---|
| `vite` | 8.2.2 | Rolldown-based; native ESM dev server |
| `vitest` | 4.1.11 | Node env for pure logic, browser mode for GPU |
| `@vitest/browser` | 4.1.11 | Playwright provider — lets GPU tests run as real Vitest tests |
| `typescript` | 7.0.2 | Native (Go) compiler, `tsgo` |
| `@playwright/test` | 1.62.1 | e2e + media capture |
| `@webgpu/types` | 0.1.72 | `GPUDevice` etc. typings |
| `wgpu-matrix` | 3.4.2 | Candidate for mat/vec — **rejected**, see below |

Local environment: Node v24.15.0, npm 11.12.1, Playwright browser revisions already cached
(`chromium-1234`), `gh` authenticated as `rpCal`.

**`wgpu-matrix` rejected.** The game is 2D. It needs a 3×3 affine transform, a hex-axial↔pixel
conversion and a cubic Bézier evaluator — roughly 120 lines of pure functions that are themselves
prime unit-test targets. Pulling a 3D matrix library to avoid writing them would add a dependency,
remove testable surface area, and ship unused 4×4/quaternion code. Written in-house under
`src/core/math/`.

**Shader loading.** `vite-plugin-glsl` supports WGSL, but Vite 8 imports `.wgsl` fine via
`?raw`, and a 40-line custom plugin gives `#include`-style composition plus a `WGSL` template tag
with no dependency. Custom plugin chosen — it also lets shader source be imported into Node-env
Vitest tests for static validation (entry points present, no `f16` without the feature, bindings
declared) without a GPU.

### 2.5 Repo / deployment state

- GitHub Pages is **already enabled** but `"build_type": "legacy"`, `source: {branch: "master", path: "/"}`.
  Must be switched to `"build_type": "workflow"` so `actions/deploy-pages` can publish `dist/`.
  Current live URL: `https://rpcal.github.io/hex-puzzle-generator/` — preserved.
- Single branch `master`, one commit, no open issues, issues enabled.
- Because the site is served from a project subpath, Vite needs `base: '/hex-puzzle-generator/'`.

---

## 3. Design research — what makes a jigsaw actually good

Surveyed the adjacent prior art in this workspace (`../jigsaw/jigsaw-hex.html`, a CC0 SVG hex-jigsaw
generator by draradech) and the wider genre.

The `jigsaw-hex.html` reference encodes the standard **10-control-point tab curve**: an edge is a
sequence `p0..p9` in edge-local `(l, w)` space where `l` runs 0→1 along the edge and `w` is
perpendicular displacement. `t` is tab size, `j` is jitter, and per-edge randomness `a..e` perturbs
the control points while `flip` mirrors `w` to decide which side the tab bulges. That parameterisation
is excellent and is **adopted directly** — it is the reason a cut looks hand-made rather than
algorithmic. Its PRNG (`Math.sin(seed)*10000` fract) is not, and is replaced by a proper
counter-based hash (see SPEC §4.2).

Findings on feel, which drive the spec:

1. **Snap tolerance must scale with zoom, not be a fixed world distance** — otherwise the game is
   trivially easy zoomed out and unplayably fussy zoomed in.
2. **Connected pieces must weld into a rigid cluster** that drags as one unit. This is a union-find
   over the adjacency graph and is the single biggest contributor to "feels like a real jigsaw".
3. **Piece pick-up must raise z-order and cast a shadow.** Without depth cueing, a dragged piece
   reads as part of the board.
4. **The snap must be celebrated.** A silent snap feels like a bug. Audio + a particle burst + a
   brief bloom pulse is the difference between "correct" and "satisfying".
5. **Determinism is a feature, not an implementation detail.** If a seed reproduces an exact cut,
   players can share and race identical boards. This is nearly free if the PRNG is right and
   impossible to retrofit if it isn't.

---

## 4. Risk register after research

| Risk | Status |
|---|---|
| WebGPU unavailable in CI | **Eliminated** — variant D verified working, plus `libvulkan1` on the runner (see §2.2) |
| Screenshots of WebGPU canvas come out black | **Eliminated** — pixel-verified |
| SwiftShader too slow for e2e | Open — mitigate with a `?pieces=` URL param so tests run small boards |
| Shader compile errors only surface at runtime | Mitigated — Node-env WGSL static checks + a GPU test that compiles every shader and asserts zero `error` compilation messages |
| Float precision differences GPU vs SwiftShader break visual baselines | Mitigated — visual assertions use tolerant pixel-difference thresholds, and layout-critical assertions read back from storage buffers (exact integers) rather than comparing images |
| Pages `build_type: legacy` blocks Actions deploy | Known — flip via `gh api` in setup |

---

## 5. Conclusion

The original is a 265-line print jig with a correct hex tessellation and a good reason to exist.
The rewrite keeps the tessellation math and the print export, discards the toolchain and the
rendering approach entirely, and builds the game the print jig was always a proxy for.

WebGPU in CI — the one thing that could have made the "tests + screenshots + GIFs" requirement
impossible — is verified working. Proceed to `SPEC.md`.
