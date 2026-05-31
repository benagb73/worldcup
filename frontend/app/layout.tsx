import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'FIFA World Cup 2026 — Live Scores, Groups & Stats',
  description: 'Live scores, group standings, lineups and player stats from the 2026 FIFA World Cup. Hosted by USA, Canada and Mexico.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main className="relative mx-auto max-w-7xl px-4 py-8 sm:py-10">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  )
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-ink/75 backdrop-blur-xl">
      {/* Host nation flag strip */}
      <div className="h-[3px] w-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600" />

      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-4 sm:py-3.5">
        <Link href="/" className="group flex items-center gap-2 sm:gap-3">
          <TrophyMark />
          {/* On the smallest viewport we hide the "WORLD CUP / 2026 + flags"
              block entirely so all four nav links have room. The trophy mark
              alone still doubles as the home link. */}
          <div className="hidden leading-none sm:block">
            <div className="font-display text-2xl tracking-wide text-cream group-hover:text-gold transition-colors">
              WORLD CUP
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-[0.35em] text-amber-400">2026</span>
              <HostFlagStrip />
            </div>
          </div>
        </Link>

        <div className="flex items-center gap-0.5 sm:gap-1">
          <NavLink href="/">Groups</NavLink>
          <NavLink href="/bracket">Bracket</NavLink>
          <NavLink href="/leaderboard">Stats</NavLink>
          <NavLink href="/compete">Pool</NavLink>
          <span className="hidden sm:flex items-center gap-1.5 ml-3 rounded-full border border-white/10 px-2.5 py-1">
            <span className="live-dot" />
            <span className="text-[10px] font-bold tracking-widest text-cream/70">LIVE</span>
          </span>
        </div>
      </nav>
    </header>
  )
}

function TrophyMark() {
  return (
    <div className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-gold-gradient shadow-gold">
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink" fill="currentColor" aria-hidden>
        <path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.18A5 5 0 0 1 13 14.9V17h2a2 2 0 0 1 2 2v2H7v-2a2 2 0 0 1 2-2h2v-2.1A5 5 0 0 1 7.18 12H7a4 4 0 0 1-4-4V5h3V3h1Zm10 4v3a2 2 0 0 0 2-2V7h-2ZM5 7v1a2 2 0 0 0 2 2V7H5Z"/>
      </svg>
      <span className="absolute -inset-0.5 -z-10 rounded-lg bg-amber-500/40 blur-md" />
    </div>
  )
}

function HostFlagStrip() {
  return (
    <span className="flex items-center gap-0.5" aria-label="Hosted by USA, Canada and Mexico">
      <span className="h-2 w-3 rounded-sm bg-gradient-to-r from-blue-700 via-white to-red-600" title="USA" />
      <span className="h-2 w-3 rounded-sm bg-gradient-to-r from-red-600 via-white to-red-600" title="Canada" />
      <span className="h-2 w-3 rounded-sm bg-gradient-to-r from-green-600 via-white to-red-600" title="Mexico" />
    </span>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="relative rounded-md px-2 py-2 text-xs font-semibold tracking-wide text-cream/70 transition-colors hover:text-gold hover:bg-white/5 sm:px-3 sm:text-sm"
    >
      {children}
    </Link>
  )
}

function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-white/5">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-8 sm:flex-row">
        <div className="flex items-center gap-3 text-xs text-cream/40">
          <HostFlagStrip />
          <span>USA · Canada · Mexico</span>
        </div>
        <p className="text-xs text-cream/30">
          Data via API-Football · Updated every 60s
        </p>
      </div>
    </footer>
  )
}
