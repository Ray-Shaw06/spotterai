#!/usr/bin/env bash
#
# One-time Doppler bootstrap for SpotterAI.
#
# Creates the project and its three configs, then uploads whatever is already
# in your local .env so nothing has to be re-typed. Idempotent: every step
# tolerates the thing already existing, so re-running is safe.
#
# Prerequisites (both are yours to do, they need a browser):
#   brew install dopplerhq/cli/doppler
#   doppler login
#
# Usage:
#   ./scripts/doppler-bootstrap.sh

set -euo pipefail

PROJECT="spotterai"
ENV_FILE="${1:-.env}"

if ! command -v doppler >/dev/null 2>&1; then
  echo "error: the doppler CLI is not installed." >&2
  echo "  brew install dopplerhq/cli/doppler" >&2
  exit 1
fi

if ! doppler me >/dev/null 2>&1; then
  echo "error: not logged in to Doppler." >&2
  echo "  doppler login" >&2
  exit 1
fi

echo "==> project: $PROJECT"
doppler projects create "$PROJECT" 2>/dev/null || echo "    (already exists)"

# dev is created with the project. stg/prd are not always, so ask for them.
for config in stg prd; do
  doppler configs create "$config" --project "$PROJECT" 2>/dev/null \
    || echo "    config $config already exists"
done

if [ -f "$ENV_FILE" ]; then
  echo "==> uploading $ENV_FILE into $PROJECT/dev"
  # --silent AND >/dev/null: `secrets upload` prints the resulting secrets
  # table, VALUES INCLUDED, so without both of these every key lands in
  # terminal scrollback and any CI log this ever runs in.
  doppler secrets upload "$ENV_FILE" --project "$PROJECT" --config dev --silent >/dev/null
  echo "    uploaded $(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE") keys (names and values not printed)"
  echo "    done. Values are now in Doppler; $ENV_FILE is still git-ignored."
else
  echo "==> no $ENV_FILE found, skipping upload"
  echo "    set secrets by hand with:"
  echo "      doppler secrets set GEMINI_API_KEY --project $PROJECT --config dev"
fi

cat <<'NEXT'

==> Next, and these are the parts that actually remove the copy-paste:

  1. Point this checkout at the project (reads doppler.yaml, no prompts):
       doppler setup --no-interactive

  2. Run anything with secrets injected, and stop sourcing .env by hand:
       doppler run -- npm run dev
       doppler run -- vercel dev

  3. Sync to Vercel, so production stops being a separate copy of the truth:
       Doppler dashboard -> spotterai -> prd -> Integrations -> Vercel
       (Pick the Vercel project, map prd to Production and stg to Preview.)

  4. Sync to GitHub Actions, if a workflow ever needs a key:
       Doppler dashboard -> Integrations -> GitHub Actions

NEXT
