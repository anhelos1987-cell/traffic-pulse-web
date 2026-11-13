# M226 — Outcome before exit: action-to-consequence feedback

**Experimental VK Games moderation recovery, not a live deployment.**
M226 continues M224–M225. Its narrow question is whether a first-time player understands what pressing the traffic light actually *accomplished*, without adding mandatory controls.

## Gameplay-facing change
On campaign levels 1–10, the first tap displays a small **dispatch receipt** in the corner of the actual board:
1. Request sent / clearance in progress: **ПЕРЕКЛЮЧЕНИЕ ↕ / SWITCHING ↕** and the **queue count observed when the button was pressed**.
2. After clearance: **ПОТОК ОТКРЫТ ↕ / GREEN OPEN ↕**.
3. When a committed vehicle genuinely crosses the common junction approach marker at progress 365 on that selected green: **ПРОЕХАЛО ↕ / PASSED ↕ ×1**, then ×2, ×3, etc.

The receipt expires after a short bounded interval; a new tap starts a new record. An empty request shows **БЕЗ ОЧЕРЕДИ / NO QUEUE**, never invents a passed vehicle. This is purposefully not a money/XP meter, failsafe hint, or compulsory mechanic.

## Important correctness rule
A result is **credited at actual approach crossing**, not at tap time, or when a newly spawned car enters the map. Each vehicle must:
- cross from position before 365 to position at/after 365;
- be committed to a valid signal;
- match the selected green phase and not be in a transition;
- have no active emergency red priority or signal violation;
- not already have been attributed to the same receipt.

The M224 **Clean Wave** progress also updates at the crossing now instead of at world exit. All other scoring/level rules and currency formula stay the same. Late exits no longer double count it.

## Architecture / stability
- New small pure `dispatch-receipt-core.js`; tested independently from Canvas/DOM.
- Presentation-only `Game.dispatchReceipt`, reset on mode/level switch; never serialized; no RNG, no change to traffic physics or collision.
- Existing fixed-step simulation emits only ephemeral crossing events; `hudDirty` coalesces display update at regular UI cadence, no DOM mutation in simulation tick.
- Native accessible status element, RU/EN strings; no new clickable element or interrupting modal.
- Gameplay preview / advanced modes unaffected. The original M225 map presentation remains.
- VK/OK package shipping allowlist and version keys extended for the new module.

## Validation / caveats
Automated tests cover mode isolation, actual crossing, red/yellow/transition exclusions, stale receipt window, one credit per car, integration wiring, and later full browser smoke.
Live smoke must reach the real crossing after tutorial and read ×1 (not only inspect the source).
For moderation: test 5+ new players *without coaching*, including how quickly they connect a switch to vehicles passing. Measure first-level clear, time-to-first-effective-switch, retry, voluntary next level, confusion at empty queue, and whether the receipt draws too much attention away from the road.

**Still needed:** actual VK/OK container API verification, mobile physical device checks, all ten levels manual success/failure run, human taste/art review and retention analysis. No claim this guarantees passing moderation or improves engagement yet.
