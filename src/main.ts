import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { GeoJsonLayer, type GeoJsonLayerProps } from '@deck.gl/layers'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'

// ---- 定数 ----
const CENTER: [number, number] = [139.6237, 35.9065] // 大宮駅
const SHADE_BEFORE = '水部表記線point'                 // pale.json 最初のシンボル。日陰をラベル直下に差し込む
const BASE = import.meta.env.BASE_URL
const asset = (p: string) => new URL(BASE + p, location.href).href

interface ShadeProps {
  hour: number
  alt: number
  az: number
  label: string
}
type ShadeFeature = Feature<Polygon | MultiPolygon, ShadeProps>

// ---- PMTiles プロトコル登録 ----
const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile)

// ---- 地図 ----
const map = new maplibregl.Map({
  container: 'map',
  style: asset('style/pale.json'),
  center: CENTER,
  zoom: 15.3,
  pitch: 55,
  bearing: -20,
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

// ---- UI 要素 ----
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const timeEl = $<HTMLInputElement>('time')
const timeval = $<HTMLSpanElement>('timeval')
const suninfo = $<HTMLDivElement>('suninfo')
const playBtn = $<HTMLButtonElement>('play')
const bldgChk = $<HTMLInputElement>('bldg')

// ---- 状態 ----
const shadeByHour = new Map<number, ShadeFeature>()
let overlay: MapboxOverlay | null = null

const shadeFC = (hour: number): FeatureCollection => {
  const f = shadeByHour.get(hour)
  return { type: 'FeatureCollection', features: f ? [f] : [] }
}

function render(): void {
  const hour = Number(timeEl.value)
  timeval.textContent = `${String(hour).padStart(2, '0')}:00`

  const f = shadeByHour.get(hour)
  if (f) {
    const { alt, az } = f.properties
    const ratio = alt > 0.5 ? (1 / Math.tan((alt * Math.PI) / 180)).toFixed(2) : '∞'
    suninfo.innerHTML =
      `太陽高度 <b>${alt}°</b>／方位 <b>${az}°</b><br>影の長さ ≒ 高さ × <b>${ratio}</b>`
  } else {
    suninfo.textContent = 'この時間帯はデータ範囲外'
  }

  // beforeId は interleaved 時に日陰をラベル直下へ差し込むためのプロパティ
  // (@deck.gl/mapbox の LayerOverlayProps 相当。GeoJsonLayerProps に無いため交差型で付与)
  const shadeLayer = new GeoJsonLayer(
    {
      id: 'shade',
      data: shadeFC(hour),
      filled: true,
      stroked: false,
      getFillColor: [40, 54, 79, 150],
      beforeId: SHADE_BEFORE,
    } as GeoJsonLayerProps<ShadeProps> & { beforeId: string },
  )
  overlay?.setProps({ layers: [shadeLayer] })
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
})

$<HTMLButtonElement>('locate').addEventListener('click', () => geolocate.trigger())

// ---- ロード ----
map.on('load', async () => {
  overlay = new MapboxOverlay({ interleaved: true, layers: [] })
  map.addControl(overlay)

  // 建物 (PMTiles / fill-extrusion)
  map.addSource('bldg', { type: 'vector', url: `pmtiles://${asset('tiles/building.pmtiles')}` })
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
      'fill-extrusion-opacity': 0.35,
    },
  })

  // 日陰データ
  const shade = (await (await fetch(asset('data/shade_by_hour.geojson'))).json()) as
    FeatureCollection<Polygon | MultiPolygon, ShadeProps> & { properties?: { date?: string } }
  $<HTMLSpanElement>('thedate').textContent = shade.properties?.date ?? ''
  for (const f of shade.features) shadeByHour.set(f.properties.hour, f as ShadeFeature)

  render()
  $<HTMLDivElement>('loading').style.display = 'none'

  // 動作確認/スクリーンショット用フック
  const w = window as unknown as { setHour?: (h: number) => void; __shadeReady?: boolean }
  w.setHour = (h: number) => { timeEl.value = String(h); render() }
  w.__shadeReady = true
})
