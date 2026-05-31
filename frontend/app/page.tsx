'use client'

import { useGroups, useMatches } from '@/lib/hooks'
import { GroupTable } from '@/components/GroupTable'
import { MatchCard } from '@/components/MatchCard'
import { GroupStandings, MatchSummary } from '@/lib/types'

export default function HomePage() {
  const { data: groups,  isLoading: loadingGroups }  = useGroups()
  // Pull ALL matches (not just group stage) so we can build recent + upcoming sections
  const { data: matches, isLoading: loadingMatches } = useMatches()

  if (loadingGroups || loadingMatches) return <PageSkeleton />

  const allMatches: MatchSummary[] = matches ?? []

  // Bucket group-stage matches by group for the standings section
  const matchesByGroup: Record<string, MatchSummary[]> = {}
  for (const m of allMatches) {
    if (m.stage !== 'group') continue
    const g = m.group_name ?? m.home_team?.group_name ?? m.away_team?.group_name
    if (!g) continue
    matchesByGroup[g] = [...(matchesByGroup[g] ?? []), m]
  }
  for (const g of Object.keys(matchesByGroup)) {
    matchesByGroup[g].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  }

  const liveMatches = allMatches.filter(m => m.status.startsWith('live'))

  // Date windows in the viewer's local timezone
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = startOfDay(now)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const tomorrowEnd = new Date(today); tomorrowEnd.setDate(today.getDate() + 2)
  const dayAfterTomorrow = new Date(today); dayAfterTomorrow.setDate(today.getDate() + 2)

  // Recent: status=final between yesterday-start and today-end (so any match finished in those windows)
  const recent = allMatches
    .filter(m => m.status === 'final')
    .filter(m => {
      const d = new Date(m.scheduled_at)
      return d >= yesterday && d < dayAfterTomorrow
    })
    .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))

  // Upcoming: status != final && scheduled between today-start and tomorrow-end
  const upcoming = allMatches
    .filter(m => m.status !== 'final' && !m.status.startsWith('live'))
    .filter(m => {
      const d = new Date(m.scheduled_at)
      return d >= today && d < tomorrowEnd
    })
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))

  return (
    <div className="space-y-12 sm:space-y-16">
      <Hero />

      {liveMatches.length > 0 && <LiveSection matches={liveMatches} />}

      {/* Today & tomorrow */}
      {upcoming.length > 0 && (
        <section>
          <SectionHeading eyebrow="UP NEXT" title="Today & Tomorrow" />
          <div className="grid gap-4 sm:grid-cols-2">
            {upcoming.map(m => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {/* Recent results */}
      {recent.length > 0 && (
        <section>
          <SectionHeading eyebrow="RECENT" title="Latest Results" />
          <div className="grid gap-4 sm:grid-cols-2">
            {recent.map(m => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {/* Groups */}
      <div className="space-y-12">
        <SectionHeading
          eyebrow="GROUP STAGE"
          title="Standings & Fixtures"
          subtitle="Top two from each group advance to the knockout round"
        />

        <div className="grid gap-8 xl:grid-cols-2">
          {(groups ?? []).map((group: GroupStandings, i: number) => (
            <section
              key={group.group_name}
              className="animate-fade-up"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="grid gap-5">
                <GroupTable group={group} />
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                    <span className="font-display text-xs tracking-[0.3em] text-cream/40">FIXTURES</span>
                    <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                  </div>
                  {(matchesByGroup[group.group_name] ?? []).map((m: MatchSummary) => (
                    <MatchCard key={m.id} match={m} />
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hero — slimmed down, no marketing copy or stat tiles
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 panel">
      <div className="absolute inset-0 opacity-50">
        <div className="absolute -top-32 -left-32 h-80 w-80 rounded-full bg-amber-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-navy-500/30 blur-3xl" />
      </div>

      <div className="relative grid gap-6 px-6 py-10 sm:px-12 sm:py-14 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold tracking-[0.3em] text-amber-400">
              FIFA · 23rd EDITION
            </span>
          </div>

          <h1 className="font-display text-6xl leading-[0.85] tracking-tight sm:text-8xl">
            <span className="block text-cream">WORLD</span>
            <span className="block text-gold-gradient drop-shadow-[0_4px_24px_rgba(245,185,66,0.25)]">CUP 2026</span>
          </h1>

          <div className="flex flex-wrap items-center gap-3">
            <HostBadge code="USA" name="United States" stripes={['from-blue-700', 'via-white', 'to-red-600']} />
            <HostBadge code="CAN" name="Canada"        stripes={['from-red-600',  'via-white', 'to-red-600']} />
            <HostBadge code="MEX" name="Mexico"        stripes={['from-green-600','via-white', 'to-red-600']} />
          </div>
        </div>
      </div>

      <div className="relative border-t border-white/5 bg-black/30 px-6 py-3 sm:px-12">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-cream/50">
          <span className="flex items-center gap-2">
            <span className="font-display text-base text-amber-400 tracking-wider">JUN 11</span>
            <span className="text-cream/30">→</span>
            <span className="font-display text-base text-amber-400 tracking-wider">JUL 19, 2026</span>
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-cream/40">
            <span className="h-1 w-1 rounded-full bg-amber-400" />
            LIVE DATA · REFRESHED EVERY 60s
          </span>
        </div>
      </div>
    </section>
  )
}

function HostBadge({ code, name, stripes }: { code: string; name: string; stripes: string[] }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1.5 pl-1.5 pr-3 backdrop-blur">
      <span className={`h-5 w-7 rounded-sm bg-gradient-to-r ${stripes.join(' ')} ring-1 ring-black/40`} />
      <div className="flex items-center gap-1.5">
        <span className="font-display text-sm tracking-wider text-cream">{code}</span>
        <span className="hidden sm:inline text-[11px] text-cream/50">{name}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Live section
// ---------------------------------------------------------------------------

function LiveSection({ matches }: { matches: MatchSummary[] }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-live/30 bg-gradient-to-br from-live/10 via-amber-500/5 to-transparent p-6 sm:p-8 shadow-[0_8px_48px_-12px_rgba(239,68,68,0.35)]">
      <div className="absolute -top-20 -right-20 h-60 w-60 rounded-full bg-live/20 blur-3xl" />

      <div className="relative">
        <div className="mb-5 flex items-center gap-3">
          <span className="live-dot" />
          <h2 className="font-display text-2xl tracking-widest text-cream">LIVE NOW</h2>
          <span className="rounded-full bg-live/20 px-2 py-0.5 text-[10px] font-bold text-live">
            {matches.length} {matches.length === 1 ? 'MATCH' : 'MATCHES'}
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {matches.map(m => <MatchCard key={m.id} match={m} />)}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">{eyebrow}</div>
        <h2 className="font-display text-3xl tracking-wide text-cream sm:text-4xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-cream/40">{subtitle}</p>}
      </div>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-12">
      <div className="h-56 rounded-3xl shimmer" />
      <div className="grid gap-8 xl:grid-cols-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="space-y-5">
            <div className="h-72 rounded-2xl shimmer" />
            <div className="space-y-3">
              {[1, 2, 3].map(j => (
                <div key={j} className="h-24 rounded-2xl shimmer" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
