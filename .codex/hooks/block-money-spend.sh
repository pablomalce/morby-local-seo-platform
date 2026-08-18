#!/bin/bash
#
# Blocks any command that could spend real money on this project's paid APIs,
# before it runs.
#
# Same shape as the guard in vulkan-lead-engine, but the patterns are NOT copied
# from it: they come from tracing where this repo actually calls out and pays.
# Nothing here mentions Apify or Resend, because this project does not spend on
# either.
#
# Scope, taken from the entry points confirmed in the source on 2026-08-14:
#   OpenAI      src/lib/integrations/imageProvider.ts — POSTs to
#               https://api.openai.com/v1/images/generations. Image generation
#               is the single most expensive call in this repo per request.
#               src/lib/integrations/openai.ts wraps the same key.
#   Places      src/lib/integrations/google/places.ts — GETs
#               https://places.googleapis.com/v1/places. Google Places bills per
#               request; there is no free "just testing" tier.
#               src/lib/integrations/googlePlaces.ts wraps the same key.
#   PageSpeed   src/lib/integrations/google/pagespeed.ts — GETs
#               https://www.googleapis.com/pagespeedonline/v5/runPagespeed.
#               Quota rather than dollars, but exhausting it breaks reports for
#               everyone until it resets. Cached 24h in `pagespeed_cache`, so a
#               hand-run bypasses the cache the product relies on.
#   Reached over HTTP through POST /api/reports/generate (the orchestrator, which
#   fans out to Places + PageSpeed), /api/integrations/images/generate,
#   /api/integrations/places/search, /api/content/generate, /api/seo/audit and
#   /api/agents/run{,-all}.
#
# NOT blocked, and why:
#   - GET /api/integrations/gbp/profile. Verified read-only: the route exports
#     GET and nothing else, so it cannot modify a real Google Business listing.
#   - RESEND_API_KEY, ANTHROPIC_API_KEY, GOOGLE_GEMINI_API_KEY and the
#     GOOGLE_BUSINESS_* pair are declared in .env.example but are NOT referenced
#     anywhere under src/. Guarding a call nobody makes is noise that trains
#     people to ignore the guard. When any of them gets wired — especially
#     Resend, which would reach real inboxes — add it here in the same pass.
#
# Deliberately allowed, because a guard that stops the work is a guard that gets
# removed: npm test / build / lint / typecheck / dev, and reading or grepping
# files that merely mention these services. Reading about a call is not making
# one.

INPUT=$(cat)

# Fail closed on a broken toolchain: with no jq we cannot read the command, and
# a command we cannot read is a command we cannot clear.
if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq is not installed, so this hook cannot inspect the command." >&2
  echo "This project spends real money on OpenAI images and Google Places." >&2
  echo "Refusing to let anything through unchecked. Install jq to restore normal operation." >&2
  exit 2
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# A verb only counts in command position: at the start or after a shell
# operator, and followed by whitespace. Matching the bare word would block
# `grep -rn "https://api.openai.com" src/` — reading about a call is not making
# one — because "http" is a substring of "https".
POS="(^|[^[:alnum:]_.-])"
NET="$POS(curl|wget|xh|nc)[[:space:]]"
RUN="$POS(node|npx|tsx|ts-node|bun|deno|python3?|ruby|perl)[[:space:]]"
ANY="$POS(curl|wget|xh|nc|node|npx|tsx|ts-node|bun|deno|python3?|ruby|perl)[[:space:]]"
# A route only counts when it hangs off a real URL token. `$BASE/api/...` is as
# much a call as `https://.../api/...`, and a shell variable is the ordinary way
# a smoke-test script holds the host — leaving `\$` out is how a POST to a
# production route slipped past the sibling guard on 2026-08-13.
URL="(https?://|localhost|127\.0\.0\.1|\\$\{?[A-Za-z_])[^[:space:]\"'\`]*"

PATTERNS=(
  "$ANY[^|;]*api\.openai\.com"
  "$ANY[^|;]*places\.googleapis\.com"
  "$ANY[^|;]*googleapis\.com/pagespeedonline"
  "$NET[^|;]*$URL/api/reports/generate"
  "$NET[^|;]*$URL/api/integrations/images/generate"
  "$NET[^|;]*$URL/api/integrations/places/search"
  "$NET[^|;]*$URL/api/content/generate"
  "$NET[^|;]*$URL/api/seo/audit"
  "$NET[^|;]*$URL/api/agents/run"
  "$RUN[^|;]*(integrations/)?imageProvider"
  "$RUN[^|;]*integrations/openai"
  "$RUN[^|;]*(google/)?places"
  "$RUN[^|;]*(google/)?pagespeed"
  "$RUN[^|;]*reports/orchestrator"
)

REASONS=(
  "a direct call to the OpenAI API — image generation is the most expensive request this repo makes"
  "a direct call to Google Places — that API bills per request, with no free tier for trying it out"
  "a direct call to PageSpeed — it burns the shared daily quota that every report depends on"
  "POST /api/reports/generate, which fans out to Places and PageSpeed for a full report"
  "POST /api/integrations/images/generate, which generates an image on OpenAI's meter"
  "POST /api/integrations/places/search, which bills one Places request per call"
  "POST /api/content/generate, which spends on model calls"
  "POST /api/seo/audit, which runs the paid audit chain"
  "POST /api/agents/run or /run-all, which spends once per agent in the batch"
  "executing imageProvider.ts, whose only job is the paid OpenAI image call"
  "executing the OpenAI wrapper, which spends on the same key"
  "executing the Places client, which bills per lookup"
  "executing the PageSpeed client, which spends the shared quota and skips the 24h cache"
  "executing the report orchestrator, which runs Places and PageSpeed end to end"
)

for i in "${!PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qiE "${PATTERNS[$i]}"; then
    echo "BLOCKED: '$COMMAND'" >&2
    echo "" >&2
    echo "What was blocked: ${REASONS[$i]}." >&2
    echo "Why: these calls bill a real account the moment they run, and 'just checking" >&2
    echo "that it works' is indistinguishable from using it. Use a fixture or a cached" >&2
    echo "row instead; if you genuinely need a live call, ask first." >&2
    exit 2
  fi
done

exit 0
