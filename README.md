# shade-map — さいたま市 日陰マップ（全域）

猛暑日に「日陰を選んで歩く」ための、**時間帯別 日陰マップ**。
さいたま市の建物現況調査データ（建物フットプリント＋高さ）から、1時間ごとの日陰ポリゴンを事前計算し、
**MapLibre GL JS + deck.gl** で可視化します。時刻スライダーで時間帯を切り替えると、その時刻の日陰が表示されます。
対象は**さいたま市全域（約44.7万棟）**。

PLATEAU の「特定の日時における日陰を閲覧する」と同じ発想を、市の独自調査データで再現したものです。

![preview](notes/preview.png)

## 技術構成
- **ビルド**: Vite + TypeScript（Node.js）
- **地図**: MapLibre GL JS 5（`5.24.0` 固定）
- **背景地図**: 国土地理院 最適化ベクトルタイル（淡色地図風スタイル, `public/style/pale.json`）
- **日陰**: PMTiles（`shade.pmtiles`）を MapLibre の vector fill で描画し、`hour` 属性でフィルタ。
  道路の上・地名ラベルの下（`beforeId`）に差し込む
- **建物 壁面**: PMTiles（`building.pmtiles`）を `fill-extrusion`
- **建物 枠線**: deck.gl（`@deck.gl/geo-layers` TileLayer）が同じ `building.pmtiles` を
  `pmtiles` + `@loaders.gl/mvt` で読み、3D ワイヤーフレーム（extruded/wireframe）を壁面の上に重畳
- トークン不要・すべて無料タイル

## 画面
- 時刻スライダー（5:00〜18:00）で日陰を切替、「▶ 1日を再生」でアニメーション
- 建物（3D 壁面＋枠線）の表示オン/オフ、現在地（GeolocateControl）
- パネルは開閉可、太陽高度・方位・影長倍率を表示

## データと配信
| データ | 内容 | サイズ |
|---|---|---|
| `building.pmtiles` | 建物FP＋高さ TAKASA（z13–16, 446,851棟） | 約34MB |
| `shade.pmtiles` | 建物ごとの日陰（毎正時14枚, `hour`属性, z12–16, 6,255,914ポリゴン） | 約191MB |

- 出典：さいたま市 建物現況調査（市独自調査／R3都市計画基礎調査、基準日 2021-03-31）
- 原データ座標系：平面直角座標系 第Ⅸ系（EPSG:6677）

**PMTiles はサイズが大きいためリポジトリには含めません（`.gitignore`）。**
`src/main.ts` の URL 切替で、**ローカル開発時は `public/tiles/`**、**本番は外部ホスト**（`REMOTE_TILES`）を参照します。
本番公開時は `building.pmtiles` / `shade.pmtiles` を配信サーバへアップロードし、`REMOTE_TILES` をその URL に合わせてください。

## セットアップ
```bash
npm install
npm run tiles      # 原データ → PMTiles 生成（初回のみ・下記参照）
npm run dev        # 開発サーバ (http://localhost:5173)
npm run build      # 型チェック + ビルド → docs/
npm run preview    # docs/ をプレビュー
```

## タイル生成（再現手順）
`scripts/build_tiles.sh` が一括実行します（要 GDAL / tippecanoe / python3）。
```bash
npm run tiles
# 1) ogr2ogr: HouseR03.shp → work/buildings_city.geojson (4326)
# 2) tippecanoe: → public/tiles/building.pmtiles
# 3) precompute_shade_city.py: 建物ごとの日陰(毎正時) → work/shade_city.ndjson
# 4) tippecanoe: → public/tiles/shade.pmtiles
```
基準日・時間帯・座標系は `scripts/precompute_shade_city.py` 冒頭の定数で変更できます。

## 日陰の計算方法
各建物フットプリントを、太陽と反対方向へ `L = 高さ ÷ tan(太陽高度)` だけ水平移動し、
元＋移動後の凸包を1棟分の日陰とする（**融合せず建物単位**で保持するため全域でも高速・タイル化が安定。
重なりで濃淡が出る＝密集地ほど濃い）。太陽位置は NOAA 太陽位置アルゴリズムで算出（JST→UTC 変換込み）。

**前提・制約**：平地想定。地形・樹木・庇・軒などは未考慮。屋根形状は矩形押し出しの近似。
日陰と体感温度の関係は `notes/日陰と体感温度.md` を参照。

## デプロイ（GitHub Pages）
`npm run build` で `docs/` に出力（`base: './'`）。Pages のソースを `main` / `/docs` に設定。
PMTiles はリポジトリ非同梱のため、**本番では外部ホストの PMTiles を参照**します（上記「データと配信」）。
