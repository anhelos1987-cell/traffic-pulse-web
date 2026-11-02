# Traffic Pulse — VK Games deployment

This is a **VK Games / VK Mini Apps** branch, not a VK Play browser build.
The original VK Play and billing configuration remains on the main branch.

## Current deployed service

- Edge Worker: `traffic-pulse-vkgames-edge`.
- Public endpoint: `https://traffic-pulse-vkgames-edge.anhelos1987.workers.dev/`.
- Cloudflare KV (game **assets only**): `traffic-pulse-vkgames-assets`, bound as `GAME_ASSETS`.
- Production branch in GitHub: `vk-games`.

The edge Worker serves a fixed allow-list of static game assets from the KV namespace. Cloudflare KV stores **only public game files**. The Worker has no D1/player database, no account API, no analytics endpoint and no code path that accepts or stores VK UID, launch parameters, progress, purchases or profile data. Worker observability and Logpush are disabled; query strings are configured for redaction as an additional safeguard.

The static asset allow-list now includes `campaign-access.js`, `payments-config.js` and `vk-purchases.js`. Map purchases are prepared but **disabled** until a separate Russian-hosted callback and the VK payment cabinet are configured. See `server/README-RU.md`. No payment journal is hosted on Cloudflare.

The HTML ships a pinned local VK Bridge 3.0.2 bundle. A restrictive CSP uses `connect-src 'none'`, so the client cannot accidentally send account/progress data to a web backend. VK account identifiers are used only in volatile browser memory to validate the VK session. The local device stores a SHA-256 account fingerprint rather than the raw VK UID.

## Game saves and monetization

The VK Bridge SDK handles `VKWebAppInit`, `VKWebAppGetUserInfo`, `VKWebAppGetLaunchParams`, capability checks, and account-scoped `VKWebAppStorageGet` / `VKWebAppStorageSet`. The adapter does not send user info or launch parameters to a Cloudflare API. The initial hosting request may still contain launch parameters in its URL; the Worker does not persist them.

Save files are normalized, UTF-8/base64 encoded, split into 3000-character chunks (below the per-value guard), hashed with SHA-256, and written under a cryptographically random generation. The manifest/pointer is published only after every chunk succeeds. A reset epoch prevents stale sessions from silently republishing data after account-data deletion. Cross-device reconciliation uses a local last-cloud baseline; a different VK account never inherits the previous browser profile. VK Play wallet/entitlements are stripped from the VK Games save.

`VKWebAppStorageGetKeys` is used for a player-facing delete-data flow that erases only Traffic Pulse keys and verifies deletion. VK Storage does not provide a compare-and-swap transaction, so simultaneous multi-device writes remain a last-writer/reconciliation case and require real-device qualification.

M198 Ads RC2: campaign interstitials are requested after two successful campaign completions in the current session, including replays, at the Next transition. Failed runs do not count. A rewarded success suppresses interstitials for 60 seconds so ads do not run back-to-back. A due slot is consumed even when inventory is unavailable. The VK host controls actual ad delivery. Desktop uses a right vertical resize banner; mobile uses a bottom compact resize banner. Host platform identity keeps iframe resizing from changing banner orientation. Concurrent ad/banner requests are serialized and run transitions are blocked while an ad is active.

Rewarded and interstitial ads use `VKWebAppShowNativeAds` and never grant a reward after a failed ad callback. The VK Play wallet and in-app product purchase endpoints are disabled on this platform. VK Games monetization policy and production ad availability must be verified in the VK dashboard.

## Production publication checklist

1. Create a **VK Mini App / VK Games** application in the VK developer dashboard.
2. Configure the app's HTTPS URL to the Worker endpoint above. Do **not** configure it in VK Play.
3. Test in the actual VK iframe on mobile and desktop: Bridge init, game canvas, touch controls, rewarded and interstitial callbacks, save/load, and two devices signed into the same VK account.
4. Run the GitHub Actions workflow `VK Games validation` on this branch before publication.
5. Verify VK application card requirements, app ID, ratings, monetization configuration, and moderation rules in the current dashboard.

The public URL can be used in a normal browser as a local-save demo. Native VK cloud storage and VK ads only work in the VK host, not on a standalone browser tab.

## Redeployment

The previous Cloudflare Pages Git integration failed with Cloudflare error `8000011`, so this deployment uses a KV-bound Worker rather than relying on Pages Git integration.

To deploy updated assets from this branch, configure a Cloudflare token outside the repository with least-privilege Worker/KV permissions and run:

```bash
export CLOUDFLARE_ACCOUNT_ID="<your Cloudflare account ID>"
export CLOUDFLARE_API_TOKEN="<your API token>"
bash infra/deploy-vkgames.sh
```

CI runs the syntax checks and the Node regression tests but does not automatically deploy without Cloudflare credentials. `infra/wrangler.vkgames.jsonc` is the repeatable Worker and KV binding definition. When updating JS/CSS during an active release, bump `CACHE_VERSION` in the Worker to invalidate old edge cache immediately.

## Known constraints

- The VK account-scoped storage API's availability, quota, physical data-location guarantees and behavior must be validated against the production VK application/contract; this repository does not claim legal certification.
- Cloudflare remains a foreign static-hosting provider. Although this implementation does not store player personal data there, the initial HTTPS request itself can still be processed by Cloudflare infrastructure. For the most conservative Russian data-localization posture, prefer VK-owned hosting/CDN for the production player if the current VK Games cabinet supports it, or obtain legal review of the hosting path.
- This branch deliberately does **not** reuse VK Play's Cloudflare billing service or its purchased coins.
- The temporary empty Cloudflare Pages project created during setup was deleted. The active public service is the KV-backed Worker.
