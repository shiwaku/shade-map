#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""建物フットプリント＋高さから、1時間帯別の日陰ポリゴンを事前計算する。
入力 : data/omiya.geojson (EPSG:4326, 属性 TAKASA=高さm)
出力 : data/shade_by_hour.geojson (EPSG:4326, 各featureが1時間帯のディゾルブ済み日陰)
"""
import json, math, sys, datetime
import numpy as np
from pyproj import Transformer
from shapely.geometry import Polygon, MultiPoint, mapping
from shapely.ops import unary_union, transform as shp_transform
from shapely.affinity import translate

DATE = (2026, 8, 1)          # 基準日 (JST)
HOURS = list(range(5, 19))   # 5:00〜18:00 の毎正時
CENTER_LAT, CENTER_LON = 35.9065, 139.6237
SRC = "data/omiya.geojson"
DST = "public/data/shade_by_hour.geojson"
MAX_SHADOW_M = 400           # 影長の上限(m)

# ---- NOAA 太陽位置 (UTC datetimeから 高度・方位[北基準時計回り, 太陽方向], deg) ----
def solar_pos(lat, lon, y, mo, d, hh, mm, ss=0):
    # ユリウス日 (UTC)
    if mo <= 2:
        y -= 1; mo += 12
    A = math.floor(y/100); B = 2 - A + math.floor(A/4)
    jd = (math.floor(365.25*(y+4716)) + math.floor(30.6001*(mo+1))
          + d + B - 1524.5 + (hh + mm/60 + ss/3600)/24)
    T = (jd - 2451545.0)/36525.0
    L0 = (280.46646 + T*(36000.76983 + 0.0003032*T)) % 360
    M = 357.52911 + T*(35999.05029 - 0.0001537*T)
    e = 0.016708634 - T*(0.000042037 + 0.0000001267*T)
    Mr = math.radians(M)
    C = ((1.914602 - T*(0.004817+0.000014*T))*math.sin(Mr)
         + (0.019993-0.000101*T)*math.sin(2*Mr) + 0.000289*math.sin(3*Mr))
    trueL = L0 + C
    omega = 125.04 - 1934.136*T
    lam = trueL - 0.00569 - 0.00478*math.sin(math.radians(omega))
    eps0 = (23 + (26 + (21.448 - T*(46.815 + T*(0.00059 - 0.001813*T)))/60)/60)
    eps = eps0 + 0.00256*math.cos(math.radians(omega))
    decl = math.degrees(math.asin(math.sin(math.radians(eps))*math.sin(math.radians(lam))))
    # 均時差 (分)
    y2 = math.tan(math.radians(eps/2))**2
    L0r = math.radians(L0)
    eot = 4*math.degrees(y2*math.sin(2*L0r) - 2*e*math.sin(Mr)
          + 4*e*y2*math.sin(Mr)*math.cos(2*L0r) - 0.5*y2*y2*math.sin(4*L0r)
          - 1.25*e*e*math.sin(2*Mr))
    # 真太陽時
    tst = (hh*60 + mm + ss/60 + eot + 4*lon) % 1440
    ha = tst/4 - 180  # 時角(deg)
    har = math.radians(ha); latr = math.radians(lat); declr = math.radians(decl)
    zen = math.degrees(math.acos(
        math.sin(latr)*math.sin(declr) + math.cos(latr)*math.cos(declr)*math.cos(har)))
    alt = 90 - zen
    # 方位 (北=0, 時計回り, 太陽方向)
    az_den = math.cos(latr)*math.sin(math.radians(zen))
    if abs(az_den) < 1e-9:
        az = 180.0
    else:
        c = (math.sin(latr)*math.cos(math.radians(zen)) - math.sin(declr)) / az_den
        c = max(-1, min(1, c))
        acos = math.degrees(math.acos(c))
        # NOAA: 北基準・時計回り
        az = (acos + 180) % 360 if ha > 0 else (540 - acos) % 360
    return alt, az

def main():
    gj = json.load(open(SRC, encoding="utf-8"))
    to_m = Transformer.from_crs("EPSG:4326", "EPSG:6677", always_xy=True)
    to_deg = Transformer.from_crs("EPSG:6677", "EPSG:4326", always_xy=True)

    # 建物フットプリント(メートル)と高さ
    polys = []
    for f in gj["features"]:
        h = f["properties"].get("TAKASA")
        if not h or h <= 0:
            continue
        g = f["geometry"]
        rings = g["coordinates"] if g["type"] == "Polygon" else g["coordinates"][0]
        ext = rings[0]
        xs, ys = to_m.transform([c[0] for c in ext], [c[1] for c in ext])
        try:
            p = Polygon(zip(xs, ys))
            if p.is_valid and p.area > 0:
                polys.append((p, float(h)))
        except Exception:
            pass
    print(f"buildings: {len(polys)}", file=sys.stderr)

    out_feats = []
    y, mo, d = DATE
    for hh in HOURS:
        u = datetime.datetime(y, mo, d, hh, 0) - datetime.timedelta(hours=9)  # JST->UTC
        alt, az = solar_pos(CENTER_LAT, CENTER_LON, u.year, u.month, u.day, u.hour, u.minute)
        if alt <= 0.5:
            print(f"{hh:02d}:00 alt={alt:.1f} -> 夜間/低空 skip", file=sys.stderr)
            continue
        azr = math.radians(az)
        inv_tan = 1.0 / math.tan(math.radians(alt))
        # 影方向 = 太陽の反対 (east=-sin az, north=-cos az)
        ux, uy = -math.sin(azr), -math.cos(azr)
        shadows = []
        for p, h in polys:
            L = h * inv_tan
            if L > MAX_SHADOW_M:
                L = MAX_SHADOW_M
            tp = translate(p, xoff=ux*L, yoff=uy*L)
            hull = MultiPoint(list(p.exterior.coords) + list(tp.exterior.coords)).convex_hull
            shadows.append(hull)
        merged = unary_union(shadows).simplify(1.0, preserve_topology=True)
        merged_deg = shp_transform(lambda xx, yy, z=None: to_deg.transform(xx, yy), merged)
        out_feats.append({
            "type": "Feature",
            "properties": {"hour": hh, "alt": round(alt, 1), "az": round(az, 1),
                            "label": f"{hh:02d}:00"},
            "geometry": mapping(merged_deg),
        })
        print(f"{hh:02d}:00 alt={alt:.1f} az={az:.0f} parts={len(shadows)}", file=sys.stderr)

    json.dump({"type": "FeatureCollection",
               "properties": {"date": f"{y:04d}-{mo:02d}-{d:02d}"},
               "features": out_feats},
              open(DST, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {DST} ({len(out_feats)} hours)", file=sys.stderr)

if __name__ == "__main__":
    main()
