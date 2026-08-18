#!/bin/bash
#
# Re-verifies block-money-spend.sh: that it refuses what costs money, and — the
# half that matters just as much — that it lets ordinary work through.
#
#   bash .codex/hooks/selfcheck.sh
#
# A guard that blocks everything is as useless as one that blocks nothing: it
# gets in the way until somebody removes it. So the ALLOW list is not padding,
# it is the half that keeps the guard survivable.
#
# KNOWN LIMIT, stated rather than hidden: this only runs when somebody
# remembers to run it. The sibling project hit exactly this — the same checks
# started life as a standalone script, and "a verification nobody executes is
# indistinguishable from one that passes". There the fix was to move them into
# `npm test`, so CI runs them on every PR. This repo has no test runner and no
# test job in CI, so that door is closed until one exists. Wiring it up is the
# durable fix; until then, run this after every edit to the hook.

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/block-money-spend.sh"
pass=0; fail=0

verdict() {
  printf '{"tool_input":{"command":%s}}' \
    "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1")" \
    | bash "$HOOK" >/dev/null 2>&1 && echo allowed || echo blocked
}

chk() {
  local got; got=$(verdict "$2")
  if [ "$got" = "$3" ]; then
    printf "  ok    %-44s %s\n" "$1" "$got"; pass=$((pass+1))
  else
    printf "  FAIL  %-44s got=%s want=%s\n" "$1" "$got" "$3"; fail=$((fail+1))
  fi
}

echo "── must block: it costs real money ──"
chk "curl to OpenAI"          'curl -X POST https://api.openai.com/v1/images/generations -d @x.json' blocked
chk "curl to Places"          'curl "https://places.googleapis.com/v1/places:searchText"'            blocked
chk "curl to PageSpeed"       'curl "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=x"' blocked
chk "POST reports/generate"   'curl -X POST https://app.example.com/api/reports/generate'            blocked
chk "POST host from \$VAR"     'curl -X POST $BASE/api/integrations/places/search'                    blocked
chk "POST images/generate"    'curl -X POST http://localhost:3000/api/integrations/images/generate'  blocked
chk "POST agents/run-all"     'curl -X POST $BASE/api/agents/run-all'                                blocked
chk "POST content/generate"   'curl -X POST $BASE/api/content/generate'                              blocked
chk "POST seo/audit"          'curl -X POST $BASE/api/seo/audit'                                     blocked
chk "run imageProvider"       'npx tsx src/lib/integrations/imageProvider.ts'                        blocked
chk "run orchestrator"        'node src/lib/reports/orchestrator.ts'                                 blocked
chk "run pagespeed client"    'npx tsx src/lib/integrations/google/pagespeed.ts'                     blocked

echo "── must pass: it is the work ──"
chk "npm test"                'npm test'                                                             allowed
chk "npm run build"           'npm run build'                                                        allowed
chk "npm run dev"             'npm run dev'                                                          allowed
chk "npm run typecheck"       'npm run typecheck'                                                    allowed
chk "grep for the host"       'grep -rn "https://api.openai.com" src/'                               allowed
chk "read the paid module"    'cat src/lib/integrations/imageProvider.ts'                            allowed
chk "prose naming the route"  'git commit -m "docs: explain POST /api/reports/generate"'             allowed
chk "GET gbp profile (read)"  'curl $BASE/api/integrations/gbp/profile'                              allowed
chk "git status"              'git status --short'                                                   allowed

echo "──  $pass ok, $fail failed  ──"
[ "$fail" -eq 0 ] || exit 1
