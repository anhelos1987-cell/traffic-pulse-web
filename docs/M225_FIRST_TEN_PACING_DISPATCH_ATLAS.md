# M225 — First-ten traffic pacing and original Dispatch Atlas world

**Status:** cumulative, experimental follow-up to M224. Not approved or released.

## Why this change

VK Games moderation criticized a weak action→result→next-action loop and generic-looking art. M224 tested a one-green "Clean Wave" objective. M225 prioritizes *understanding the decision* and *seeing traffic*, instead of growing meta systems.

## Player-facing design

- Levels 1–10 remain short single-junction trials. Level 1 training plan stays unchanged.
- Levels 3 and 6–10 use hand-shaped traffic groups with intentional H↔V hand-offs and a minimum contiguous platoon of three.
- First ten campaign levels: vehicles move 8% faster; signal clearance is 1.16 s (never less than the existing safe minimum); the extra density is offset by more readable arrival spacing in levels 6–10.
- A small **NEXT / СЛЕДОМ** chip previews the next unspawned contiguous group and direction. It is factual, not an AI hint: derived solely from the existing deterministic `config.plan`, capped at four upcoming vehicles, hidden after all cars are spawned.
- The incoming-direction chip is visible only in campaign levels 1–10; training/other modes and levels 11+ are unaffected.
- The M224 optional Clean Wave objective still provides per-switch stakes and first-clear-only coins.

## Original 2D "map board" for opening sessions

In first-ten campaign levels and tutorial, use a custom in-code illustrated map with four distinct quarters (muted green/slate rooftops, a park mark, consistent signage). Draw it once to the **bounded existing 900×900 world cache**, under all game cars and traffic lines.

The **physical road / marking functions are unchanged**. The map is just presentation. Skip most ambient decorative animations that previously competed for attention during introductory decisions. This is a deliberate, cohesive minimalist direction, not unrelated AI picture assets.

Cache key distinguishes `focus` from `city` so daily/weekly and later districts keep their original environment. Canvas presentation mode does not enter deterministic update/scoring or cloud-save state.

## Planned first-ten player beats

| Level | Beat | Relevant player choice |
| --- | --- | --- |
| 1 | Single V stream | One obvious switch to free a waiting lane |
| 2 | Horizontal then vertical | Switch back when the other queue builds |
| 3 | V–H–V | Recognize an interrupted group and finish the intended flow |
| 4 | H–V–H | Let the first convoy pass before the hand-off |
| 5 | V then two H arms | Keep multiple approaches moving without churning phases |
| 6 | H–V–H–V | Pedestrians enter the rules; prepare the next phase |
| 7 | V–H–V | First repeated-axis decision with a late side branch |
| 8 | H–V–H–V | Cross-direction alternating rush, with recovery spacing |
| 9 | V–H–V | Four-arm recognition without random order |
| 10 | H–V–H | A bigger batch that rewards one planned final release |

These are **authoring intents**, not evidence players find the levels fun. Do not claim success without observing new-player behavior.

## Scope and invariants

**Preserved:** one-touch signal control, traffic collision logic, scoring thresholds, clean-wave reward idempotence, Save schema, cloud, ads, platform lifecycle, later levels, daily/weekly/scenario/green-wave/endless modes, 60 Hz fixed-step, quality adaptation.

**Changed:** five early traffic plans, Level 6 plan, first-ten speed/clearance values, early world presentation, a noninteractive next-arrival indicator, corresponding tests and packaging metadata.

## Mandatory gates before moderation re-submission

1. Node/Python tests, browser smoke, build ZIP integrity PASS.
2. Inspect gameplay screenshots in all supported viewport classes: cars and traffic lights must stand out; no forecast overlap with phase indicator, controls or hints.
3. A real first-ten playthrough: no impossible queues or unfair collisions. Replay L1 and L6 after entering/restarting tutorial.
4. Confirm modes and levels 11+ keep normal city visuals; contrast and RU/EN are clear; reduced-motion needs no animations.
5. Actual VK/OK container sign-in, cloud, ads, pause/resume, purchases, offline/online; mobile iOS/Android profiling.
6. At least five first-time playtesters and data on deliberate switch timing, comprehension of the next-wave cue, crash/retry frequency, voluntary next-level and replay decisions. Compare to M223/M224 baseline.

**Risk:** Speed and traffic-plan changes need real level solvability and user testing. Browser smoke proves rendering/boot/control, not engaging gameplay or a moderation acceptance.
