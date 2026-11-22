import type { Metadata } from 'next'
import Link from 'next/link'
import AsciiFire from './ascii-fire'

export const metadata: Metadata = {
  title: 'ASCII гал',
}

export default function FirePage() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#05070d]">
      <AsciiFire />
      <Link
        href="/"
        className="absolute left-4 top-4 font-mono text-xs text-zinc-500 hover:text-zinc-200"
      >
        ← ascii lab
      </Link>
    </main>
  )
}
