# M227 — Portrait Dispatch Console & Original Map Landmark Kit

**Type:** experimental VK Games moderation recovery vertical slice. Follow-up to M224–M226; do not submit to platform moderation or release based solely on CI.

## Product decision: do not stretch the actual playfield
In the 390×844 browser screenshots, the 368-pixel square world was already almost as wide as the phone. Enlarging it by cropping or stretching would either hide incoming horizontal cars and traffic signals or distort vehicles. M227 instead reclaims blank *height* for a coherent dispatch **instrument panel** while retaining the original square, fully observable road geometry.

## Scope
Only portrait phones **350–520 CSS px** wide and at least **740 CSS px** tall, during **campaign levels 1–10**, enable the new deck:
- A ~65px upper instrument rail presents the existing upcoming wave (left) and real action receipt (right) **outside the road**.
- The square 900×900 logical Canvas remains full-width and 1:1 inside the board, with no coordinate conversion or physics/collision changes.
- A ~55px lower rail presents the existing active phase and a small noninteractive **TP / ATLAS** plate signature.
- Buttons remain unchanged and safe-area padding is preserved. Training, later levels, daily/weekly/scenarios and desktop/landscape retain their previous geometry.
- World cache remains bounded, and the illustrated districts now have four distinct original vector motifs: park canopy, transit platform, industrial workshop and civic plaza.

This is not "bigger cars." It is **cleaner decision space and stronger visual brand** without false readability claims.

## Correctness / QA
- Test the first gameplay frame after the four-step tutorial on 390×844.
- Card height must exceed Canvas height by >=110px, and Canvas still be square/full width.
- Forecast/receipt must reside entirely above the Canvas; phase indicator entirely below; forecast and receipt must not overlap.
- Card must not overlap title or controls; document horizontal overflow <=2px.
- Confirm no runtime errors, 44px+ buttons, Save/account/ads tests, package allowlist and ZIP integrity.
- 844×390 phone landscape, compact/short portrait, and desktop are regression gates.
- The original visual world is still used in other levels/modes; no platform API change.

## Pending external validation
Actual VK/OK container callbacks, physical phone layout with real safe areas (iOS/Android), first ten user-played levels, and >=5 unprompted players to verify the layout improves recognition of actions. Moderation feedback is a product-quality assessment, not guaranteed resolved by this technical release.
