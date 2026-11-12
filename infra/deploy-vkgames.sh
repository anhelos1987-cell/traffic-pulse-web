#!/usr/bin/env bash
set -euo pipefail

# Run at repository root with Cloudflare Wrangler credentials already configured.
# Never put the Cloudflare API token into this repository or client JavaScript.
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID}"
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"

ASSET_PREFIX="m223-interactive-training-r2"
KV_NAMESPACE_ID="b38ca4565d4646d59141e8f6f027e052"
for file in all-maps.png index.html app.js progress-core.js player-guidance-core.js campaign-access.js payments-config.js vk-purchases.js vk-games.js vkbridge.min.js style.css; do
  echo "Uploading $file to Cloudflare KV"
  npx --yes wrangler@4 kv key put "$ASSET_PREFIX/$file" \
    --path "$file" --namespace-id "$KV_NAMESPACE_ID" --remote
done

# Keep ASSET_PREFIX identical to the Worker. Stage every asset before switching versions.
npx --yes wrangler@4 deploy --config infra/wrangler.vkgames.jsonc
