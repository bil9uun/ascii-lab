import Link from 'next/link'

// Add each new ASCII experiment here.
const experiments = [
  { href: '/tree', title: 'Шинэ жилийн мод', note: 'Эргэлддэг 3D гацуур, гэрэл, бэлэг, цас' },
  { href: '/fireworks', title: 'Шинэ жилийн салют', note: 'Пуужин, дэлбэрэлт, гэрэлтэх 2027' },
  { href: '/fire', title: 'ASCII гал', note: 'Дэгдэх гал, хулгана/хуруугаар дулаан нэмнэ' },
  { href: '/webcam', title: 'ASCII камер', note: 'Webcam дүрсийг ASCII болгоно, өнгөт/ногоон горим' },
]

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 bg-[#05070d] p-8 font-mono text-zinc-300">
      <h1 className="text-sm tracking-[0.3em] text-zinc-500">ASCII LAB</h1>
      <ul className="w-full max-w-md space-y-2">
        {experiments.map((e) => (
          <li key={e.href}>
            <Link
              href={e.href}
              className="block border border-zinc-800 px-4 py-3 transition-colors hover:border-zinc-500"
            >
              <div className="text-zinc-100">{e.title}</div>
              <div className="text-xs text-zinc-500">{e.note}</div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
