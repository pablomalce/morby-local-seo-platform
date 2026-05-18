#!/usr/bin/env bash
# =============================================================================
# Push Vulkan Growth OS changes to a new branch in
# pablomalce/morby-local-seo-platform.
#
# Strategy:
#   1. Snapshot current working code (excluding .git, node_modules, .next).
#   2. Wipe and re-clone the GitHub repo so we have a clean, valid .git.
#   3. Create the feature branch from the existing main/master.
#   4. Restore our snapshot on top.
#   5. Commit + push.
#
# Authentication: you'll need either a Personal Access Token (PAT) or `gh`
# already authenticated. If you have GitHub CLI installed, run `gh auth login`
# first and the push will use it automatically.
# =============================================================================

set -euo pipefail

PROJECT_DIR="/Users/pablo/Documents/Claude/Projects/Vulkan SaaS"
REMOTE="https://github.com/pablomalce/morby-local-seo-platform.git"
BRANCH="feat/vulkan-phase-1"
BACKUP_DIR="$HOME/.vulkan-saas-snapshot-$(date +%Y%m%d-%H%M%S)"

echo "==> Project: $PROJECT_DIR"
echo "==> Branch:  $BRANCH"
echo "==> Remote:  $REMOTE"
echo

# ---------- pre-flight ----------
command -v git >/dev/null || { echo "git not found"; exit 1; }

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Project directory not found: $PROJECT_DIR"
  exit 1
fi

cd "$PROJECT_DIR"

# ---------- 1. snapshot ----------
echo "==> Snapshotting current code to $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.env.local' \
  --exclude='.env.*.local' \
  --exclude='.DS_Store' \
  ./ "$BACKUP_DIR/"

# ---------- 2. clean folder + re-clone ----------
echo "==> Cleaning $PROJECT_DIR and cloning fresh from GitHub"
find . -mindepth 1 -maxdepth 1 \
  -not -name '.DS_Store' \
  -exec rm -rf {} +

git clone "$REMOTE" .

# Detect default branch (main or master).
DEFAULT_BRANCH="$(git remote show origin | awk '/HEAD branch/ {print $NF}')"
echo "==> Detected default branch: $DEFAULT_BRANCH"

# ---------- 3. create feature branch ----------
git checkout -b "$BRANCH"

# ---------- 4. restore our work ----------
echo "==> Restoring Vulkan Growth OS code over the clone"
rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  "$BACKUP_DIR/" ./

# ---------- 5. commit + push ----------
git add -A
git status --short

git commit -m "feat: Vulkan-branded universal multi-tenant Growth OS

Phase 1 + onboarding wizard + Vulkan Studios UI Kit applied platform-wide.

Architecture
- Universal multi-tenant data model: Organization > Business > Location > Service
- Three seed demo tenants across distinct industries (beauty, dental, restaurant)
- Business / Service / Location selectors with persisted selection
- i18n scaffold for EN / ES / SV across navigation, dashboards, agents
- Scope-aware Agent registry + new Social Content and Social Image agents
- Image Generation Studio with provider abstraction (OpenAI-ready, demo SVG)
- Multi-step 'Add new business' onboarding wizard with localStorage persistence
- Empty states for newly-created tenants
- All API routes universalised with businessId / scope / locale params
- Expanded Prisma schema ready for Phase 2 PostgreSQL migration

Vulkan Studios UI Kit
- vulkan.* + metal scale palette (slide 04 — Chromatic System)
- Rajdhani, Inter, JetBrains Mono, Michroma typography stack (slide 05)
- 4px button radius, 8px card radius, no soft pills (slide 14 DO/DON'T)
- orange-glow / orange-glow-soft / card-orange shadows (slide 07)
- ease-vulkan cubic-bezier transitions (slide 13)
- vulkan-pattern SVG overlay at 8% as texture (slide 11)
- HUD labels with // prefix, frame counters, section markers
- Power Controls buttons (REST / HOVER / ACTIVE / SECONDARY x SM/MD/LG)
- Solid Industrial navbar variant (slide 08, Variant B)

Validation
- tsc --noEmit: clean
- next build: success, 24 static routes + 8 dynamic API routes

Co-authored-by: Claude <noreply@anthropic.com>"

echo
echo "==> Ready to push to $REMOTE on branch $BRANCH"
echo "==> You may be prompted for GitHub credentials."
echo

git push -u origin "$BRANCH"

echo
echo "✓ Done. Open a pull request at:"
echo "  https://github.com/pablomalce/morby-local-seo-platform/compare/$DEFAULT_BRANCH...$BRANCH?expand=1"
echo
echo "Snapshot kept at: $BACKUP_DIR (safe to delete once you've verified the push)"
