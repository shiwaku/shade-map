#!/usr/bin/env bash
# さいたま市全域の 建物 / 日陰 PMTiles を生成する一括スクリプト。
# 依存: GDAL(ogr2ogr), tippecanoe, python3(+標準ライブラリ)
set -euo pipefail
cd "$(dirname "$0")/.."

SHP="../建物現況調査（市独自調査）/GISデータ/HouseR03.shp"
mkdir -p work public/tiles

# 1) 全域の建物GeoJSON(4326) — 影計算＆建物タイルの共通入力
if [ ! -f work/buildings_city.geojson ]; then
  echo "[1/4] building geojson (ogr2ogr, 6677->4326)"
  ogr2ogr -f GeoJSON work/buildings_city.geojson "$SHP" \
    -s_srs EPSG:6677 -t_srs EPSG:4326 \
    -where "RIYOU <> 88" \
    -select TID,RIYOU,KOUZO,KAISU,TAKASA,NOBEMEN
fi

# 2) 建物 PMTiles（壁面 fill-extrusion 用）
echo "[2/4] building.pmtiles (tippecanoe)"
tippecanoe -o public/tiles/building.pmtiles -f -l building \
  -Z13 -z16 --drop-densest-as-needed --extend-zooms-if-still-dropping \
  -y TAKASA -y RIYOU -y KOUZO \
  work/buildings_city.geojson

# 3) 建物ごとの日陰ポリゴン（毎正時・融合なし）を NDJSON 出力
echo "[3/4] shade NDJSON (precompute)"
python3 scripts/precompute_shade_city.py

# 4) 日陰 PMTiles（hour 属性でフィルタ）
echo "[4/4] shade.pmtiles (tippecanoe)"
tippecanoe -o public/tiles/shade.pmtiles -f -l shade \
  -Z12 -z16 --drop-densest-as-needed --extend-zooms-if-still-dropping \
  -y hour work/shade_city.ndjson

echo "done: public/tiles/{building,shade}.pmtiles"
ls -la public/tiles/
