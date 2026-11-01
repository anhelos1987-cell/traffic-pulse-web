# Traffic Pulse — VK Games deployment

This is a **VK Games / VK Mini Apps** branch, not a VK Play browser build.
The original VK Play and billing configuration remains on the main branch.

## Current deployed service

- Edge Worker: `traffic-pulse-vkgames-edge`.
- Public endpoint: `https://traffic-pulse-vkgames-edge.anhelos1987.workers.dev/`.
- Cloudflare KV (game **assets only**): `traffic-pulse-vkgames-assets`, bound as `GAME_ASSETS`.
- Production branch in GitHub: `vk-games`.

The edge Worker serves only a fixed allow-list of six game assets from the KV namespace, with correct MIME types and short-lived HTTP caching. No user progress or VK credentials are sent to this Worker or stored in Cloudflare KV.

## Game saves and monetization

The VK Bridge SDK handles `VKWebAppInit`, account-scoped `VKWebAppStorageGet` and `VKWebAppStorageSet`. Save files are normalized, UTF-8/base64 encoded, split into at most 64 chunks of 3500 characters, and committed with a manifest after the data chunks. A second bank protects the previously committed state from interrupted writes. The local browser save remains as an offline fallback. Cloud VK balance is authoritative on an account-sync conflict; level progress/stars/unlocks merge. Concurrent writes from multiple devices are best-effort, **not a transactional CAS**; full VK account / device testing is a release gate.

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

- The VK account-scoped storage API's availability, quota, and behavior must be validated in a real VK Mini App session.
- This branch deliberately does **not** reuse VK Play's Cloudflare billing service or its purchased coins.
- The Cloudflare Pages project named `traffic-pulse-vkgames` was reserved during setup but has no Git integration or deployed assets; the active deployment is the Worker.
