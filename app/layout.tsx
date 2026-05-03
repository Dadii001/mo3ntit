import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Indie Artist Finder",
  description: "Agentic platform for discovering and onboarding indie artists from TikTok.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-[var(--color-border)] px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-strong)]" />
            <span className="font-semibold tracking-tight">Indie Artist Finder</span>
          </Link>
          <nav className="flex gap-4 text-sm text-neutral-400">
            <Link href="/" className="hover:text-white">Agents</Link>
            <Link href="/agents/first-dm" className="hover:text-white">DM Agent</Link>
            <Link href="/board" className="hover:text-white">Board</Link>
            <Link href="/mo3ntitin" className="hover:text-white">Mo3ntitin</Link>
          </nav>
        </header>
        <main className="px-6 py-6 max-w-[1200px] mx-auto">{children}</main>
      </body>
    </html>
  );
}
