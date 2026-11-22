'use client'

import { useEffect, useRef } from 'react'

const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const BG = '#05070d'
const TAU = Math.PI * 2
const MAX_STARS = 3000
const MAX_PUFFS = 160
const DRAG = 2.2 // air drag on a typical star, 1/s: fast launch, then a visible slow-down

// Star colors as [hue, saturation, lightness of the fully-lit shade].
const HUES = [
  [355, 95, 56], // red
  [25, 100, 56], // orange
  [52, 100, 58], // lemon
  [140, 85, 52], // green
  [180, 95, 55], // aqua
  [222, 95, 64], // blue
  [275, 85, 64], // violet
  [320, 90, 62], // pink
  [0, 0, 76], // silver
  [40, 95, 58], // gold (willow, kamuro, palm)
  [22, 90, 48], // ember (charcoal sparks)
]
const SILVER = 8
const GOLD = 9
const EMBER = 10
const COLORFUL = [0, 1, 2, 3, 4, 5, 6, 7, 8]

// All fill colors are precomputed: index = palette * 10 + level (0 dark .. 7 lit .. 9 white-hot).
const COLORS: string[] = []
for (const [h, s, top] of HUES) {
  for (let i = 0; i < 8; i++) COLORS.push(`hsl(${h} ${s}% ${8 + ((top - 8) * i) / 7}%)`)
  COLORS.push(`hsl(${h} ${s * 0.7}% ${(top + 93) / 2}%)`, `hsl(${h} ${s * 0.3}% 94%)`)
}
const TEXT_C = COLORS.length
for (let i = 0; i < 10; i++) COLORS.push(`hsl(42 70% ${6 + (74 * i) / 9}%)`)
const SMOKE_C = COLORS.length
for (let i = 0; i < 10; i++) COLORS.push(`hsl(225 18% ${5 + 3.2 * i}%)`)
const NCOLORS = COLORS.length

// Glyphs. Moving stars draw direction-aware streaks; still points use HEAD_CH.
const DIR = ['-', '\\', '|', '/']
const HEAD = 4
const HEAD_CH = '..::++****'
const SMOKE_CH = '  ..::::::'
// 64x64 tile of random texture so smoke looks wispy, not like an even grid of dots.
const NOISE = Float32Array.from({ length: 4096 }, () => Math.random() ** 2 * 1.6)

// 5x7 bitmap font, only the digits we need.
const DIGITS: Record<string, string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
}
const YEAR = '2027'

type Kind =
  | 'peony' | 'chrysanthemum' | 'willow' | 'kamuro' | 'brocade' | 'palm'
  | 'crossette' | 'ring' | 'strobe' | 'crackle' | 'senrin'

// What a star does when its fuse or life runs out.
const POP = 1 // crackle: a few white pops
const SPLIT = 2 // crossette: splits into four
const MINI = 3 // senrin: small glittering burst

type Star = {
  x: number; y: number; vx: number; vy: number
  age: number; life: number
  pal: number; pal2: number; change: number // color switches to pal2 at age `change`
  drag: number; grav: number; bright: number
  trail: number; trailPal: number // trail: 0 none, 1 short sparks, 2 long hanging, 3 glitter
  strobe: boolean; phase: number
  end: number; fuse: number; sub: number; delay: number
}
type Shell = { x: number; y: number; vx: number; vy: number; kind: Kind; R: number; pal: number; pal2: number; wait: number }
type Light = { x: number; y: number; age: number; R: number; pal: number; power: number }
type Puff = { x: number; y: number; r: number; age: number; life: number; d: number }
type Mode = 'calm' | 'salvo' | 'quiet' | 'finale'

