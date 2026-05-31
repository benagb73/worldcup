'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { adminFetch, getSecret, AdminAuthError } from '@/lib/admin'
import { competeFetch } from '@/lib/compete'
import { ScoringConfig } from '@/lib/types'

const FIELDS: { key: keyof ScoringConfig; label: string; help: string }[] = [
  { key: 'result_points',         label: 'Result points',
    help: 'Awarded for correctly picking win / draw / loss.' },
  { key: 'both_scores_points',    label: 'Exact score points',
    help: 'Awarded when both teams’ goals are correctly predicted (replaces the single-team bonus).' },
  { key: 'one_score_points',      label: 'One team correct',
    help: 'Awarded for getting just one team’s goal count right.' },
  { key: 'first_scorer_points',   label: 'First scorer points',
    help: 'Awarded for picking the player who scored first (or "no goal" if 0-0).' },
  { key: 'joker_multiplier',      label: 'Joker multiplier',
    help: 'Total per-match points are multiplied by this when a joker is played.' },
  { key: 'pen_winner_bonus_goal', label: 'Pen-winner bonus goal',
    help: 'In knockout matches decided on penalties, the shootout winner gets this many virtual goals added to their effective score.' },
]

export default function AdminScoringPage() {
  const [ready, setReady]     = useState(false)
  const [config, setConfig]   = useState<ScoringConfig | null>(null)
  const [draft, setDraft]     = useState<Partial<ScoringConfig>>({})
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [flash, setFlash]     = useState<string | null>(null)

  useEffect(() => {
    if (!getSecret()) {
      window.location.href = '/admin'
      return
    }
    setReady(true)
    refresh()
  }, [])

  async function refresh() {
    try {
      const data = await competeFetch<ScoringConfig>('/scoring')
      setConfig(data)
      setDraft({})
    } catch (e) {
      setErr(String(e))
    }
  }

  async function save() {
    if (!config) return
    if (config.tournament_started) {
      const ok = confirm(
        'The tournament has already started! Changing scoring will retroactively re-score every finalised match. Are you sure?'
      )
      if (!ok) return
    }
    setBusy(true)
    setErr(null)
    try {
      await adminFetch('/scoring', {
        method: 'PUT',
        body: JSON.stringify(draft),
      })
      setFlash('Saved + re-scored ✓')
      setTimeout(() => setFlash(null), 2000)
      await refresh()
    } catch (e) {
      if (e instanceof AdminAuthError) { window.location.href = '/admin'; return }
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  function setField(key: keyof ScoringConfig, value: number) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  if (!ready || !config) return <div className="py-20"><div className="h-40 rounded-3xl shimmer" /></div>

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <Link
        href="/admin"
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream/60 hover:border-amber-400/30 hover:text-gold"
      >
        ← Admin home
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-white/10 panel p-8">
        <div className="absolute -top-20 -right-20 h-48 w-48 rounded-full bg-amber-500/20 blur-3xl" />
        <div className="relative">
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">CONFIG</div>
          <h1 className="mt-1 font-display text-3xl tracking-wide text-cream">SCORING RULES</h1>
          <p className="mt-2 text-sm text-cream/50">
            Tune how the family competition awards points. Changes apply immediately and every
            finalised match is re-scored.
          </p>

          {config.tournament_started && (
            <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-400">
              ⚠ Tournament has started. Changing values now will retroactively re-score past matches.
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        {FIELDS.map(f => {
          const current = (draft[f.key] ?? config[f.key]) as number
          const isDirty = draft[f.key] !== undefined && draft[f.key] !== config[f.key]
          return (
            <div
              key={f.key}
              className={clsx(
                'rounded-xl border p-4',
                isDirty ? 'border-amber-400/40 bg-amber-500/[0.04]' : 'border-white/10 bg-white/[0.02]'
              )}
            >
              <div className="grid grid-cols-[1fr_120px] items-center gap-4">
                <div>
                  <div className="text-sm font-bold text-cream">{f.label}</div>
                  <div className="mt-1 text-xs text-cream/50">{f.help}</div>
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setField(f.key, Math.max(0, current - 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-cream/60 hover:border-live/40 hover:text-live"
                  >−</button>
                  <input
                    type="number" min={0} max={99}
                    value={current}
                    onChange={e => setField(f.key, Math.max(0, Number(e.target.value || 0)))}
                    className="w-14 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-center font-display text-2xl tabular-nums text-cream focus:border-amber-400/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setField(f.key, current + 1)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-cream/60 hover:border-amber-400/50 hover:text-amber-400"
                  >+</button>
                </div>
              </div>
            </div>
          )
        })}
      </section>

      {err && <div className="text-xs text-live">{err}</div>}

      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] text-cream/40">{flash ?? 'Edit a field to enable Save.'}</span>
        <button
          onClick={save}
          disabled={busy || Object.keys(draft).length === 0}
          className="rounded-xl bg-gold-gradient px-5 py-2.5 font-display tracking-wider text-ink shadow-gold transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
        >
          {busy ? 'SAVING…' : 'SAVE'}
        </button>
      </div>
    </div>
  )
}
