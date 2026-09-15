#!/bin/bash
# ─── Webhook Delivery Retry Sweep Cron Script ────────────────
#
# Re-delivers due, failed webhook deliveries (nextRetryAt <= now) for active
# subscriptions, bounded by each subscription's retryCount.
#
# Set up to run every few minutes via system crontab:
#   */5 * * * * /path/to/scripts/cron-retry-webhooks.sh
#
# Or via cron-job.org / cronhooks pointing to:
#   POST https://your-domain.com/api/cron/retry-webhooks
#   Authorization: Bearer $CRON_SECRET
#
# Prerequisites:
#   - BASE_URL environment variable set to your deployment URL
#   - CRON_SECRET environment variable set to match your .env

set -euo pipefail

# ─── Configuration ─────────────────────────────────────────
BASE_URL="${BASE_URL:?BASE_URL environment variable is required. Example: https://your-domain.com}"
CRON_SECRET="${CRON_SECRET:?CRON_SECRET environment variable is required. Set this to the same value as your .env CRON_SECRET}"

# ─── Execute ───────────────────────────────────────────────
response=$(curl -s -w '\n%{http_code}' -X POST "${BASE_URL}/api/cron/retry-webhooks" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  --max-time 120)

http_code=$(echo "$response" | tail -1)
body=$(echo "$response" | sed '$d')

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Webhook retry sweep: HTTP ${http_code}"

if [ "$http_code" -eq 200 ]; then
  delivered=$(echo "$body" | grep -o '"delivered":[0-9]*' | cut -d: -f2)
  failed=$(echo "$body" | grep -o '"failed":[0-9]*' | cut -d: -f2)
  exhausted=$(echo "$body" | grep -o '"exhausted":[0-9]*' | cut -d: -f2)
  echo "  Delivered: ${delivered:-0}, Failed: ${failed:-0}, Exhausted: ${exhausted:-0}"
  exit 0
else
  echo "  Error: $(echo "$body" | head -c 200)"
  exit 1
fi
