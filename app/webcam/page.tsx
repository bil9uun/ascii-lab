import type { Metadata } from "next";
import Link from "next/link";
import AsciiWebcam from "./ascii-webcam";

export const metadata: Metadata = {
  title: "ASCII камер",
};

export default function WebcamPage() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#05070d]">
      <AsciiWebcam />
      <Link
        href="/"
        className="absolute left-4 top-4 font-mono text-xs text-zinc-500 hover:text-zinc-200"
      >
        ← ascii lab
      </Link>
    </main>
  );
}
