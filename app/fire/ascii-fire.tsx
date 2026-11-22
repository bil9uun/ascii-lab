'use client'

import { useEffect, useRef } from 'react'

const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const BG = '#05070d'
const STEP = 1000 / 30 // pointer-heat simulation runs at 30 steps/s regardless of refresh rate
const LEVELS = 64
const MAX_EMBERS = 120

// ---------- value noise (deterministic, so server and client agree) ----------
const PERM = new Uint8Array(512)
const VALS = new Float32Array(256)
{
  let s = 1234567
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
  for (let i = 0; i < 256; i++) {
    PERM[i] = i
    VALS[i] = rand()
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = PERM[i]
    PERM[i] = PERM[j]
    PERM[j] = tmp
  }
  for (let i = 0; i < 256; i++) PERM[i + 256] = PERM[i]
}

// Smooth 2D value noise in [0, 1].
function noise(x: number, y: number) {
  const xf = Math.floor(x)
  const yf = Math.floor(y)
  const xi = xf & 255
  const yi = yf & 255
  let tx = x - xf
  let ty = y - yf
  tx = tx * tx * (3 - 2 * tx)
  ty = ty * ty * (3 - 2 * ty)
  const a = VALS[PERM[PERM[xi] + yi]]
  const b = VALS[PERM[PERM[xi + 1] + yi]]
  const c = VALS[PERM[PERM[xi] + yi + 1]]
  const d = VALS[PERM[PERM[xi + 1] + yi + 1]]
  return a + (b - a) * tx + (c - a + (d - c - b + a) * tx) * ty
}

// Three octaves of noise, in [0, 1].
function fbm(x: number, y: number) {
  return noise(x, y) * 0.55 + noise(x * 2 + 5.2, y * 2 + 1.3) * 0.3 + noise(x * 4 + 9.7, y * 4 + 3.1) * 0.15
}

// Cheap per-cell hash in [0, 1) for stable texture choices.
const hash = (x: number, y: number) => VALS[PERM[PERM[x & 255] + (y & 255)]]

// ---------- precomputed colors ----------
type Stop = [number, number, number, number]

function ramp(stops: Stop[], n: number) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    let k = 1
    while (stops[k][0] < t) k++
    const [t0, r0, g0, b0] = stops[k - 1]
    const [t1, r1, g1, b1] = stops[k]
    const f = (t - t0) / (t1 - t0)
    return `rgb(${Math.round(r0 + (r1 - r0) * f)} ${Math.round(g0 + (g1 - g0) * f)} ${Math.round(b0 + (b1 - b0) * f)})`
  })
}

// Flame body: deep red tips → orange body → yellow → white-hot core.
const FLAME = ramp(
  [
    [0, 95, 14, 6],
    [0.2, 170, 32, 8],
    [0.42, 228, 82, 14],
    [0.62, 252, 140, 28],
    [0.8, 255, 200, 70],
    [0.92, 255, 236, 150],
    [1, 255, 252, 225],
  ],
  LEVELS,
)
// Very dim smoke, barely above the background.
const SMOKE = ramp(
  [
    [0, 18, 20, 26],
    [1, 62, 60, 64],
  ],
  8,
)

// Flame interior glyphs, sparse → dense. '@' is reserved for the white-hot core.
const BODY = ':;!i*+#%'
const SMOKE_GLYPHS = ".~-'"

// ---------- campfire layout, in units of R (fire scale), v pointing up from the flame base ----------
// Logs as [x0, v0, x1, v1, radius, front]. Back logs sit behind the flames, front logs cover them.
const LOGS: [number, number, number, number, number, boolean][] = [
  [-1.2, -0.78, 0.15, 0.55, 0.095, false],
  [1.2, -0.78, -0.15, 0.55, 0.095, false],
  [0.42, -0.85, 0.02, 0.5, 0.085, false],
  [-0.95, -0.9, -0.05, 0.3, 0.1, true],
  [0.95, -0.9, 0.05, 0.3, 0.1, true],
]
// Stones in a ring around the front of the fire: [x, v, half-width, half-height].
const STONES: [number, number, number, number][] = [
  [-1.38, -0.86, 0.14, 0.09],
  [-1.0, -0.98, 0.15, 0.09],
  [-0.55, -1.04, 0.16, 0.08],
  [-0.08, -1.06, 0.15, 0.09],
  [0.4, -1.05, 0.16, 0.08],
  [0.86, -1.0, 0.15, 0.09],
  [1.26, -0.9, 0.14, 0.09],
]
const LOG_DARK = 'rgb(46 27 16)'
const LOG_MID = 'rgb(86 52 29)'
const LOG_LIT = 'rgb(146 86 42)'
const LOG_END = 'rgb(168 122 76)'
const STONE_DARK = 'rgb(54 54 60)'
const STONE_LIT = 'rgb(118 92 74)'

