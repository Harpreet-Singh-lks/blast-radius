#!/usr/bin/env bash
# Build the web app and publish it to the gh-pages branch (served by GitHub Pages).
# Usage: scripts/deploy-pages.sh
# Needs: pnpm dependencies installed in apps/web, and push access to the repo's origin.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="$(git -C "$ROOT" remote get-url origin)"
REPO_NAME="$(basename "${REMOTE%.git}")"

echo "building apps/web for /$REPO_NAME/"
(cd "$ROOT/apps/web" && VITE_BASE="/$REPO_NAME/" ./node_modules/.bin/vite build >/dev/null)
DIST="$ROOT/apps/web/dist"

# refuse to publish if a local secret value ended up in the bundle
if [ -f "$ROOT/.env" ]; then
  while IFS='=' read -r key value; do
    value="${value#0x}"; value="${value%\"}"; value="${value#\"}"
    case "$key" in ARKIV_WRITER_PRIVATE_KEY|ARKIV_ACCESS_KEY)
      if [ -n "$value" ] && grep -rqF "$value" "$DIST"; then echo "refusing to deploy: $key value found in build output" >&2; exit 1; fi;;
    esac
  done < "$ROOT/.env"
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cp -R "$DIST/." "$TMP/" && touch "$TMP/.nojekyll"
cd "$TMP"
git init -q -b gh-pages && git add -A
git -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" \
  commit -q -m "Deploy web app build from $(git -C "$ROOT" rev-parse --short HEAD)"
git remote add origin "$REMOTE"
git push -q --force origin gh-pages
echo "published. Site: https://$(echo "$REMOTE" | sed -E 's#.*github.com[:/]([^/]+)/.*#\1#' | tr 'A-Z' 'a-z').github.io/$REPO_NAME/"
