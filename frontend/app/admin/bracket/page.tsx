'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { adminFetch, getSecret, AdminAuthError } from '@/lib/admin'
import { stageName } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types — match the backend /bracket-mapping response
// ---------------------------------------------------------------------------

interface BracketSlotRow {
  id: number
  stage: string
  slot: number
  home_seed_desc: string | null
  away_seed_desc: string | null
  match_id: number | null
  linked_match_number: number | null
  linked_scheduled_at: string | null
  linked_home_code: string | null
  linked_home_name: string | null
  linked_away_code: string | null
  linked_away_name: string | null
}

interface MatchOption {
  id: number
  stage: string
  match_number: number | null
  scheduled_at: string
  home_code: string | null
  home_name: string | null
  away_code: string | null
  away_name: string | null
}

interface MappingResponse {
  slots:   BracketSlotRow[]
  matches: MatchOption[]
}

const STAGE_ORDER = ['r32', 'r16', 'qf', 'sf', 'third_place', 'final']

// ---------------------------------------------------------------------------

export default function BracketMappingPage() {
  const [data, setData] = useState<MappingResponse | null>(null)
  const [err,  setErr]  = useState<string | null>(null)
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => { setAuthed(!!getSecret()) }, [])

  useEffect(() => {
    if (!authed) return
    adminFetch<MappingResponse>('/bracket-mapping')
      .then(setData)
      .catch(e => {
        if (e instanceof AdminAuthError) { window.location.href = '/admin'; return }
        setErr(String(e))
      })
  }, [authed])

  if (authed === false) {
    return (
      <div className="text-center py-20">
        <p className="text-cream/60">No admin session.</p>
        <Link href="/admin" className="mt-2 inline-block text-amber-400 hover:underline">→ Sign in</Link>
      </div>
    )
  }
  if (err) return <div className="text-center py-20 text-live">{err}</div>
  if (!data) return <div className="py-20"><div className="h-20 shimmer rounded-xl" /></div>

  // Bucket matches by stage so each slot's dropdown only sees same-stage options
  const matchesByStage: Record<string, MatchOption[]> = {}
  for (const m of data.matches) {
    (matchesByStage[m.stage] ||= []).push(m)
  }

  // Bucket slots by stage so we can render one panel per stage
  const slotsByStage: Record<string, BracketSlotRow[]> = {}
  for (const s of data.slots) {
    (slotsByStage[s.stage] ||= []).push(s)
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream/60 hover:border-amber-400/30 hover:text-gold"
          >
            ← Match list
          </Link>
          <div className="mt-4 text-[10px] font-bold tracking-[0.3em] text-amber-400">ADMIN CONSOLE</div>
          <h1 className="font-display text-3xl tracking-wide text-cream">BRACKET MAPPING</h1>
          <p className="mt-2 max-w-2xl text-sm text-cream/50">
            Each bracket slot needs to point at the scheduled match row that represents it.
            R32 auto-pairs by FIFA convention; R16+ have to be set explicitly because slot
            order doesn&apos;t match chronological match number. Pick the right match from each
            dropdown — saves on change.
          </p>
        </div>
      </div>

      {STAGE_ORDER.filter(s => slotsByStage[s]?.length).map(stage => (
        <section key={stage} className="rounded-2xl border border-white/10 panel">
          <div className="border-b border-white/5 bg-black/30 px-5 py-3">
            <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">{stageName(stage).toUpperCase()}</div>
            <h2 className="font-display text-xl tracking-wide text-cream">
              {slotsByStage[stage].length} slots
            </h2>
          </div>
          <div className="divide-y divide-white/5">
            {slotsByStage[stage].map(slot => (
              <SlotRow
                key={slot.id}
                slot={slot}
                matches={matchesByStage[stage] ?? []}
                onSaved={(newMatch) => {
                  // Optimistic local update
                  setData(d => d ? {
                    ...d,
                    slots: d.slots.map(s => s.id !== slot.id ? s : {
                      ...s,
                      match_id: newMatch?.id ?? null,
                      linked_match_number: newMatch?.match_number ?? null,
                      linked_scheduled_at: newMatch?.scheduled_at ?? null,
                      linked_home_code: newMatch?.home_code ?? null,
                      linked_home_name: newMatch?.home_name ?? null,
                      linked_away_code: newMatch?.away_code ?? null,
                      linked_away_name: newMatch?.away_name ?? null,
                    })
                  } : d)
                }}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------

function SlotRow({ slot, matches, onSaved }: {
  slot:    BracketSlotRow
  matches: MatchOption[]
  onSaved: (newMatch: MatchOption | null) => void
}) {
  type SaveState = 'idle' | 'saving' | 'saved' | 'error'
  const [save, setSave] = useState<SaveState>('idle')
  const [err,  setErr]  = useState<string | null>(null)

  async function commit(matchId: number | null) {
    setSave('saving'); setErr(null)
    try {
      await adminFetch(`/bracket/${slot.id}/link`, {
        method: 'PUT',
        body: JSON.stringify({ match_id: matchId }),
      })
      const m = matchId == null ? null : matches.find(x => x.id === matchId) ?? null
      onSaved(m)
      setSave('saved')
      setTimeout(() => setSave(s => s === 'saved' ? 'idle' : s), 1500)
    } catch (e) {
      setErr(String(e))
      setSave('error')
    }
  }

  return (
    <div className="grid items-center gap-3 px-5 py-3 sm:grid-cols-[60px_1fr_1fr_auto]">
      <div className="text-[10px] font-bold tracking-widest text-cream/40">
        SLOT #{slot.slot}
      </div>

      <div className="min-w-0">
        <div className="text-[10px] font-bold tracking-widest text-cream/40">SEED</div>
        <div className="text-xs text-cream/80 truncate">
          {slot.home_seed_desc ?? '?'}
          <span className="mx-1.5 text-cream/30">vs</span>
          {slot.away_seed_desc ?? '?'}
        </div>
      </div>

      <div className="min-w-0">
        <div className="text-[10px] font-bold tracking-widest text-cream/40">LINKED MATCH</div>
        <select
          value={slot.match_id ?? ''}
          onChange={e => commit(e.target.value === '' ? null : Number(e.target.value))}
          disabled={save === 'saving'}
          className="mt-1 w-full max-w-md rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-cream focus:border-amber-400/50 focus:outline-none"
        >
          <option value="">— not linked —</option>
          {matches.map(m => (
            <option key={m.id} value={m.id}>
              #{m.match_number} ·{' '}
              {new Date(m.scheduled_at).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
              {m.home_code && m.away_code && ` · ${m.home_code} vs ${m.away_code}`}
            </option>
          ))}
        </select>
      </div>

      <div className="text-right">
        {save === 'saving' ? (
          <span className="text-[10px] font-bold tracking-widest text-amber-400">SAVING…</span>
        ) : save === 'saved' ? (
          <span className="text-[10px] font-bold tracking-widest text-emerald-400">SAVED ✓</span>
        ) : save === 'error' ? (
          <span className="text-[10px] font-bold tracking-widest text-live">FAILED</span>
        ) : null}
        {err && <div className="mt-1 text-[10px] text-live">{err}</div>}
      </div>
    </div>
  )
}
