#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""さいたま市全域の建物ごとの日陰ポリゴン（融合なし）を、
毎正時ぶんまとめて NDJSON(GeoJSONSeq) で出力する。→ tippecanoe で shade.pmtiles 化。

入力 : work/buildings_city.geojson (EPSG:4326, 属性 TAKASA)
出力 : work/shade_city.ndjson       (1行1feature, properties.hour)

影は建物フットプリントを太陽の反対方向へ L=高さ/tan(高度) 平行移動し、
元＋移動後の凸包を1棟分の影とする。座標は4326のまま度変換で近似（市域スケールで十分）。
"""
import json, math, sys, datetime

SRC = "work/buildings_city.geojson"
DST = "work/shade_city.ndjson"
DATE = (2026, 8, 1)
HOURS = list(range(5, 19))
CENTER_LAT, CENTER_LON = 35.9065, 139.6237
MAX_SHADOW_M = 400.0
M_PER_DEG_LAT = 111320.0

if len(sys.argv) > 1:
    HOURS = [int(x) for x in sys.argv[1:]]


def solar_pos(lat, lon, y, mo, d, hh, mm, ss=0):
    if mo <= 2:
        y -= 1; mo += 12
    A = math.floor(y / 100); B = 2 - A + math.floor(A / 4)
    jd = (math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (mo + 1))
          + d + B - 1524.5 + (hh + mm / 60 + ss / 3600) / 24)
    T = (jd - 2451545.0) / 36525.0
    L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360
    M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    Mr = math.radians(M)
    C = ((1.914602 - T * (0.004817 + 0.000014 * T)) * math.sin(Mr)
         + (0.019993 - 0.000101 * T) * math.sin(2 * Mr) + 0.000289 * math.sin(3 * Mr))
    trueL = L0 + C
    omega = 125.04 - 1934.136 * T
    lam = trueL - 0.00569 - 0.00478 * math.sin(math.radians(omega))
    eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - 0.001813 * T))) / 60) / 60
    eps = eps0 + 0.00256 * math.cos(math.radians(omega))
    decl = math.degrees(math.asin(math.sin(math.radians(eps)) * math.sin(math.radians(lam))))
    y2 = math.tan(math.radians(eps / 2)) ** 2
    L0r = math.radians(L0)
    eot = 4 * math.degrees(y2 * math.sin(2 * L0r) - 2 * e * math.sin(Mr)
          + 4 * e * y2 * math.sin(Mr) * math.cos(2 * L0r) - 0.5 * y2 * y2 * math.sin(4 * L0r)
          - 1.25 * e * e * math.sin(2 * Mr))
    tst = (hh * 60 + mm + ss / 60 + eot + 4 * lon) % 1440
    ha = tst / 4 - 180
    har = math.radians(ha); latr = math.radians(lat); declr = math.radians(decl)
    zen = math.degrees(math.acos(
        math.sin(latr) * math.sin(declr) + math.cos(latr) * math.cos(declr) * math.cos(har)))
    alt = 90 - zen
    den = math.cos(latr) * math.sin(math.radians(zen))
    if abs(den) < 1e-9:
        az = 180.0
    else:
        c = max(-1, min(1, (math.sin(latr) * math.cos(math.radians(zen)) - math.sin(declr)) / den))
        acos = math.degrees(math.acos(c))
        az = (acos + 180) % 360 if ha > 0 else (540 - acos) % 360
    return alt, az


def convex_hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts
    def cross(o, a, b):
        return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def outer_ring(geom):
    if geom["type"] == "Polygon":
        return geom["coordinates"][0]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"][0][0]
    return None


def main():
    import time
    t0 = time.time()
    gj = json.load(open(SRC, encoding="utf-8"))
    feats = gj["features"]
    # (ring[list of (lon,lat)], h, cosLat)
    blds = []
    for f in feats:
        h = f["properties"].get("TAKASA")
        if not h or h <= 0:
            continue
        ring = outer_ring(f["geometry"])
        if not ring or len(ring) < 4:
            continue
        cl = math.cos(ring[0][1] * math.pi / 180.0)
        blds.append((ring, float(h), cl))
    print(f"buildings: {len(blds)} ({time.time()-t0:.1f}s read)", file=sys.stderr)

    y, mo, d = DATE
    out = open(DST, "w", encoding="utf-8")
    n = 0
    for hh in HOURS:
        th = time.time()
        u = datetime.datetime(y, mo, d, hh, 0) - datetime.timedelta(hours=9)
        alt, az = solar_pos(CENTER_LAT, CENTER_LON, u.year, u.month, u.day, u.hour, u.minute)
        if alt <= 0.5:
            print(f"{hh:02d}:00 alt={alt:.1f} skip", file=sys.stderr)
            continue
        azr = math.radians(az)
        inv_tan = 1.0 / math.tan(math.radians(alt))
        ux, uy = -math.sin(azr), -math.cos(azr)   # 影方向(east,north)
        cnt = 0
        for ring, h, cl in blds:
            L = h * inv_tan
            if L > MAX_SHADOW_M:
                L = MAX_SHADOW_M
            dlon = ux * L / (M_PER_DEG_LAT * cl)
            dlat = uy * L / M_PER_DEG_LAT
            pts = []
            for x, yy in ring:
                pts.append((x, yy))
                pts.append((x + dlon, yy + dlat))
            hull = convex_hull(pts)
            if len(hull) < 3:
                continue
            coords = [[round(px, 6), round(py, 6)] for px, py in hull]
            coords.append(coords[0])
            out.write('{"type":"Feature","properties":{"hour":%d},"geometry":{"type":"Polygon","coordinates":[%s]}}\n'
                       % (hh, json.dumps(coords, separators=(",", ":"))))
            cnt += 1
        n += cnt
        print(f"{hh:02d}:00 alt={alt:.1f} az={az:.0f} feats={cnt} ({time.time()-th:.1f}s)", file=sys.stderr)
    out.close()
    print(f"wrote {DST}: {n} features total ({time.time()-t0:.1f}s)", file=sys.stderr)


if __name__ == "__main__":
    main()
