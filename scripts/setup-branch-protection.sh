#!/usr/bin/env bash
# Enable branch protection on main for mikeornstein/three-cad.
# Requires: gh auth with admin on the repo; GitHub Pro if the repo is private
# (or a public repo on Free).
set -euo pipefail

REPO="${REPO:-mikeornstein/three-cad}"
BRANCH="${BRANCH:-main}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PAYLOAD="${ROOT}/scripts/branch-protection.json"

if [[ ! -f "$PAYLOAD" ]]; then
  echo "Missing $PAYLOAD" >&2
  exit 1
fi

echo "Applying branch protection to ${REPO}@${BRANCH} …"

if ! gh api --method PUT "repos/${REPO}/branches/${BRANCH}/protection" \
  --input "$PAYLOAD"; then
  cat <<'EOF' >&2

Failed to enable branch protection.

Common causes:
  • Private repo on GitHub Free → upgrade to Pro, or make the repo public
  • Token lacks admin on the repository
  • Status check context "check" will only be required after CI has run once

EOF
  exit 1
fi

echo "OK: ${BRANCH} requires PRs, blocks force-push/deletes, requires status check \"check\"."
echo "Verify: gh api repos/${REPO}/branches/${BRANCH}/protection"
