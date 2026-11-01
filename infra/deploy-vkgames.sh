#!/usr/bin/env bash
set -euo pipefail

# Run at repository root with Cloudflare Wrangler credentials already configured.
# Never put the Cloudflare API token into this repository or client JavaScript.
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID}"
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"

KV_NAMESPACE_ID="b38ca4565d4646d59141e8f6f027e052"
for file in index.html app.js progress-core.js vk-cloud.js vk-games.js style.css; do
  echo "Uploading $file to Cloudflare KV"
  npx --yes wrangler@4 kv key put "$file" \
    --path "$file" --namespace-id "$KV_NAMESPACE_ID" --remote
done

# Cache TTL is at most 5 minutes. Change CACHE_VERSION in the Worker code
# to invalidate edge cache immediately on a changed deployment.
npx --yes wrangler@4 deploy --config infra/wrangler.vkgames.jsonc
