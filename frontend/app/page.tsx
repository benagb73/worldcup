'use client'

import { useGroups, useMatches } from '@/lib/hooks'
import { GroupTable } from '@/components/GroupTable'
import { MatchCard } from '@/components/MatchCard'
import { GroupStandings, MatchSummary } from '@/lib/types'

export default function HomePage() {
  const { data: groups, isLoading: loadingGroups } = useGroups()
  const { data: matches, isLoading: loadingMatches } = useMatches({ stage: 'group' })

  if (loadingGroups || loadingMatches) return <PageSkeleton />

  // Group matches by group name
  const matchesByGroup: Record<string, MatchSummary[]> = {}
  for (const m of matches ?? []) {
    const g = m.group_name ?? 'Unknown'
    matchesByGroup[g] = [...(matchesByGroup[g] ?? []), m]
  }

  return (
    <div>
      {/* Hero */}
      <div className="mb-12 text-center">
        <p className="text-xs tracking-[0.4em] text-gold/60 uppercase mb-3">FIFA</p>
        <h1 className="font-display text-5xl sm:text-7xl font-black text-cream leading-none">
          World Cup
        </h1>
        <p className="mt-2 font-display text-4xl sm:text-6xl font-black text-gold leading-none">
          2026
        </p>
        <p className="mt-4 text-sm text-cream/30">
          USA · Canada · Mexico
        </p>
      </div>

      {/* Live matches banner */}
      <LiveMatchesBanner matches={matches ?? []} />

      {/* Groups */}
      <div className="space-y-12">
        {(groups ?? []).map((group: GroupStandings) => (
          <section key={group.group_name}>
            <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
              {/* Standings */}
              <div>
                <GroupTable group={group} />
              </div>

              {/* Matches */}
              <div className="space-y-3">
                <h3 className="text-xs tracking-widest text-cream/30 uppercase font-medium mb-4">
                  Fixtures
                </h3>
                {(matchesByGroup[group.group_name] ?? []).map((m: MatchSummary) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function LiveMatchesBanner({ matches }: { matches: MatchSummary[] }) {
  const live = matches.filter(m => m.status.startsWith('live'))
  if (!live.length) return null

  return (
    <div className="mb-10 rounded-2xl border border-gold/20 bg-gold/5 p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="h-2 w-2 rounded-full bg-gold animate-pulse" />
        <h2 className="text-sm font-semibold tracking-widest text-gold uppercase">
          Live Now
        </h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {live.map(m => <MatchCard key={m.id} match={m} />)}
      </div>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-12 animate-pulse">
      <div className="text-center space-y-3">
        <div className="mx-auto h-16 w-64 rounded bg-white/5" />
        <div className="mx-auto h-12 w-32 rounded bg-white/5" />
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <div className="h-40 rounded-xl bg-white/5" />
          <div className="space-y-3">
            {[1, 2, 3].map(j => (
              <div key={j} className="h-20 rounded-xl bg-white/5" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
