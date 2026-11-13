# M228 — First Ten Real-Engine Audit & Atlas Continuity

**Date:** 2026-11-13. **Status:** VK Games/OK Games *draft*, not an approved build or proof of engagement.

## Purpose and evidence
VK Games moderation previously flagged weak sustained gameplay motivation and generic-looking visuals. M224–M227 addressed immediate feedback and early presentation. M228 adds an evidence-driven first-ten *real runtime playthrough*, rather than judging difficulty from source schedules alone.

A new CI script `scripts/first-ten-campaign-audit-vkgames.mjs` boots the actual shipping page in headless Chromium and injects a QA handle **only into the request-served app.js**, never into the production package. It freezes the real-time driver and calls the unmodified `Game.update(1/60)` fixed-step engine. Its queue-aware controller observes current spawned car positions, green phase and occupancy, then calls the **real `Game.toggle()`** method when the other visible stream is waiting. It never reads future plan entries or forces traffic progress, car removal, win, scores or ad rescue.

### Observed M228 baseline

| Campaign level | Outcome | Cars cleared | Simulated time, s | Actual switches | Peak queue | Clean Wave |
|---:|---|---:|---:|---:|---:|---|
| 1 | WIN | 5/5 | 10.68 | 1 | 2 | Yes |
| 2 | WIN | 6/6 | 14.65 | 2 | 2 | Yes |
| 3 | WIN | 8/8 | 19.28 | 3 | 2 | Yes |
| 4 | WIN | 8/8 | 15.27 | 1 | 3 | Yes |
| 5 | WIN | 9/9 | 12.13 | 1 | 3 | Yes |
| 6 | WIN | 10/10 | 21.03 | 2 | 2 | Yes |
| 7 | WIN | 12/12 | 16.13 | 2 | 3 | Yes |
| 8 | WIN | 12/12 | 27.82 | 3 | 2 | Yes |
| 9 | WIN | 12/12 | 17.35 | 2 | 3 | Yes |
| 10 | WIN | 12/12 | 21.08 | 2 | 2 | Yes |

**Summary:** 10/10 real-engine wins without assists, 94/94 cars cleared, 19 total signal switches. Mean 17.54 s, median 16.74 s, simulated level duration range 10.68–27.82 s. Peak stopped-per-approach queue 2–3. Every scripted run satisfies Clean Wave.

**Important interpretation:** This establishes a **baseline solvability proof for one deterministic control policy**, not broad human solvability, 3-star mastery, real-time performance on low-end devices, or increased retention. All ten Clean Wave successes and low switch counts suggest the optional objective may be *too easily obtained by a practiced player*. Do not infer that novices find it trivial: test unprompted human behavior before touching reward or queue pressure.

Data produced by CI: `artifacts/browser-smoke/m228-first-ten-audit.json` (inside the browser smoke GitHub Actions artifact).

## Visual direction (no change to physics or saving)
M228 extends the original small, quiet vector **Dispatch Atlas** map from campaign levels 1–10 to **1–30**, matching the first three city districts:
- **1–10 Park:** planted green palette and the original four landmark silhouettes.
- **11–20 Coast:** sea-glass/sand palette, authored wavy coastal markings.
- **21–30 Downtown:** mineral-gray architecture palette, small authored skyline symbols.

Static world cache is still bounded and keyed by `theme.id:lanes:junctionType:focus/city`. A level 11 coast or level 21 downtown image cannot accidentally reuse Park pixels. **Level 31+** uses the existing more detailed city simulation and renderer. Daily, weekly, scenarios, Green Wave and Endless retain their pre-M228 worlds; the portrait dispatch console remains limited to campaign levels 1–10.

CI captures `m228-level-11-coast.png`, `m228-level-21-downtown.png`, `m228-level-31-legacy-city.png`. Only static presentation data changed: traffic geometry, routing, spawn configurations, colliders, CPU fixed-step, campaign rewards, cloud/save data, platform callbacks, ads and purchases are unchanged.

## Tests / provenance
- GitHub Actions [run 43362140004](https://github.com/anhelos1987-cell/traffic-pulse-web/actions/runs/43362140004): **SUCCESS**, 158/158 Node tests and browser smoke including real first-ten wins.
- Packaging: **15 root-level shipping files**, ZIP SHA-256 `369c0027d24f9cb5eba5f943c409395849191a05c4a37cfd320e11448ce45046`.
- Production runtime is not instrumented; the test QA handle is request-scoped.
- Manual external gates still required: VK/OK auth/cloud/ad callbacks, iOS and Android physical devices, level 1–10 hand playthrough and at least five uncoached players.

## Next product decision gate (M229)
Compare real player success, time to first meaningful switch, observed confusion, crash/retry, voluntary next-level and replay behavior across M223 baseline and M228. The low 1–3 switch count suggests **more varied player choices** may be needed by levels 7–10, but only after testing; simply adding more cars or more buttons is not a sound fix for a moderation rejection. Evaluate HUD readability and visual identity on real phones before expanding the Atlas beyond level 30.

Do not merge into `vk-games` until external quality evidence supports it.
