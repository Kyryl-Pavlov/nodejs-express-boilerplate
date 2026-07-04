#!/usr/bin/env bash
# Interactive migration helper for local development (runs outside Docker).
# Accepts an optional service name argument (default: app).
#
# Wraps `prisma migrate dev`, which already prompts interactively for a migration
# name and applies it immediately — Prisma's migrate workflow is single-step, unlike
# Flask-Migrate's generate-then-upgrade split, so there's no separate init/apply
# prompt to build here.
set -euo pipefail

SERVICE="${1:-app}"
SCHEMA="services/${SERVICE}/prisma/schema.prisma"

if [ ! -f "$SCHEMA" ]; then
  echo "No Prisma schema found at $SCHEMA" >&2
  exit 1
fi

npx prisma migrate dev --schema "$SCHEMA"
