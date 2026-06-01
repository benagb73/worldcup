'use client'

import Link from 'next/link'
import clsx from 'clsx'
import { usePools, useScoringConfig } from '@/lib/hooks'
import { Pool, ScoringConfig } from '@/lib/types'

export default function CompeteIndexPage() {
  const { data: pools,   isLoading } = usePools()
  const { data: scoring }            = useScoringConfig()

  if (isLoading) return <Skeleton />

  const rows: Pool[] = pools ?? []
  const sc: ScoringConfig | undefined = scoring

  return (
    <div className="space-y-10">
      <Hero scoring={sc} />

      {rows.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-white/10 panel p-10 text-center">
          <div className="text-3xl mb-3">🏆</div>
          <h2 className="font-display text-2xl tracking-wide text-cream">No pools yet</h2>
          <p className="mt-2 text-sm text-cream/50">Create the first one.</p>
          <Link
            href="/pool/new"
            className="mt-6 inline-block rounded-xl bg-gold-gradient px-5 py-2.5 font-display tracking-wider text-ink shadow-gold transition-transform hover:scale-105"
          >
            CREATE A POOL →
          </Link>
        </section>
      ) : (
        <section>
          <div className="mb-5 flex items-end justify-between">
            <SectionHeading eyebrow="POOLS" title="Pick your pool" />
            <Link
              href="/pool/new"
              className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold tracking-widest text-amber-400 hover:bg-amber-500/20"
            >
              + NEW POOL
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map(p => <PoolCard key={p.id} pool={p} />)}
          </div>
        </section>
      )}
    </div>
  )
}

function Hero({ scoring }: { scoring?: ScoringConfig }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 panel">
      <div className="absolute inset-0 opacity-60">
        <div className="absolute -top-32 left-1/4 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />
      </div>
      <div className="relative px-6 py-10 sm:px-10 sm:py-12">
        <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">PREDICTION GAME</div>
        <h1 className="mt-1 font-display text-5xl tracking-tight text-cream sm:text-6xl">
          PICK&rsquo;EM <span className="text-gold-gradient">POOLS</span>
        </h1>
        <p className="mt-3 max-w-xl text-sm text-cream/50">
          Each pool is a private leaderboard. Pick scores and first-scorers for every match; play
          your jokers wisely. One competitor can join multiple pools — your picks count everywhere
          you&rsquo;re a member.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/pool/new"
            className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-bold tracking-widest text-ink shadow-gold transition-transform hover:scale-105"
          >
            CREATE A POOL →
          </Link>
          <Link
            href="/compete/rules"
            className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-bold tracking-widest text-cream/60 hover:text-cream hover:border-white/20"
          >
            RULES & SCORING
          </Link>
        </div>
        {scoring && (
          <div className="mt-4 text-[10px] tracking-widest text-cream/30">
            +{scoring.result_points} RESULT · +{scoring.both_scores_points} EXACT SCORE ·
            +{scoring.one_score_points} ONE TEAM · +{scoring.first_scorer_points} 1ST SCORER ·
            JOKER ×{scoring.joker_multiplier}
          </div>
        )}
      </div>
    </section>
  )
}

function PoolCard({ pool }: { pool: Pool }) {
  return (
    <Link
      href={`/pool/${pool.slug}`}
      className="group block rounded-2xl border border-white/10 panel p-5 hover-lift hover:border-amber-400/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold tracking-widest text-amber-400">/pool/{pool.slug}</div>
          <h3 className="mt-1 font-display text-2xl tracking-wide text-cream truncate">
            {pool.name.toUpperCase()}
          </h3>
          <div className="mt-2 text-xs text-cream/40">
            {pool.member_count} {pool.member_count === 1 ? 'member' : 'members'}
          </div>
        </div>
        <span className="shrink-0 text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
      </div>
    </Link>
  )
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">{eyebrow}</div>
      <h2 className="font-display text-2xl tracking-wide text-cream sm:text-3xl">{title}</h2>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-8">
      <div className="h-56 rounded-3xl shimmer" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-32 rounded-2xl shimmer" />
        <div className="h-32 rounded-2xl shimmer" />
      </div>
    </div>
  )
}