// Show structure: calm singles, a salvo of matching shells, a quiet build-up, then the finale.
const ACTS: [Mode, number][] = [['calm', 9], ['salvo', 6], ['calm', 7], ['quiet', 2.5], ['finale', 7], ['quiet', 4.5]]
const CALM: [Kind, number][] = [
  ['chrysanthemum', 3], ['peony', 2], ['willow', 1.4], ['kamuro', 1], ['brocade', 1], ['palm', 1.2],
  ['crossette', 1], ['ring', 1], ['strobe', 0.8], ['crackle', 1], ['senrin', 0.8],
]
const FRONT: Kind[] = ['peony', 'chrysanthemum', 'ring', 'crossette', 'strobe', 'palm', 'brocade']
const FINALE: Kind[] = ['chrysanthemum', 'peony', 'crossette', 'brocade', 'crackle', 'strobe', 'senrin', 'ring']

const rand = (a: number, b: number) => a + (b - a) * Math.random()
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const pickWeighted = (a: [Kind, number][]) => {
  let r = Math.random() * a.reduce((s, [, wt]) => s + wt, 0)
  for (const [k, wt] of a) if ((r -= wt) < 0) return k
  return a[0][0]
}
const otherColor = (pal: number) => {
  let p = pal
  while (p === pal) p = pick(COLORFUL)
  return p
}

