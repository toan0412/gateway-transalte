#!/usr/bin/env bash
# Sao lưu SQLite an toàn (dùng .backup, không chép file đang ghi). Usage: scripts/backup.sh [db] [outdir]
set -euo pipefail
DB="${1:-./data/gateway.db}"; OUT="${2:-./backups}"
mkdir -p "$OUT"
sqlite3 "$DB" ".backup '$OUT/gateway-$(date +%Y%m%d-%H%M%S).db'"
ls -1t "$OUT"/gateway-*.db | tail -n +15 | xargs -r rm --
