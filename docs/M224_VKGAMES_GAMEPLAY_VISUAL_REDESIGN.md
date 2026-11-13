# M224 — VK Games moderation recovery: gameplay + art direction (experimental)

## Context / why this branch exists
VK Games moderation feedback (provided by the developer, 12 Nov 2026):
- Core loop does not make players want to keep taking actions.
- The art direction appears generic / AI-like and lacks a recognizable identity.

These are **product-quality observations**, not a bug report or proof that new badges alone will fix engagement. Do not merge to the released branch until a real playtest confirms improvement.

## Diagnostic baseline
- The live core is traffic-light switching with automatic traffic and a failure for crash or excessive queue.
- M223 already includes interactive onboarding, missions, combos and multiple game modes.
- The highest-value gap to explore first is **clear short-term cause → effect → payoff** while playing, not another distant metagame reward.

## M224 vertical slice: Clean Wave
- In **campaign levels 1–20**, show an optional target: release 2 (L1–2), 3 (L3–10), or 4 (L11–20) cars during **one uninterrupted selected green phase**.
- Until the player actually switches a light, the goal does not accumulate progress.
- A subsequent player switch resets an incomplete series; departures from another axis or during clearance do not count.
- On completion, show immediate clear feedback; on **first level clear only**, add **25 coins** using the existing one-time campaign reward path.
- Existing stars, queues, crashes, deterministic RNG, simulation timestep, cloud schema and other modes remain unchanged.
- The goal is optional; the player can finish the level without it. There are no new lives/energy/ad gates.

## Visual direction: Dispatch Atlas
- A purposeful municipal control-room vocabulary: route signage, amber ink and muted petrol/slate, hard-edged blocks, printed map grid rather than oversaturated glass/neon.
- Preserve traffic phase and crash affordances; keep existing accessible 44px+ targets.
- This commit is a **shell/UI art-direction prototype**, not a replacement for every city, vehicle and environment asset. Before resubmission, evaluate custom gameplay-world art and typography together.

## Release gates / manual research
1. CI: node syntax, existing Node/Python regression, screenshot smoke and minimal VK/OK ZIP allowlist include `pulse-contract-core.js`.
2. Manual: on campaign L1 after tutorial → switch to V → wait for two N cars to leave → 'Clean Wave' complete; success popup shows a 25-coin first-clear bonus. Replay cannot yield another 25-coin bonus.
3. L2–10: incomplete series resets when switching; a wrong direction and yellow clearance do not add progress.
4. All other modes and level 21+: no contract UI; unchanged score/save logic.
5. Check 390×844, 844×390 and desktop: objective stays legible; no overlap with tutorial/phase badges or inaccessible controls. Also do physical iOS/Android checks.
6. Observe at least 5 uncoached first-time players: can they explain the goal without prompting? Are clicks deliberate rather than random? Does anyone choose to replay to improve a run? Record failures rather than expecting a pass.

## Next design experiments (not implemented)
- M225: reshape early traffic-wave schedules to create explicit alternative choices and short relief beats, then re-run solvability and first-session audits.
- M226: clearer 'decision → cars released / queue stabilized' feedback and better win-to-next-level pacing.
- M227: original, cohesive road/building/car/animation art kit with an asset ownership/licensing audit; do not substitute polished-looking generated decorations for gameplay clarity.
- M228: observe first-session engagement; compare control cohort, iteration, crash rate, retries and voluntary next-level clicks before submitting to moderation.

**Status:** prototype only; no claim of improved retention, approval, or live VK SDK validation.
