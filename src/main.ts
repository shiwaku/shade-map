import maplibregl, { type FilterSpecification } from 'maplibre-gl'
import { Protocol, PMTiles } from 'pmtiles'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { TileLayer } from '@deck.gl/geo-layers'
import { GeoJsonLayer } from '@deck.gl/layers'
import { load } from '@loaders.gl/core'
import { MVTLoader } from '@loaders.gl/mvt'
import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'

// ---- 定数 ----
const CENTER: [number, number] = [139.639, 35.878]   // さいたま市中心付近
const SHADE_BEFORE = '注記シンボル付き重なり'          // pale.json: 道路群の直後・最初のラベル
const DATE = '2026-08-01'
const BASE = import.meta.env.BASE_URL
const asset = (p: string) => new URL(BASE + p, location.href).href

// PMTiles はサイズが大きくリポジトリに含めないため、本番は外部ホストを参照。
// ローカル開発時は public/tiles/ を配信。REMOTE_TILES は配信先に合わせて書き換える。
const isLocal =
  ['localhost', '127.0.0.1'].includes(location.hostname) ||
  location.hostname.startsWith('172.') ||
  location.hostname.startsWith('192.168.')
const REMOTE_TILES = 'https://shiworks2.xsrv.jp/toshikeikaku/city-saitama/'
const TILES = isLocal ? asset('tiles/') : REMOTE_TILES
const BUILDING_PMTILES = `${TILES}building.pmtiles`
const SHADE_PMTILES = `${TILES}shade.pmtiles`

// 太陽高度・方位（基準日 2026-08-01・市中心の代表値。事前計算と同一）
const SUN: Record<number, { alt: number; az: number }> = {
  5: { alt: 1.3, az: 68 }, 6: { alt: 12.9, az: 77 }, 7: { alt: 24.9, az: 85 },
  8: { alt: 37.0, az: 94 }, 9: { alt: 49.0, az: 104 }, 10: { alt: 60.2, az: 120 },
  11: { alt: 69.2, az: 146 }, 12: { alt: 71.9, az: 189 }, 13: { alt: 66.0, az: 226 },
  14: { alt: 55.8, az: 247 }, 15: { alt: 44.1, az: 260 }, 16: { alt: 32.0, az: 270 },
  17: { alt: 19.9, az: 278 }, 18: { alt: 8.1, az: 286 },
}

// 建物属性コード（DB定義書「GISデータ_DB定義書_建物現況調査」別表1・別表2）
// RIYOU=88（建物としてカウントしない構造物等）はタイル生成時に除外済み
const RIYOU_LABEL: Record<number, string> = {
  1: '専用住宅', 2: '共同住宅', 3: '商業・業務併用住宅', 4: '工業併用住宅',
  5: '商業施設(A)', 6: '商業施設(B)', 7: '商業施設(C)', 8: '商業施設(D)',
  9: '業務施設', 10: '商業・業務施設', 11: '宿泊施設', 12: '風俗営業施設',
  13: '娯楽施設', 14: '遊戯施設(A)', 15: '遊戯施設(B)', 16: '官公庁施設',
  17: '文教厚生施設(A)', 18: '文教厚生施設(B)', 19: '文教厚生施設(C)',
  20: '医療・福祉施設', 21: '供給処理施設', 22: '工業施設(A)', 23: '工業施設(B)',
  24: '運輸・倉庫施設(A)', 25: '運輸・倉庫施設(B)', 26: '農林漁業施設', 27: 'その他',
  88: '建物としてカウントしない構造物等',
}
const KOUZO_LABEL: Record<number, string> = {
  1: '耐火造', 2: '準耐火', 3: '防火造', 4: '準防火造', 5: '木造',
}

// ---- PMTiles プロトコル ----
const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile)

// ---- 地図 ----
const map = new maplibregl.Map({
  container: 'map',
  style: asset('style/pale.json'),
  center: CENTER,
  zoom: 12,
  pitch: 0,
  maxZoom: 19,
  hash: true,
})
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
const geolocate = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
})
map.addControl(geolocate, 'top-right')
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')