// Soft radial dot, drawn additively for bloom and sky glow.
function glowSprite(h: number, s: number, l: number) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d') as CanvasRenderingContext2D
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, `hsl(${h} ${s}% ${l}% / 1)`)
  grad.addColorStop(0.3, `hsl(${h} ${s}% ${l}% / 0.35)`)
  grad.addColorStop(1, `hsl(${h} ${s}% ${l}% / 0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return c
}

export default function AsciiFireworks() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const sprites = HUES.map(([h, s]) => glowSprite(h, s, 60))
    const flashSprite = glowSprite(45, 100, 92)

    let w = 0, h = 0, fs = 12, cw = 0, chH = 0, cols = 0, rows = 0, n = 0
    let ox = 0, oy = 0, aspect = 2, K = 40
    // Per-cell light fields. F: fast star light (motion streaks), T: slow spark trails, H: smoke.
    let F = new Float32Array(0), T = new Float32Array(0), H = new Float32Array(0)
    let FP = new Uint8Array(0), FD = new Uint8Array(0), TP = new Uint8Array(0), TC = new Uint8Array(0), TD = new Uint8Array(0)
    let cellC = new Int16Array(0), cellL = new Uint8Array(0), order = new Int32Array(0)
    let cellCh: string[] = []
    let glowI = new Int32Array(0), glowP = new Uint8Array(0), glowL = new Uint8Array(0)
    const counts = new Int32Array(NCOLORS)
    const starts = new Int32Array(NCOLORS)
    const trailDecay = new Float32Array(4)
    let stars: Star[] = [], shells: Shell[] = [], lights: Light[] = [], puffs: Puff[] = []
    let text: number[] = []
    let clock = 0, drift = 0, act = 0, actLeft = ACTS[0][1], wait = 0.2

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      fs = Math.max(8, Math.min(16, Math.round(Math.min(w, h) / 60)))
      ctx.font = `${fs}px ${FONT}`
      ctx.textBaseline = 'top'
      cw = ctx.measureText('M').width
      chH = Math.round(fs * 1.2)
      cols = Math.floor(w / cw)
      rows = Math.floor(h / chH)
      ox = (w - cols * cw) / 2
      oy = (h - rows * chH) / 2
      // Physics runs in cell units: y in rows, x in cols. `aspect` turns a vertical
      // distance into the same on-screen horizontal distance; K = rows across the short side.
      aspect = chH / cw
      K = Math.min(w, h) / chH

      n = cols * rows
      F = new Float32Array(n); T = new Float32Array(n); H = new Float32Array(n)
      FP = new Uint8Array(n); FD = new Uint8Array(n); TP = new Uint8Array(n); TC = new Uint8Array(n); TD = new Uint8Array(n)
      cellC = new Int16Array(n); cellL = new Uint8Array(n); order = new Int32Array(n)
      cellCh = new Array(n).fill('')
      glowI = new Int32Array(n); glowP = new Uint8Array(n); glowL = new Uint8Array(n)
      stars = []; shells = []; lights = []; puffs = []

      // "2027" near the bottom: each bitmap pixel is ~square (aspect cols x 1 row).
      text = []
      const px = Math.max(1, Math.round(aspect))
      const tx = Math.floor((cols - (YEAR.length * 6 - 1) * px) / 2)
      const ty = rows - 9
      for (let d = 0; d < YEAR.length; d++) {
        DIGITS[YEAR[d]].forEach((line, r) => {
          for (let c = 0; c < 5; c++) {
            if (line[c] !== '#') continue
            for (let k = 0; k < px; k++) {
              const x = tx + (d * 6 + c) * px + k
              const y = ty + r
              if (x >= 0 && x < cols && y >= 0) text.push(y * cols + x)
            }
          }
        })
      }
    }

    const cellAt = (x: number, y: number) => {
      const c = Math.round(x)
      const r = Math.round(y)
      return c < 0 || c >= cols || r < 0 || r >= rows ? -1 : r * cols + c
    }
    // Light is "max + a little extra", so a slow star doesn't pile up in one cell
    // but overlapping stars still add up toward white-hot.
    const addF = (x: number, y: number, a: number, pal: number, dir: number) => {
      const i = cellAt(x, y)
      if (i < 0) return
      const prev = F[i]
      F[i] = Math.min(1.6, Math.max(prev, a) + a * 0.12)
      if (a >= prev * 0.6) { FP[i] = pal; FD[i] = dir }
    }
    const addT = (x: number, y: number, a: number, pal: number, cls: number, dir: number) => {
      const i = cellAt(x, y)
      if (i < 0 || a < T[i]) return
      T[i] = a; TP[i] = pal; TC[i] = cls; TD[i] = dir
    }
    const dirOf = (vx: number, vy: number) => {
      const sx = Math.abs(vx * cw), sy = Math.abs(vy * chH)
      if (sy < sx * 0.414) return 0
      if (sx < sy * 0.414) return 2
      return vx * vy > 0 ? 1 : 3
    }

    const spawn = (x: number, y: number, ux: number, uy: number, speed: number, o: Partial<Star>) => {
      if (stars.length >= MAX_STARS) return
      stars.push({
        x, y, vx: ux * speed * aspect, vy: uy * speed, age: 0, life: 2,
        pal: SILVER, pal2: -1, change: 99, drag: DRAG, grav: 0.2 * K, bright: 1,
        trail: 0, trailPal: EMBER, strobe: false, phase: Math.random(),
        end: 0, fuse: 99, sub: 0, delay: 0, ...o,
      })
    }
    // Stars packed on a sphere shell: projected to 2D they crowd at the rim, like a real burst.
    const sphere = (x: number, y: number, count: number, speed: number, o: Partial<Star>) => {
      const life = o.life ?? 2
      for (let k = 0; k < count; k++) {
        const z = 2 * Math.random() - 1
        const a = Math.random() * TAU
        const r = Math.sqrt(1 - z * z)
        spawn(x, y, r * Math.cos(a), r * Math.sin(a), speed * rand(0.93, 1.05), { ...o, life: life * rand(0.88, 1.08) })
      }
    }
    const flash = (x: number, y: number, R: number, pal: number, power: number) => {
      lights.push({ x, y, age: 0, R, pal, power })
      const r = Math.max(1, R * 0.07)
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r * aspect; dx <= r * aspect; dx++) {
          const d2 = (dx / aspect) ** 2 + dy * dy
          if (d2 <= r * r) addF(x + dx, y + dy, 0.4 + 1.2 * (1 - d2 / (r * r)), SILVER, HEAD)
        }
      }
    }
    const smoke = (x: number, y: number, R: number) => {
      const count = Math.round(5 + (R / K) * 18)
      for (let k = 0; k < count; k++) {
        if (puffs.length >= MAX_PUFFS) puffs.shift()
        const a = Math.random() * TAU, d = Math.random() * R * 0.7
        puffs.push({ x: x + Math.cos(a) * d * aspect, y: y + Math.sin(a) * d, r: R * rand(0.2, 0.35), age: 0, life: rand(7, 11), d: rand(0.4, 0.7) })
      }
    }

    const burst = (s: Shell) => {
      const { x, y, R, pal, pal2 } = s
      const v = R * DRAG // with drag DRAG the stars coast to ~R rows
      const scale = Math.min(1.4, Math.max(0.5, R / (0.22 * K)))
      const fill = Math.min(1.5, Math.max(0.3, scale ** 1.5)) // star count grows with burst area
      const num = (base: number) => Math.round(base * fill)
      const change = pal2 >= 0 ? rand(0.7, 1.1) : 99
      const gold = s.kind === 'willow' || s.kind === 'kamuro' || s.kind === 'palm' || s.kind === 'crackle'
      flash(x, y, R, gold ? GOLD : pal, 0.5 + scale * 0.6)
      smoke(x, y, R)
      switch (s.kind) {
        case 'peony':
          sphere(x, y, num(110), v, { pal, pal2, change, life: 1.8 })
          break
        case 'chrysanthemum':
          sphere(x, y, num(110), v, { pal, pal2, change, life: 1.9, trail: 1 })
          if (Math.random() < 0.45) sphere(x, y, num(45), v * 0.42, { pal: otherColor(pal), life: 1.5 }) // pistil
          break
        case 'willow':
          sphere(x, y, num(80), v * 0.9, { pal: GOLD, bright: 0.55, drag: 2.6, grav: 0.2 * K, life: 3.6, trail: 2, trailPal: GOLD })
          break
        case 'kamuro':
          sphere(x, y, num(130), v, {
            pal: GOLD, bright: 0.75, drag: 2.8, grav: 0.18 * K, life: 3.2, trail: 2, trailPal: GOLD,
            end: Math.random() < 0.5 ? POP : 0,
          })
          break
        case 'brocade': // glittering gold that ends in colored tips (brocade crown)
          sphere(x, y, num(90), v * 1.1, {
            pal: GOLD, pal2: pal, change: rand(1.3, 1.6), bright: 0.95, drag: 3, life: 2.4, trail: 3, trailPal: GOLD,
          })
          break
        case 'palm': {
          const count = Math.round(rand(7, 11))
          const rot = Math.random() * TAU
          for (let k = 0; k < count; k++) {
            const a = rot + (k / count) * TAU + rand(-0.15, 0.15)
            spawn(x, y, Math.cos(a), Math.sin(a), v * 1.15, {
              pal: GOLD, bright: 1.2, drag: 2.4, grav: 0.26 * K, life: rand(2.3, 2.8), trail: 2, trailPal: GOLD,
            })
          }
          sphere(x, y, num(30), v * 0.35, { pal, life: 1.3 })
          break
        }
        case 'crossette':
          sphere(x, y, num(16), v * 0.75, { pal, life: 2, fuse: rand(0.45, 0.6), end: SPLIT, sub: v * 0.4, trail: 1 })
          break
        case 'ring': { // a tilted ring projects to an ellipse
          const count = num(64), rot = Math.random() * TAU, squash = rand(0.35, 1)
          for (let k = 0; k < count; k++) {
            const a = (k / count) * TAU
            const ex = Math.cos(a), ey = Math.sin(a) * squash
            spawn(x, y, ex * Math.cos(rot) - ey * Math.sin(rot), ex * Math.sin(rot) + ey * Math.cos(rot), v * rand(0.98, 1.02), { pal, life: rand(1.7, 1.9) })
          }
          if (Math.random() < 0.5) sphere(x, y, num(40), v * 0.35, { pal: pal2 >= 0 ? pal2 : otherColor(pal), life: 1.5 })
          break
        }
        case 'strobe':
          sphere(x, y, num(90), v * 0.85, { pal: SILVER, strobe: true, drag: 2.6, grav: 0.12 * K, life: 2.8 })
          break
        case 'crackle':
          sphere(x, y, num(80), v * 0.8, { pal: GOLD, bright: 0.8, life: 1.2, trail: 1, end: POP })
          break
        case 'senrin': // "thousand rings": small shells that each pop into a glittering ball
          sphere(x, y, Math.round(rand(10, 16)), v * 0.7, {
            pal, bright: 0.3, life: rand(0.8, 1.1), trail: 1, end: MINI, sub: K * 0.06 * DRAG,
          })
          break
      }
    }

    const launch = (kind: Kind, R: number, o: { x?: number; apex?: number; wait?: number; pal?: number; pal2?: number } = {}) => {
      const lo = Math.max(R * 0.85, rows * 0.1)
      const margin = Math.min(cols * 0.45, Math.max(cols * 0.1, R * aspect))
      const hi = Math.min(rows * 0.6, rows - 13 - R)
      const apex = o.apex ?? (hi > lo ? rand(lo, hi) : lo)
      const g = rows * 0.55
      const pal = o.pal ?? pick(COLORFUL)
      shells.push({
        x: o.x ?? rand(margin, cols - margin),
        y: rows + 1,
        vx: rand(-0.3, 0.3) * aspect,
        vy: -Math.sqrt(2 * g * (rows + 1 - apex)),
        kind, R, pal,
        pal2: o.pal2 ?? (Math.random() < 0.4 ? otherColor(pal) : -1),
        wait: o.wait ?? 0,
      })
    }
    const size = () => (Math.random() < 0.12 ? K * rand(0.34, 0.4) : K * rand(0.14, 0.29))

    // A "front": matching shells across the sky, together or as a sweep.
    const salvo = () => {
      const kind = pick(FRONT)
      const count = cols >= 120 ? 5 : 3
      const R = K * rand(0.11, 0.16)
      const apex = rows * rand(0.2, 0.32)
      const pal = pick(COLORFUL)
      const pal2 = Math.random() < 0.5 ? otherColor(pal) : -1
      const sweep = Math.random() < 0.5
      const vee = Math.random() < 0.5
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1)
        launch(kind, R, {
          x: cols * (0.15 + 0.7 * t),
          apex: apex + (vee ? Math.abs(t - 0.5) * -rows * 0.15 : 0),
          wait: sweep ? i * 0.15 : 0,
          pal, pal2,
        })
      }
    }

    const schedule = (dt: number) => {
      actLeft -= dt
      if (actLeft <= 0) {
        act = (act + 1) % ACTS.length
        actLeft = ACTS[act][1]
        wait = 0
      }
      wait -= dt
      if (wait > 0) return
      const mode = ACTS[act][0]
      if (mode === 'calm') {
        launch(pickWeighted(CALM), size())
        if (Math.random() < 0.25) launch(pickWeighted(CALM), size())
        wait = rand(1.2, 2.6)
      } else if (mode === 'salvo') {
        salvo()
        wait = rand(1.5, 2.2)
      } else if (mode === 'finale' && actLeft > 2) {
        launch(pick(FINALE), K * rand(0.1, 0.24))
        if (Math.random() < 0.5) launch(pick(FINALE), K * rand(0.1, 0.24))
        wait = rand(0.12, 0.28)
      } else if (mode === 'finale') {
        // Closing curtain: a wall of gold kamuro.
        const count = cols >= 120 ? 5 : 3
        for (let i = 0; i < count; i++) launch('kamuro', K * rand(0.2, 0.26), { x: cols * (0.15 + (0.7 * i) / (count - 1)), wait: rand(0, 0.2) })
        wait = 99
      } else {
        wait = 99
      }
    }

    const lightOf = (l: Light) => l.power * (1.5 * Math.exp(-l.age / 0.12) + 0.45 * Math.exp(-l.age / 1.1))

    let raf = 0
    let last = performance.now()

    const frame = (now: number) => {
      const dt = Math.min(50, now - last) / 1000
      last = now
      clock += dt
      schedule(dt)

      // Fade the light fields (exponential, so it is frame-rate independent).
      const fF = Math.exp(-dt / 0.07)
      trailDecay[1] = Math.exp(-dt / 0.3)
      trailDecay[2] = Math.exp(-dt / 1.3)
      trailDecay[3] = Math.exp(-dt / 0.5)
      for (let i = 0; i < n; i++) {
        F[i] *= fF
        T[i] *= trailDecay[TC[i]]
      }
      // Willow/kamuro trails slowly drip downward, bottom row first.
      for (let i = n - cols - 1; i >= 0; i--) {
        if (TC[i] !== 2 || T[i] < 0.08 || Math.random() > dt * 1.2) continue
        const j = i + cols
        if (T[j] < T[i] * 0.8) { T[j] = T[i] * 0.8; TP[j] = TP[i]; TC[j] = 2; TD[j] = 2 }
        T[i] *= 0.7
      }

      // Shells rise with a faint spark tail and burst near the apex.
      const g = rows * 0.55
      for (let k = shells.length - 1; k >= 0; k--) {
        const s = shells[k]
        if (s.wait > 0) { s.wait -= dt; continue }
        const px = s.x, py = s.y
        s.vy += g * dt
        s.x += s.vx * dt
        s.y += s.vy * dt
        // Most shells leave a short, faint tail; a palm rises on a heavy gold comet trunk.
        if (s.kind === 'palm') addT(px + rand(-0.3, 0.3), py + rand(0, 0.6), 0.9, GOLD, 1, 2)
        else if (Math.random() < 0.35) addT(px + rand(-0.6, 0.6), py + rand(0, 1), 0.3, EMBER, 1, 2)
        for (let y = py; y > s.y; y--) addF(s.x, y, 0.35, GOLD, 2)
        addF(s.x, s.y, 0.7, GOLD, HEAD)
        if (s.vy >= -0.5) {
          burst(s)
          shells[k] = shells[shells.length - 1]
          shells.pop()
        }
      }

      for (let k = stars.length - 1; k >= 0; k--) {
        const s = stars[k]
        if (s.delay > 0) { s.delay -= dt; continue }
        s.age += dt
        let dead = s.y > rows + 2 || s.x < -20 || s.x > cols + 20
        if (s.end === SPLIT && s.age >= s.fuse) {
          const rot = Math.random() * TAU
          for (let q = 0; q < 4; q++) {
            const a = rot + (q * TAU) / 4
            spawn(s.x, s.y, Math.cos(a), Math.sin(a), s.sub, { pal: s.pal, life: rand(0.9, 1.2), trail: 1 })
          }
          addF(s.x, s.y, 1.3, SILVER, HEAD)
          dead = true
        } else if (s.age >= s.life) {
          if (s.end === POP) {
            for (let q = 0; q < 2; q++) {
              spawn(s.x + rand(-1.2, 1.2) * aspect, s.y + rand(-1.2, 1.2), 0, 0, 0, {
                pal: SILVER, bright: 1.3, life: 0.07, drag: 0, grav: 0, delay: rand(0, 0.3),
              })
            }
          } else if (s.end === MINI) {
            lights.push({ x: s.x, y: s.y, age: 0, R: K * 0.06, pal: s.pal, power: 0.25 })
            sphere(s.x, s.y, 14, s.sub, { pal: Math.random() < 0.5 ? s.pal : SILVER, life: 0.8, grav: 0.2 * K, end: Math.random() < 0.4 ? POP : 0 })
          }
          dead = true
        }
        if (dead) {
          stars[k] = stars[stars.length - 1]
          stars.pop()
          continue
        }

        const px = s.x, py = s.y
        const f = Math.exp(-s.drag * dt)
        s.vx *= f
        s.vy = s.vy * f + s.grav * dt
        s.x += s.vx * dt
        s.y += s.vy * dt

        // Full brightness, then fade and sputter as the star burns out.
        const left = 1 - s.age / s.life
        let b = s.bright * (left < 0.3 ? left / 0.3 : 1)
        if (left < 0.4 && Math.random() < 0.15) b *= 0.4
        if (s.strobe && (s.age * 9 + s.phase) % 1 > 0.4) b = 0
        const pal = s.age >= s.change ? s.pal2 : s.pal
        const dir = dirOf(s.vx, s.vy)
        // Spark tails thin out as a star slows and burns down; willow trails keep hanging.
        const shed = s.trail === 2 ? 1 : Math.min(1, Math.hypot(s.vx / aspect, s.vy) / (0.3 * K)) * (b > 0 ? 1 : 0.5)
        const steps = Math.min(12, Math.ceil(Math.max(Math.abs(s.x - px), Math.abs(s.y - py))))
        for (let q = 1; q <= steps; q++) {
          const t = q / steps
          const x = px + (s.x - px) * t, y = py + (s.y - py) * t
          if (b > 0) addF(x, y, b * 0.55, pal, dir)
          if (s.trail && Math.random() < 0.7 * shed) {
            addT(x + rand(-0.3, 0.3), y + rand(0, 0.3), (s.trail === 2 ? 1 : 0.9) * rand(0.6, 1), s.trailPal, s.trail, dir)
          }
        }
        if (b > 0) addF(s.x, s.y, b, pal, HEAD)
      }

      for (let k = lights.length - 1; k >= 0; k--) {
        if ((lights[k].age += dt) > 4) { lights[k] = lights[lights.length - 1]; lights.pop() }
      }

      // Smoke drifts with a slowly changing wind and spreads out.
      const wind = 0.6 + 0.5 * Math.sin(clock * 0.07)
      drift += wind * dt
      H.fill(0)
      for (let k = puffs.length - 1; k >= 0; k--) {
        const p = puffs[k]
        p.age += dt
        if (p.age > p.life) { puffs[k] = puffs[puffs.length - 1]; puffs.pop(); continue }
        p.x += wind * dt
        p.y -= 0.25 * dt
        p.r += 0.3 * dt
        const d = p.d * Math.min(1, p.age / 0.6) * (1 - p.age / p.life)
        const rx = p.r * aspect
        const r0 = Math.max(0, Math.ceil(p.y - p.r)), r1 = Math.min(rows - 1, Math.floor(p.y + p.r))
        const c0 = Math.max(0, Math.ceil(p.x - rx)), c1 = Math.min(cols - 1, Math.floor(p.x + rx))
        for (let r = r0; r <= r1; r++) {
          const dy = (r - p.y) / p.r
          for (let c = c0; c <= c1; c++) {
            const dx = (c - p.x) / rx
            const q = 1 - dx * dx - dy * dy
            if (q > 0) H[r * cols + c] += d * q
          }
        }
      }

      // Pick a glyph and color for every cell.
      cellC.fill(-1)
      let glowN = 0
      const glow = (i: number, pal: number, L: number) => {
        glowI[glowN] = i; glowP[glowN] = pal; glowL[glowN] = L; glowN++
      }
      for (let i = 0; i < n; i++) {
        const f = F[i], t = T[i]
        if (f > 0.05 && f >= t) {
          const L = Math.min(9, (f * 7.5) | 0)
          const d = FD[i]
          cellCh[i] = d === HEAD || L < 2 ? HEAD_CH[L] : DIR[d]
          cellC[i] = FP[i] * 10 + L
          cellL[i] = L
          if (L >= 6) glow(i, FP[i], L)
        } else if (t > 0.12) {
          const L = Math.min(7, (t * 8) | 0)
          const cls = TC[i]
          if (cls === 3) { // glitter twinkles: each cell shows on some frames only
            const r = Math.random()
            if (r < 0.75 - L * 0.06) continue
            const hot = r > 0.85
            cellCh[i] = hot ? '*' : L > 4 ? '+' : '.'
            cellC[i] = hot ? SILVER * 10 + 9 : TP[i] * 10 + L
            cellL[i] = hot ? 9 : L
            if (hot) glow(i, TP[i], 7)
          } else if (cls === 2) { // long hanging trail: follows the star's path, sparse dots as it cools
            cellCh[i] = L >= 5 ? DIR[TD[i]] : L >= 3 ? ':' : '.'
            cellC[i] = TP[i] * 10 + L
            cellL[i] = L
            if (L >= 7) glow(i, TP[i], L - 1)
          } else {
            cellCh[i] = L >= 3 ? DIR[TD[i]] : '.'
            cellC[i] = TP[i] * 10 + L
            cellL[i] = L
            if (L >= 7) glow(i, TP[i], L - 1)
          }
        } else if (H[i] > 0.03) {
          // Smoke is barely visible until a nearby burst lights it up.
          const x = i % cols, y = (i / cols) | 0
          let illum = 0.04
          for (const l of lights) {
            const dx = (x - l.x) / aspect, dy = y - l.y
            const R2 = l.R * l.R * 2.5
            illum += lightOf(l) * (R2 / (R2 + dx * dx + dy * dy))
          }
          const L = Math.min(9, (H[i] * illum * NOISE[((y & 63) << 6) | ((x - drift) & 63)] * 9) | 0)
          if (L < 2) continue
          cellCh[i] = SMOKE_CH[L]
          cellC[i] = SMOKE_C + L
          cellL[i] = 0
        }
      }

      // "2027" lit by recent bursts (inverse-square falloff, fading with age).
      const R2 = (0.5 * K) ** 2
      for (const i of text) {
        const x = i % cols
        const y = Math.floor(i / cols)
        let light = 0.1
        for (const l of lights) {
          const dx = (x - l.x) / aspect
          const dy = y - l.y
          light += lightOf(l) * 0.6 * (R2 / (R2 + dx * dx + dy * dy))
        }
        const L = Math.max(2, Math.min(9, Math.round(2 + light * 7)))
        if (cellC[i] >= 0 && cellL[i] > L) continue
        cellCh[i] = L >= 8 ? '@' : '#'
        cellC[i] = TEXT_C + L
        if (L >= 8) glow(i, GOLD, L - 2)
      }

      // Draw: background, sky glow from bursts, bloom halos, then the glyphs.
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      for (const l of lights) {
        const cx = ox + l.x * cw, cy = oy + l.y * chH
        const sky = l.R * chH * 3.5
        ctx.globalAlpha = Math.min(0.5, l.power * (0.25 * Math.exp(-l.age / 0.25) + 0.04 * Math.exp(-l.age / 1.1)))
        ctx.drawImage(sprites[l.pal], cx - sky / 2, cy - sky / 2, sky, sky)
        const fl = l.R * chH * 1.4
        ctx.globalAlpha = Math.min(1, l.power * Math.exp(-l.age / 0.09))
        if (ctx.globalAlpha > 0.02) ctx.drawImage(flashSprite, cx - fl / 2, cy - fl / 2, fl, fl)
      }
      const gs = cw * 4.5
      for (let k = 0; k < glowN; k++) {
        const i = glowI[k]
        ctx.globalAlpha = (glowL[k] - 4) * 0.055
        ctx.drawImage(sprites[glowP[k]], ox + (i % cols) * cw + cw / 2 - gs / 2, oy + ((i / cols) | 0) * chH + chH / 2 - gs / 2, gs, gs)
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1

      // Bucket cells by color so fillStyle changes at most once per color.
      counts.fill(0)
      for (let i = 0; i < n; i++) if (cellC[i] >= 0) counts[cellC[i]]++
      let sum = 0
      for (let c = 0; c < NCOLORS; c++) { starts[c] = sum; sum += counts[c] }
      for (let i = 0; i < n; i++) if (cellC[i] >= 0) order[starts[cellC[i]]++] = i
      let k = 0
      for (let c = 0; c < NCOLORS; c++) {
        if (!counts[c]) continue
        ctx.fillStyle = COLORS[c]
        for (const end = k + counts[c]; k < end; k++) {
          const i = order[k]
          ctx.fillText(cellCh[i], ox + (i % cols) * cw, oy + ((i / cols) | 0) * chH)
        }
      }

      raf = requestAnimationFrame(frame)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-label="ASCII салют" role="img" />
}
