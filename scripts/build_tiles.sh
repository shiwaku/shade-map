#!/usr/bin/env bash
# 建物フットプリント(GeoJSON) → PMTiles ベクトルタイル
# 依存: tippecanoe (>=2.x, PMTiles出力対応)
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="data/omiya.geojson"
OUT="public/tiles/building.pmtiles"
mkdir -p "$(dirname "$OUT")"

tippecanoe -o "$OUT" -f -l building \
  -Z13 -z18 \
  --drop-densest-as-needed --extend-zooms-if-still-dropping \
  -y TAKASA -y RIYOU -y KOUZO -y KAISU -y NOBEMEN \
  "$SRC"

echo "wrote $OUT"
pmtiles show "$OUT" | head -12 || true