// ---- UI ----
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const timeEl = $<HTMLInputElement>('time')
const timeval = $<HTMLSpanElement>('timeval')
const suninfo = $<HTMLDivElement>('suninfo')
const playBtn = $<HTMLButtonElement>('play')
const bldgChk = $<HTMLInputElement>('bldg')

const hourFilter = (hour: number): FilterSpecification => ['==', ['get', 'hour'], hour]

// ---- 建物ワイヤーフレーム（deck.gl TileLayer + PMTiles/MVT）----
const buildingPM = new PMTiles(BUILDING_PMTILES)
let overlay: MapboxOverlay | null = null

function wireframeLayer(): TileLayer {
  return new TileLayer({
    id: 'bldg-wire',
    minZoom: 13,
    maxZoom: 16,
    getTileData: async ({ index, signal }) => {
      const { x, y, z } = index
      const tile = await buildingPM.getZxy(z, x, y, signal ?? undefined)
      if (!tile) return null
      return (await load(tile.data, MVTLoader, {
        mvt: { coordinates: 'wgs84', tileIndex: { x, y, z } },
        worker: false,
      })) as unknown[]
    },
    renderSubLayers: (props) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = props.data as any[] | null
      if (!data || data.length === 0) return null
      return new GeoJsonLayer({
        id: `${props.id}-geo`,
        data,
        extruded: true,
        wireframe: true,
        filled: false,
        stroked: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getElevation: (f: any) => f.properties?.TAKASA ?? 0,
        getLineColor: [70, 60, 52, 220],
        lineWidthMinPixels: 1,
      })
    },
  })
}

function updateOverlay(): void {
  overlay?.setProps({ layers: bldgChk.checked ? [wireframeLayer()] : [] })
}

function render(): void {
  const hour = Number(timeEl.value)
  timeval.textContent = `${String(hour).padStart(2, '0')}:00`
  const s = SUN[hour]
  if (s) {
    const ratio = s.alt > 0.5 ? (1 / Math.tan((s.alt * Math.PI) / 180)).toFixed(2) : '∞'
    suninfo.innerHTML =
      `太陽高度 <b>${s.alt}°</b>／方位 <b>${s.az}°</b><br>影の長さ ≒ 高さ × <b>${ratio}</b>`
  }
  if (map.getLayer('shade')) map.setFilter('shade', hourFilter(hour))
}

// ---- イベント ----
timeEl.addEventListener('input', render)

let timer: number | null = null
playBtn.addEventListener('click', () => {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
    playBtn.textContent = '▶ 1日を再生'
    return
  }
  playBtn.textContent = '⏸ 停止'
  timer = window.setInterval(() => {
    let v = Number(timeEl.value) + 1
    if (v > 18) v = 5
    timeEl.value = String(v)
    render()
  }, 700)
})

bldgChk.addEventListener('change', () => {
  if (map.getLayer('bldg-3d')) {
    map.setLayoutProperty('bldg-3d', 'visibility', bldgChk.checked ? 'visible' : 'none')
  }
  updateOverlay()
})

$<HTMLButtonElement>('locate').addEventListener('click', () => geolocate.trigger())

// ---- 建物クリック → 属性ポップアップ ----
// 当たり判定は透明な fill-extrusion レイヤー 'bldg-3d'。
// 表示できる属性はタイルに焼かれたものだけ（build_tiles.sh の tippecanoe -y を参照）。
const numOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

