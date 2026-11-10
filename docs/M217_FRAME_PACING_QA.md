# Traffic Pulse M217 — presentation pacing / micro-stutter follow-up

**Branch:** `feature/m217-vkgames-presentation-pacing` (cumulative M202–M217).  
**Base:** M216 smooth-frames candidate. **Draft only** — do not merge into `vk-games`, publish or change the Cloudflare Worker before manual QA.

## Motivation and evidence (Windows screenshot, 2026-11-10)

- FPS median ≈60, rAF frame p95 33.3 ms, slow frames (>25ms) 7%.
- Canvas draw p95 5.7 ms, quality Medium.
- Player reports visible micro-stutter of cars and people.
- These numbers confirm frame pacing spikes but do **not** alone prove GPU, simulation, GC or browser scheduling as the cause. M216 previously removed an unconditional 30 FPS cap for stable Low-detail devices; the remaining stutter is not the same defect.

## M217 changes

- Crossing pedestrian authoritative position `t` is unchanged for signal hold and game logic; `prevRenderT` is copied on each 60Hz update. The drawing position linearly interpolates `prevRenderT`→`t` using `renderAlpha`, just like vehicles already do.
- Visual-only city animations (sidewalk residents, dog walkers, weather, street life) use `presentationElapsed(game)` to interpolate between fixed simulation ticks. The simulation's `game.elapsed` is never altered, including during pause.
- `?tpperf=1` adds separate 180-frame rolling `Loop p95` (total synchronous rAF callback work), `Sim p95` (simulation/catch-up), and `Catch-up frames %` (more than one simulation tick per rAF) next to existing FPS, frame p95, slow frames, Canvas draw p95 and Quality.
- The perf HUD stays opt-in; it collects no accounts, player identifiers, progress or save data.
- The `M217-VKGAMES-PACING-RC` asset cache key and M217 ZIP filename prevent mixing the new code with previous M216 cached builds.

## Windows A/B diagnostic procedure

1. Run M216 and M217 locally on the **same PC / browser**, same screen resolution and same level, with `?tpperf=1` appended. Avoid running both games at once.
2. Play for 90–120 seconds with similar traffic density; avoid tab-switching, resizing, DevTools recording and the first few seconds of asset/cache warming.
3. Compare **Frame p95**, **Slow frames %** and visually observed steps of cars, crosswalk pedestrians and decorative walkers. Compare raw FPS only as a secondary metric.
4. If Frame p95 is ~33.3 ms but Loop p95 and Sim p95 remain well below 16.7 ms, investigate browser/compositor/vsync scheduling, other browser tabs, browser frame limiting, display refresh and OS background work; do not blindly reduce Canvas quality.
5. If Loop p95 or Sim p95 grows near/above 16.7 ms, capture a Performance timeline (main-thread JS, style/layout, GC and raster) around a bad frame and narrow the hot path.
6. Use the opt-in HUD snapshot `window.__trafficPulsePerfSnapshot` only for local troubleshooting. Do not transmit account/save information.

## Automated gates

- New regression `tests/vk-games-presentation-smoothing.test.mjs`: crossing interpolation, authoritative progress untouched, no-history fallback, endpoint values, paused visual clock, multiple catch-up updates, privacy-safe perf breakdown.
- Existing simulation timing, movement, signal, storage, browser viewport and package gates remain mandatory.
- CI Chromium run and Windows manual A/B determine if M217 is a valid replacement candidate.
- **Do not claim remaining physical micro-stutter is fixed until the actual affected PC shows improvement.**
