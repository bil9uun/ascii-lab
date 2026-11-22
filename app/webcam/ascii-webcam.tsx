'use client'

import { useEffect, useRef, useState } from 'react'

// Brightness ramp: index 0 = empty, 9 = densest glyph.
const RAMP = ' .:-=+*#%@'
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const BG = '#05070d'

// Green phosphor: one shade per ramp level.
const GREEN = Array.from({ length: RAMP.length }, (_, i) => `hsl(135 90% ${10 + i * 6}%)`)
// True color quantized to 3 bits per channel = 512 fillStyles max.
const RGB = Array.from({ length: 512 }, (_, q) => {
  const ch = (v: number) => (v << 5) + 16
  return `rgb(${ch(q >> 6)} ${ch((q >> 3) & 7)} ${ch(q & 7)})`
})

type Status = 'idle' | 'loading' | 'on' | 'denied' | 'unavailable'

export default function AsciiWebcam() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const aliveRef = useRef(true)
  const [status, setStatus] = useState<Status>('idle')
  const [color, setColor] = useState(false)

  // Stop the camera on unmount.
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const start = async () => {
    const video = videoRef.current
    if (!video) return
    if (!navigator.mediaDevices?.getUserMedia) return setStatus('unavailable')
    setStatus('loading')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      if (!aliveRef.current) return stream.getTracks().forEach((t) => t.stop())
      streamRef.current = stream
      video.srcObject = stream
      await video.play()
      setStatus('on')
    } catch (e) {
      setStatus(e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'unavailable')
    }
  }

  useEffect(() => {
    if (status !== 'on') return
    const canvas = canvasRef.current
    const video = videoRef.current
    const ctx = canvas?.getContext('2d')
    const off = document.createElement('canvas')
    const octx = off.getContext('2d', { willReadFrequently: true })
    if (!canvas || !video || !ctx || !octx) return

    const pal = color ? RGB : GREEN
    const buckets: number[][] = pal.map(() => [])
    let w = 0, h = 0, cw = 0, chH = 0, cols = 0, rows = 0, ox = 0, oy = 0

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const fs = Math.max(6, Math.min(14, Math.round(Math.min(w, h) / 80)))
      ctx.font = `${fs}px ${FONT}`
      ctx.textBaseline = 'top'
      cw = ctx.measureText('M').width
      chH = Math.round(fs * 1.2)
      cols = Math.floor(w / cw)
      rows = Math.floor(h / chH)
      ox = (w - cols * cw) / 2
      oy = (h - rows * chH) / 2
      off.width = cols
      off.height = rows
    }

    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (!vw || !vh || !cols || !rows) return

      // Cover-crop the video to the grid's on-screen aspect (cells are taller than wide),
      // then squash it into one pixel per cell.
      const gridAspect = (cols * cw) / (rows * chH)
      let sw = vw, sh = vh
      if (vw / vh > gridAspect) sw = vh * gridAspect
      else sh = vw / gridAspect
      octx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, cols, rows)
      const px = octx.getImageData(0, 0, cols, rows).data

      for (const b of buckets) b.length = 0
      const chars: string[] = new Array(cols * rows)
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const p = (r * cols + (cols - 1 - c)) * 4 // mirror horizontally
          const R = px[p], G = px[p + 1], B = px[p + 2]
          const lvl = Math.round(((0.2126 * R + 0.7152 * G + 0.0722 * B) / 255) * (RAMP.length - 1))
          if (!lvl) continue
          const i = r * cols + c
          chars[i] = RAMP[lvl]
          buckets[color ? ((R >> 5) << 6) | ((G >> 5) << 3) | (B >> 5) : lvl].push(i)
        }
      }

      ctx.fillStyle = BG
      ctx.fillRect(0, 0, w, h)
      for (let k = 0; k < buckets.length; k++) {
        if (!buckets[k].length) continue
        ctx.fillStyle = pal[k]
        for (const i of buckets[k]) ctx.fillText(chars[i], ox + (i % cols) * cw, oy + Math.floor(i / cols) * chH)
      }
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [status, color])

  const message =
    status === 'denied'
      ? 'Камерын зөвшөөрөл олгогдсонгүй.'
      : status === 'unavailable'
        ? 'Камер олдсонгүй эсвэл ашиглах боломжгүй байна.'
        : null

  return (
    <>
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="ASCII камер" role="img" />
      {status === 'on' ? (
        <button
          type="button"
          onClick={() => setColor((v) => !v)}
          aria-pressed={color}
          className={`absolute right-4 top-4 font-mono text-xs hover:text-zinc-200 ${color ? 'text-zinc-200' : 'text-zinc-500'}`}
        >
          өнгөт
        </button>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 font-mono text-sm">
          <button
            type="button"
            onClick={start}
            disabled={status === 'loading'}
            className="border border-green-700 px-4 py-2 text-green-400 hover:bg-green-950 disabled:opacity-50"
          >
            Камер асаах
          </button>
          {message && <p className="text-zinc-400">{message}</p>}
        </div>
      )}
    </>
  )
}
