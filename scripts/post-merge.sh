#!/bin/bash
set -e

# Reinstall dependencies after a merge. This script intentionally does NOT
# touch the database schema. Automatically running `drizzle-kit push` (with
# or without --force) on every merge is unsafe: --force exits 0 even when it
# hits a data-loss prompt with stdin closed, and can silently skip or apply
# destructive schema changes with no human review.
#
# Schema changes are a separate, explicitly-authorized manual step — see the
# "Database Schema Migrations" section in DEVELOPMENT.md. This script never
# runs `db:push` for you.
npm install
