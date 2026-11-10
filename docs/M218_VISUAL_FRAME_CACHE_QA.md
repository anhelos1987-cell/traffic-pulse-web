# Traffic Pulse M218 — render-frame city snapshot and allocation hardening

**Basis:** cumulative M217 at `24b21acc48c01b0971ca1fbdf3fca823fade321b`.  
**Branch:** `feature/m218-vkgames-visual-frame-cache`. **Draft / preview only.**

## Diagnosis

M217 addresses interpolation, but the Windows baseline from 2026-11-10 showed ~60 median FPS, rAF p95 33.3ms, slow frames 7%, Canvas draw p95 5.7ms. These numbers do not identify whether missed frames originate in JavaScript, garbage collection, other tabs, the browser compositor or graphics driver.

Source audit of M217 found that the living-city Canvas pipeline has ~15–20 independent ambient layers that call `cityRhythmState(game)` each draw, which in turn recalculates `cityReactionState(game)` by scanning the same vehicle array. Each function creates short-lived objects. Many layers repeat the same weather/district/queue computations during *one synchronous draw*, despite sharing the same immutable simulation time.

## M218 implementation

- Create a **single visual snapshot per Canvas draw**: interpolated elapsed time, traffic reaction state and city rhythm state.
- Lazily compute and reuse the reaction/rhythm only if the corresponding layer requires it. This avoids extra work when Low detail or reduced-motion conditions skip ambient layers.
- Begin snapshot only while entering the normal canvas draw; clear in `finally` even when the render fallback is triggered. On the collision/simulation/HUD/save/SDK path, no snapshot is active.
- Do not modify fixed-step simulation, car/pedestrian trajectories, signals, collision checks, traffic RNG, cloud saves, purchases or platform handling.
- Bump only the gameplay asset cache key and M218 packaging identity, so local A/B tests cannot accidentally use the M217 script.

## Acceptance criteria

- Node tests confirm repeated visual-state requests in one draw return the same object and make the weather/district calculations once, compared with recomputing each call.
- A new draw recomputes fresh state. Calls outside Canvas drawing do not reuse an old snapshot.
- Test shows the game model is untouched, including car array and elapsed time.
- Existing M203–M217 movement, timing, interpolation, save and browser regression gates remain green.
- GitHub Actions creates M218 ZIP plus manifest and three Chromium smoke viewports, including mobile rotation checks.
- **Windows manual test remains mandatory:** A/B compare M217 vs M218 on the affected PC, same level/scene/browser, use `?tpperf=1`, watch Frame p95, Slow frames, Loop p95, Sim p95 and Catch-up. If rAF p95 remains 33.3ms while Loop/Sim are low, investigate OS/browser/vsync rather than declaring graphics cost the cause.

## Release isolation

Only the cumulative draft feature branch is changed. `vk-games`, `release/yandex`, live VK/OK cloud, billing and published assets remain untouched. M218 is not automatically production-ready after a green CI.