// Cell kinds for the static campfire map.
const NONE = 0
const DARK = 1
const MID = 2
const LIT = 3
const END = 4
const STONE = 5
const STONE_TOP = 6
const CRACK = 7 // glowing ember crack in a log
const COAL = 8 // glowing coal between the stones
const KIND_COLOR = ['', LOG_DARK, LOG_MID, LOG_LIT, LOG_END, STONE_DARK, STONE_LIT]

// Flame tongues rise from fixed slots along the log pile; outer ones are shorter.
const SLOTS = [-0.7, -0.36, 0, 0.34, 0.68]
const MAX_BLOBS = 16
const H = 2.2 // nominal height of the tallest tongue, in R

export default function AsciiFire() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let w = 0, h = 0, dpr = 1, fs = 12, cw = 0, chH = 0, cols = 0, rows = 0, ox = 0, oy = 0
    let R = 100 // fire scale in px; the log pile spans about 2.5 R
    let cx = 0, gy = 0 // flame base center in px
    let cu = new Float32Array(0) // per-column x in R units
    let cv = new Float32Array(0) // per-row height in R units
    let field = new Float32Array(0) // flame heat per cell, rebuilt each frame
    let extra = new Float32Array(0) // heat added by the pointer, simulated as classic cellular fire
    let kind = new Uint8Array(0) // static logs/stones/coals map
    let back = new Uint8Array(0) // 1 where a log cell is behind the flames
    let glyph: string[] = []
    let x0 = 0, x1 = 0, y0 = 0, y1 = 0 // flame + smoke bounding box in cells

    // Unit radial gradient, stretched into ellipses with setTransform when drawing glows.
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    glow.addColorStop(0, 'rgba(255, 130, 40, 0.32)')
    glow.addColorStop(0.45, 'rgba(220, 70, 15, 0.1)')
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)')

    // Tongues: each lives for a while, flickers with its own phase, then pinches off its tip as a blob.
    const N = SLOTS.length
    const tx = new Float32Array(N) // base x
    const th = new Float32Array(N) // max height
    const tw = new Float32Array(N) // half-width at the base
    const tage = new Float32Array(N)
    const tlife = new Float32Array(N)
    const tseed = new Float32Array(N)
    const tcur = new Float32Array(N) // current height this frame
    const tsway = new Float32Array(N) // sway of each tongue at the current row
    const resetTongue = (i: number) => {
      const c = 1 - Math.abs(SLOTS[i]) / 0.8 // 1 in the middle, ~0.13 at the sides
      tx[i] = SLOTS[i] + (Math.random() - 0.5) * 0.14
      th[i] = (0.9 + 0.9 * c) * (0.65 + Math.random() * 0.55)
      tw[i] = 0.16 + 0.1 * c + Math.random() * 0.05
      tage[i] = 0
      tlife[i] = 0.6 + Math.random() * 1.4
      tseed[i] = Math.random() * 100
    }
    for (let i = 0; i < N; i++) {
      resetTongue(i)
      tage[i] = Math.random() * tlife[i]
    }

    // Detached flame blobs: rise, shrink and fade.
    const bu = new Float32Array(MAX_BLOBS)
    const bv = new Float32Array(MAX_BLOBS)
    const br = new Float32Array(MAX_BLOBS)
    const blife = new Float32Array(MAX_BLOBS)
    const bmax = new Float32Array(MAX_BLOBS)
    let blobs = 0

    // Embers as struct-of-arrays, positions in px.
    const ex = new Float32Array(MAX_EMBERS)
    const ey = new Float32Array(MAX_EMBERS)
    const evx = new Float32Array(MAX_EMBERS)
    const evy = new Float32Array(MAX_EMBERS)
    const elife = new Float32Array(MAX_EMBERS)
    const emax = new Float32Array(MAX_EMBERS)
    let embers = 0

    const spawnEmber = (px: number, py: number) => {
      if (embers >= MAX_EMBERS) return
      const i = embers++
      ex[i] = px
      ey[i] = py
      evx[i] = (Math.random() - 0.5) * R * 0.8
      evy[i] = -R * (1.2 + Math.random() * 1.8)
      emax[i] = elife[i] = 1.2 + Math.random() * 2.3
    }

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      fs = Math.max(8, Math.min(16, Math.round(Math.min(w, h) / 70)))
      ctx.font = `${fs}px ${FONT}`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      cw = ctx.measureText('M').width
      chH = Math.round(fs * 1.2)
      cols = Math.floor(w / cw)
      rows = Math.floor(h / chH)
      ox = (w - cols * cw) / 2
      oy = (h - rows * chH) / 2

      // Log pile spans ~35% of a wide screen, most of a phone's width, and never gets too tall.
      R = Math.min(h * 0.19, w * 0.14 + 64)
      cx = w / 2
      gy = Math.min(h - 1.2 * R, h * 0.7)

      const n = cols * rows
      cu = new Float32Array(cols)
      cv = new Float32Array(rows)
      for (let x = 0; x < cols; x++) cu[x] = (ox + (x + 0.5) * cw - cx) / R
      for (let y = 0; y < rows; y++) cv[y] = (gy - (oy + (y + 0.5) * chH)) / R
      field = new Float32Array(n)
      extra = new Float32Array(n)
      kind = new Uint8Array(n)
      back = new Uint8Array(n)
      glyph = new Array<string>(n).fill('')

      const clampCol = (u: number) => Math.max(0, Math.min(cols, Math.round((u * R + cx - ox) / cw)))
      const clampRow = (v: number) => Math.max(0, Math.min(rows, Math.round((gy - v * R - oy) / chH)))
      x0 = clampCol(-2.4)
      x1 = clampCol(2.4)
      y0 = clampRow(H * 2.3)
      y1 = clampRow(-0.6)

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x
          const u = cu[x]
          const v = cv[y]
          const r = hash(x, y)
          // Coal bed inside the stone ring.
          if ((u / 1.2) ** 2 + ((v + 0.9) / 0.12) ** 2 < 1 && r < 0.55) {
            kind[i] = COAL
            glyph[i] = '.,:o*'[Math.floor(hash(y + 31, x) * 5)]
          }
          for (const [ax, av, bx, bv, rad, front] of LOGS) {
            const dx = bx - ax
            const dv = bv - av
            const len = Math.hypot(dx, dv)
            const s = ((u - ax) * dx + (v - av) * dv) / (len * len)
            if (s < 0 || s > 1) continue
            // Signed distance from the log axis; positive = upper side.
            const d = (((v - av) * dx - (u - ax) * dv) / len) * Math.sign(dx)
            if (Math.abs(d) > rad) continue
            const along = Math.min(s, 1 - s) * len
            const top = d / rad
            // Bark grain runs along the log, so pick a stroke matching its on-screen slope.
            const slope = dv / dx // on-screen slope (R units are square)
            const grain = slope > 0.35 ? '/' : slope < -0.35 ? '\\' : '-'
            const bark = noise(s * len * 9, top * 1.5 + ax * 7)
            back[i] = front ? 0 : 1
            if (along < rad * 0.9) {
              kind[i] = END
              glyph[i] = Math.abs(top) < 0.45 ? '@' : 'o'
            } else if (top < -0.35) {
              kind[i] = DARK
              glyph[i] = bark < 0.5 ? '#' : grain
            } else if (top > 0 && r < 0.14 && Math.abs(u) < 1) {
              kind[i] = CRACK
              glyph[i] = r < 0.07 ? '~' : '='
            } else if (top > 0.45) {
              kind[i] = LIT
              glyph[i] = bark < 0.45 ? grain : bark < 0.7 ? '%' : '#'
            } else {
              kind[i] = MID
              glyph[i] = bark < 0.35 ? grain : bark < 0.75 ? '#' : '%'
            }
          }
          // Stones are in front of everything.
          for (const [sx, sv, rx, rv] of STONES) {
            const qx = (u - sx) / rx
            const qv = (v - sv) / rv
            if (qx * qx + qv * qv > 1) continue
            back[i] = 0
            if (qx < -0.7) {
              kind[i] = STONE
              glyph[i] = '('
            } else if (qx > 0.7) {
              kind[i] = STONE
              glyph[i] = ')'
            } else if (qv > 0.2) {
              kind[i] = STONE_TOP
              glyph[i] = '_'
            } else {
              kind[i] = STONE
              glyph[i] = r < 0.5 ? '#' : '%'
            }
          }
        }
      }
    }

    // Pointer heat: each cell pulls heat from a jittered cell below and cools quickly.
    const step = () => {
      for (let y = 0; y < rows - 1; y++) {
        const row = y * cols
        const below = row + cols
        for (let x = 0; x < cols; x++) {
          const sx = x + 1 - Math.floor(Math.random() * 3)
          const v = sx >= 0 && sx < cols ? extra[below + sx] : 0
          extra[row + x] = Math.max(0, v - Math.random() * 0.16)
        }
      }
      const base = (rows - 1) * cols
      for (let x = 0; x < cols; x++) extra[base + x] *= 0.5
    }

    const onPointer = (e: PointerEvent) => {
      const c = Math.floor((e.offsetX - ox) / cw)
      const r = Math.floor((e.offsetY - oy) / chH)
      for (let y = r; y < r + 2; y++) {
        for (let x = c - 1; x <= c + 1; x++) {
          if (x >= 0 && x < cols && y >= 0 && y < rows) extra[y * cols + x] = 1
        }
      }
      if (Math.random() < 0.15) spawnEmber(e.offsetX, e.offsetY)
    }

    let raf = 0
    let last = performance.now()
    let acc = 0

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      acc += Math.min(250, now - last)
      last = now
      while (acc >= STEP) {
        step()
        acc -= STEP
      }
      const t = now / 1000

      // Global behavior: drifting wind, height puffing (~2-3 Hz for a fire this size), glow flicker.
      const wind = (noise(t * 0.15, 3.7) - 0.5) * 0.9
      const pulse = 1 + (noise(t * 2.6, 11.1) - 0.5) * 0.3
      const bright = 0.75 + (noise(t * 4, 5.5) - 0.5) * 0.6

      // Tongue life cycle: grow in, flicker, and at the end pinch the tip off as a rising blob.
      for (let i = 0; i < N; i++) {
        tage[i] += dt
        const a = tage[i] / tlife[i]
        const grow = 0.45 + 0.55 * Math.min(1, a / 0.2)
        tcur[i] = th[i] * grow * pulse * (0.8 + 0.35 * noise(t * 3 + tseed[i], tseed[i]))
        if (a >= 1) {
          if (blobs < MAX_BLOBS) {
            const j = blobs++
            bu[j] = tx[i] + wind * 0.3
            bv[j] = tcur[i] * 0.78
            br[j] = tw[i] * (0.45 + Math.random() * 0.3)
            bmax[j] = blife[j] = 0.35 + Math.random() * 0.35
          }
          resetTongue(i)
        }
      }
      for (let j = 0; j < blobs; j++) {
        blife[j] -= dt
        if (blife[j] <= 0) {
          const k = --blobs
          bu[j] = bu[k]; bv[j] = bv[k]; br[j] = br[k]; blife[j] = blife[k]; bmax[j] = bmax[k]
          j--
          continue
        }
        bv[j] += 1.6 * dt
        bu[j] += wind * 0.4 * dt
      }

      // Build the heat field: pointer heat everywhere, flames inside their box.
      field.set(extra)
      for (let y = y0; y < y1; y++) {
        const v = cv[y]
        if (v > H * 1.6) continue
        const vk = Math.max(0, v)
        for (let i = 0; i < N; i++) {
          const k = vk / tcur[i]
          tsway[i] = (noise(v * 0.8 - t * 1.4, tseed[i]) - 0.5) * 0.7 * k * k + wind * k * k * 0.35
        }
        const row = y * cols
        for (let x = x0; x < x1; x++) {
          const u = cu[x]
          // Turbulent sideways licking, stronger higher up.
          const uw = u + (noise(u * 1.7 + 4.1, v * 1.3 - t * 2.6) - 0.5) * (0.2 + 0.25 * Math.min(1, vk))
          let sum = 0
          for (let i = 0; i < N; i++) {
            const k = vk / tcur[i]
            if (k >= 1) continue
            // Teardrop: full width at the base, tapering to a point at the tip.
            const half = tw[i] * Math.pow(1 - k, 0.6) * Math.max(0.25, 1 + Math.min(0, v) * 1.5)
            const c = 1 - Math.abs(uw - tx[i] - tsway[i]) / half
            if (c > 0) sum += c * (1 - 0.45 * k)
          }
          for (let j = 0; j < blobs; j++) {
            const life = blife[j] / bmax[j]
            const r = br[j] * (0.4 + 0.6 * life)
            const qx = (uw - bu[j]) / r
            const qv = (v - bv[j]) / (r * 2)
            const q = 1 - qx * qx - qv * qv
            if (q > 0) sum += q * 0.5 * life
          }
          // A glowing bed where the tongues leave the wood.
          const bed = v < 0.2 && v > -0.5 ? Math.max(0, 1 - (u / 0.7) ** 2) * Math.min(1, (0.2 - v) * 3) * 0.35 : 0
          if (sum + bed <= 0) continue
          // Upward-scrolling, vertically stretched noise makes the edges ragged and opens holes.
          const n = (fbm(uw * 3.4, Math.pow(vk, 0.8) * 1.6 - t * 3.2) - 0.5) * 2.6
          const f = (sum + bed + n * (0.18 + 0.12 * Math.min(1, vk))) * (1 - 0.25 * Math.min(1, vk / H))
          if (f > field[row + x]) field[row + x] = f
        }
      }

      ctx.fillStyle = BG
      ctx.fillRect(0, 0, w, h)

      // Warm light on the ground and in the air around the fire.
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = glow
      ctx.globalAlpha = bright
      ctx.setTransform(dpr * R * 2.4, 0, 0, dpr * R * 0.6, dpr * cx, dpr * (gy + 0.9 * R))
      ctx.fillRect(-1, -1, 2, 2)
      ctx.globalAlpha = bright * 0.7
      ctx.setTransform(dpr * R * 2, 0, 0, dpr * R * 2.4, dpr * cx, dpr * (gy - 0.6 * R))
      ctx.fillRect(-1, -1, 2, 2)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'

      let cur = ''
      const smokeSway = (noise(-t * 1.1, 1.7) - 0.5) * 0.6 + wind * 0.5
      const smokeBase = H * pulse * 0.75
      for (let y = 0; y < rows; y++) {
        const v = cv[y]
        const py = oy + (y + 0.5) * chH
        const row = y * cols
        for (let x = 0; x < cols; x++) {
          const i = row + x
          const px = ox + (x + 0.5) * cw
          const kd = kind[i]
          const f = field[i]
          let color = ''
          let g = ''
          if (kd !== NONE && !(back[i] && f > 0.45 + 0.3 * hash(y, x))) {
            if (kd >= CRACK) {
              // Embers in cracks and coals breathe slowly.
              const e = noise(x * 0.35 + 7, t * 0.9 + y * 0.4)
              const lvl = kd === CRACK ? 0.12 + 0.6 * e * e * bright : 0.05 + 0.5 * e * e * bright
              color = FLAME[Math.floor(lvl * (LEVELS - 1))]
            } else {
              color = KIND_COLOR[kd]
            }
            g = glyph[i]
          } else if (f > 0.08) {
            const heat = 1 - Math.exp(-1.8 * f) // soft clamp: only overlapping tongues reach white
            const left = x > 0 && field[i - 1] > 0.08
            const right = x < cols - 1 && field[i + 1] > 0.08
            const up = y > 0 && field[i - cols] > 0.08
            const r = hash(x, y)
            if (!up && heat < 0.5) {
              // Tips: soft little strokes.
              g = r < 0.3 ? '^' : r < 0.55 ? "'" : r < 0.8 ? '`' : '.'
            } else if ((!left || !right) && heat < 0.5) {
              // Sides: mostly soft dots and ticks, an occasional bracket.
              g = r < 0.1 ? (left ? ')' : '(') : r < 0.45 ? ':' : r < 0.75 ? "'" : ','
            } else if (heat < 0.22) {
              g = r < 0.5 ? '.' : ':'
            } else {
              // Interior: density follows heat, jittered per cell and by a rising noise so rows don't band.
              const jit = (r - 0.5) * 1.4 + (noise(x * 0.6, y * 0.6 - t * 4) - 0.5) * 2.2
              const b = Math.max(0, Math.min(BODY.length - 1, Math.floor(heat * BODY.length + jit)))
              g = heat > 0.88 && hash(y, x) < 0.4 ? '@' : BODY[b]
            }
            color = FLAME[Math.floor(heat * (LEVELS - 1))]
          } else if (x >= x0 && x < x1 && y >= y0 && v > smokeBase) {
            // Faint smoke wisps above the flames.
            const s = (v - smokeBase) / (H * 1.3)
            if (s < 1 && hash(x, y) < 0.6) {
              const u = cu[x] - smokeSway - wind * s * 1.5
              const width = 0.3 + s * 0.7
              const m = 1 - (u / width) ** 2
              if (m > 0) {
                // Ridged noise gives thin curling filaments instead of a cloud.
                const rn = 1 - Math.abs(2 * fbm(u * 2.6 + v * 0.7 + t * 0.15, v * 1.2 - u * 0.5 - t * 0.9) - 1)
                const d = rn ** 6 * m * Math.sin(Math.PI * s)
                if (d > 0.3) {
                  color = SMOKE[Math.min(7, Math.floor((d - 0.3) * 16))]
                  g = SMOKE_GLYPHS[Math.floor(hash(x, y) * SMOKE_GLYPHS.length)]
                }
              }
            }
          }
          if (!g) continue
          if (color !== cur) ctx.fillStyle = cur = color
          ctx.fillText(g, px, py)
        }
      }

      // Embers: spawn steadily plus occasional pops, rise on buoyancy, drift, cool and fade.
      if (Math.random() < 6 * dt) spawnEmber(cx + (Math.random() - 0.5) * R * 1.2, gy - R * (0.2 + Math.random() * 1.2))
      if (Math.random() < 0.3 * dt) {
        const n = 4 + Math.floor(Math.random() * 8)
        const px = cx + (Math.random() - 0.5) * R * 1.4
        for (let j = 0; j < n; j++) spawnEmber(px, gy - R * 0.2)
      }
      ctx.shadowBlur = fs * 0.6
      for (let i = 0; i < embers; i++) {
        elife[i] -= dt
        if (elife[i] <= 0 || ey[i] < -fs) {
          const j = --embers
          ex[i] = ex[j]; ey[i] = ey[j]; evx[i] = evx[j]; evy[i] = evy[j]; elife[i] = elife[j]; emax[i] = emax[j]
          i--
          continue
        }
        const life = elife[i] / emax[i]
        evx[i] += ((noise(ex[i] * 0.01, t * 1.5 + i) - 0.5) * 6 * R + wind * R * 0.8 - evx[i]) * dt
        evy[i] += (-R * 0.6 * life - evy[i] * 0.4) * dt
        ex[i] += evx[i] * dt
        ey[i] += evy[i] * dt
        const c = FLAME[Math.floor((0.15 + 0.85 * life) * (LEVELS - 1))]
        ctx.fillStyle = ctx.shadowColor = c
        ctx.fillText(life > 0.7 ? '*' : i % 3 === 0 ? "'" : '.', ex[i], ey[i])
      }
      ctx.shadowBlur = 0

      raf = requestAnimationFrame(frame)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    canvas.addEventListener('pointermove', onPointer)
    canvas.addEventListener('pointerdown', onPointer)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointermove', onPointer)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return <canvas ref={ref} className="absolute inset-0 h-full w-full touch-none" aria-label="ASCII гал" role="img" />
}
