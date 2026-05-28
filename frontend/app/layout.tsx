import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'FIFA World Cup 2026',
  description: 'Live scores, group standings, lineups & stats',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-50 border-b border-white/5 bg-carbon/80 backdrop-blur-md">
          <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-3 group">
              <span className="text-2xl">🏆</span>
              <div>
                <div className="font-display text-xl font-black text-gold leading-none">
                  WORLD CUP
                </div>
                <div className="text-[10px] font-medium tracking-[0.3em] text-cream/40 uppercase">
                  2026
                </div>
              </div>
            </Link>

            <div className="flex items-center gap-1">
              <NavLink href="/">Groups</NavLink>
              <NavLink href="/bracket">Bracket</NavLink>
            </div>
          </nav>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-8">
          {children}
        </main>

        <footer className="mt-16 border-t border-white/5 py-8 text-center">
          <p className="text-sm text-cream/20 font-body">
            Data via API-Football · Updated live every 60s
          </p>
        </footer>
      </body>
    </html>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-4 py-2 text-sm font-medium text-cream/60 hover:text-gold
                 transition-colors rounded-md hover:bg-white/5"
    >
      {children}
    </Link>
  )
}