function buildingPopupHTML(p: Record<string, unknown>): string {
  const tid = numOf(p.TID)
  const riyou = numOf(p.RIYOU)
  const kouzo = numOf(p.KOUZO)
  const kaisu = numOf(p.KAISU)
  const takasa = numOf(p.TAKASA)
  const nobemen = numOf(p.NOBEMEN)

  const rows: [string, string][] = []
  if (riyou !== null) rows.push(['用途', RIYOU_LABEL[riyou] ?? `コード ${riyou}`])
  if (kouzo !== null) rows.push(['構造', KOUZO_LABEL[kouzo] ?? `コード ${kouzo}`])
  if (kaisu !== null) rows.push(['階数', `地上 ${kaisu} 階`])
  if (takasa !== null) rows.push(['高さ', `${takasa} m`])
  if (nobemen !== null) rows.push(['延床面積', `${nobemen.toLocaleString('ja-JP')} ㎡`])

  // この建物が現在時刻に落とす影の長さ（水平投影長 = 高さ ÷ tan(太陽高度)）
  const hour = Number(timeEl.value)
  const s = SUN[hour]
  if (takasa !== null && s && s.alt > 0.5) {
    const len = takasa / Math.tan((s.alt * Math.PI) / 180)
    rows.push([`影の長さ <span class="hint">${String(hour).padStart(2, '0')}:00</span>`,
      `約 ${len.toFixed(1)} m`])
  }

  const head = tid !== null ? `建物 <span class="tid">TID ${tid}</span>` : '建物'
  const body = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')
  return `<div class="bpop"><div class="bpop-h">${head}</div><table>${body}</table></div>`
}

let popup: maplibregl.Popup | null = null

map.on('click', (e) => {
  if (!map.getLayer('bldg-3d')) return
  const hit = map.queryRenderedFeatures(e.point, { layers: ['bldg-3d'] })[0]
  popup?.remove()
  popup = null
  if (!hit) return
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: '270px', className: 'bldg-popup' })
    .setLngLat(e.lngLat)
    .setHTML(buildingPopupHTML(hit.properties ?? {}))
    .addTo(map)
})

map.on('mouseenter', 'bldg-3d', () => { map.getCanvas().style.cursor = 'pointer' })
map.on('mouseleave', 'bldg-3d', () => { map.getCanvas().style.cursor = '' })

// ---- パネル開閉 ----
const panel = $<HTMLDivElement>('panel')
const panelOpen = $<HTMLButtonElement>('panel-open')
$<HTMLButtonElement>('panel-close').addEventListener('click', () => {
  panel.classList.add('hidden')
  panelOpen.classList.add('show')
})
panelOpen.addEventListener('click', () => {
  panel.classList.remove('hidden')
  panelOpen.classList.remove('show')
})

// ---- ロード ----
map.on('load', () => {
  $<HTMLSpanElement>('thedate').textContent = DATE

  // 日陰（PMTiles / vector fill・hourフィルタ）。道路の上・ラベルの下に差し込む
  map.addSource('shade', { type: 'vector', url: `pmtiles://${SHADE_PMTILES}` })
  map.addLayer(
    {
      id: 'shade',
      type: 'fill',
      source: 'shade',
      'source-layer': 'shade',
      paint: { 'fill-color': '#0e1219', 'fill-opacity': 0.52 },
      filter: hourFilter(Number(timeEl.value)),
    },
    SHADE_BEFORE,
  )

  // 建物 壁面（PMTiles / fill-extrusion）
  // 壁面は完全透明。見た目は deck.gl のワイヤーフレームが担い、この層は
  //  (a) クリック時の当たり判定（queryRenderedFeatures は塗り透明でもヒットする）
  //  (b) 深度バッファへの書き込み → 建物裏側のワイヤーフレームを隠す
  // の2役で残している。
  map.addSource('bldg', { type: 'vector', url: `pmtiles://${BUILDING_PMTILES}` })
  map.addLayer({
    id: 'bldg-3d',
    type: 'fill-extrusion',
    source: 'bldg',
    'source-layer': 'building',
    minzoom: 13,
    paint: {
      'fill-extrusion-color': '#f0ece4',
      'fill-extrusion-height': ['get', 'TAKASA'],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0,
    },
  })

  // 建物ワイヤーフレーム（deck.gl・壁面の上）
  overlay = new MapboxOverlay({ interleaved: true, layers: [] })
  map.addControl(overlay)
  updateOverlay()

  render()
  $<HTMLDivElement>('loading').style.display = 'none'

  const w = window as unknown as { setHour?: (h: number) => void; __shadeReady?: boolean }
  w.setHour = (h: number) => { timeEl.value = String(h); render() }
  w.__shadeReady = true
})
