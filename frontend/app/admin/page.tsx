'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import clsx from 'clsx'
import {
  adminFetch, getSecret, setSecret, clearSecret,
  AdminAuthError, AdminMatchRow,
} from '@/lib/admin'
import { stageName } from '@/lib/utils'

export default function AdminIndex() {
  const [hasSecret, setHasSecret] = useState<boolean | null>(null)

  useEffect(() => { setHasSecret(!!getSecret()) }, [])

  if (hasSecret === null) return null  // server render

  if (!hasSecret) return <LoginGate onSuccess={() => setHasSecret(true)} />
  return <MatchPicker onSignOut={() => { clearSecret(); setHasSecret(false) }} />
}

// ---------------------------------------------------------------------------
// Login gate
// ---------------------------------------------------------------------------

function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy,  setBusy]  = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSecret(value.trim())
    try {
      await adminFetch('/whoami')
      onSuccess()
    } catch (err) {
      clearSecret()
      setError(err instanceof AdminAuthError ? 'Wrong secret' : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 panel p-8">
        <div className="absolute -top-20 -right-20 h-48 w-48 rounded-full bg-amber-500/20 blur-3xl" />
        <div className="relative">
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">RESTRICTED</div>
          <h1 className="mt-1 font-display text-3xl tracking-wide text-cream">ADMIN ACCESS</h1>
          <p className="mt-2 text-sm text-cream/50">
            Enter the shared secret to manage live scores, events and lineups.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <input
              type="password"
              autoFocus
              autoComplete="off"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-cream placeholder:text-cream/20 focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
            />
            {error && (
              <div className="rounded-lg border border-live/30 bg-live/10 px-3 py-2 text-xs font-semibold text-live">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy || !value.trim()}
              className="w-full rounded-xl bg-gold-gradient py-3 font-display tracking-wider text-ink shadow-gold transition-transform hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
            >
              {busy ? 'CHECKING…' : 'UNLOCK'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Match picker
// ---------------------------------------------------------------------------

function MatchPicker({ onSignOut }: { onSignOut: () => void }) {
  const [matches, setMatches] = useState<AdminMatchRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'toplay' | 'final'>('toplay')

  useEffect(() => {
    adminFetch<AdminMatchRow[]>('/matches')
      .then(setMatches)
      .catch(e => {
        if (e instanceof AdminAuthError) { onSignOut(); return }
        setError(String(e))
      })
  }, [onSignOut])

  if (error)  return <div className="text-center py-20 text-live">{error}</div>
  if (!matches) return <div className="py-20"><div className="h-20 shimmer rounded-xl" /></div>

  // Split into two buckets. TO PLAY = live + scheduled + postponed,
  // sorted live-first then by kickoff ascending (next match on top).
  // FINAL = status='final', sorted by kickoff descending (most recent first).
  const finals  = matches.filter(m => m.status === 'final')
                         .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))
  const toPlay  = matches.filter(m => m.status !== 'final')
                         .sort((a, b) => {
                           const aLive = a.status.startsWith('live') ? 0 : 1
                           const bLive = b.status.startsWith('live') ? 0 : 1
                           if (aLive !== bLive) return aLive - bLive
                           return a.scheduled_at.localeCompare(b.scheduled_at)
                         })

  const list = tab === 'toplay' ? toPlay : finals

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">ADMIN CONSOLE</div>
          <h1 className="font-display text-3xl tracking-wide text-cream">MATCH UPDATES</h1>
        </div>
        <div className="flex items-center gap-2">
          <RefillBracketButton />
          <Link
            href="/admin/bracket"
            className="hidden sm:block rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold tracking-widest text-amber-400 hover:bg-amber-500/20"
          >
            BRACKET MAP →
          </Link>
          <Link
            href="/admin/scoring"
            className="hidden sm:block rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold tracking-widest text-amber-400 hover:bg-amber-500/20"
          >
            SCORING CONFIG →
          </Link>
          <button
            onClick={onSignOut}
            className="text-xs font-semibold text-cream/40 hover:text-live transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Tabs: TO PLAY first so live + upcoming sit at the top of the page */}
      <div className="rounded-full border border-white/10 bg-white/[0.02] p-1 flex items-center gap-1">
        <PickerTabButton active={tab === 'toplay'} onClick={() => setTab('toplay')}>
          TO PLAY · {toPlay.length}
        </PickerTabButton>
        <PickerTabButton active={tab === 'final'}  onClick={() => setTab('final')}>
          FINAL · {finals.length}
        </PickerTabButton>
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 panel py-12 text-center text-sm text-cream/40">
          {tab === 'toplay' ? 'No matches left to play.' : 'No matches have finished yet.'}
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(m => <MatchPickerRow key={m.id} match={m} />)}
        </div>
      )}
    </div>
  )
}

function RefillBracketButton() {
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState<string | null>(null)

  async function go() {
    if (busy) return
    setBusy(true); setMsg(null)
    try {
      const res = await adminFetch<{ ok: boolean; complete_groups: string[] }>(
        '/bracket/refill', { method: 'POST' }
      )
      const n = res.complete_groups.length
      setMsg(n ? `Filled ${n} group${n === 1 ? '' : 's'}: ${res.complete_groups.join(', ')}` : 'No complete groups yet')
      setTimeout(() => setMsg(null), 4000)
    } catch (e) {
      setMsg(`Error: ${e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={go}
        disabled={busy}
        title="Push group winners + runners-up into R32 match rows so picks work for already-complete groups."
        className="hidden sm:block rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold tracking-widest text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
      >
        {busy ? 'REFILLING…' : 'REFILL BRACKET'}
      </button>
      {msg && (
        <div className="absolute top-full right-0 mt-2 whitespace-nowrap rounded-lg border border-amber-400/30 bg-ink/95 px-3 py-1.5 text-[11px] font-semibold text-amber-400 shadow-gold z-10">
          {msg}
        </div>
      )}
    </div>
  )
}

function PickerTabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex-1 rounded-full px-4 py-2 text-[11px] font-bold tracking-widest transition-colors',
        active
          ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-400/30'
          : 'text-cream/50 hover:text-cream hover:bg-white/5'
      )}
    >
      {children}
    </button>
  )
}

function MatchPickerRow({ match }: { match: AdminMatchRow }) {
  const isLive = match.status.startsWith('live')
  const isFinal = match.status === 'final'
  const score = scoreFor(match)

  return (
    <Link
      href={`/admin/match/${match.id}`}
      className={clsx(
        'group grid grid-cols-[80px_1fr_auto] items-center gap-4 rounded-xl border px-4 py-3 transition-all hover-lift',
        isLive ? 'border-live/40 bg-live/5'
        : isFinal ? 'border-white/8 bg-white/[0.02] hover:border-amber-400/30'
        : 'border-white/8 bg-white/[0.02] hover:border-amber-400/30'
      )}
    >
      <div className="text-[10px] font-bold tracking-widest text-cream/30">
        <div>{stageName(match.stage).toUpperCase()}{match.group_name ? ` · ${match.group_name}` : ''}</div>
        <div className="mt-0.5 font-mono text-cream/50">
          {new Date(match.scheduled_at).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
          })}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 min-w-0">
        <div className="flex items-center justify-end gap-2 min-w-0">
          <span className={clsx(
            'truncate text-sm font-semibold',
            match.home_name == null ? 'italic text-cream/30'
            : match.winner_id === match.home_id ? 'text-cream' : 'text-cream/70'
          )}>
            {match.home_name ?? 'TBD'}
          </span>
          {match.home_flag ? (
            <Image src={match.home_flag} alt={match.home_code ?? '?'}
                   width={28} height={20}
                   className="h-5 w-7 shrink-0 rounded-sm object-cover ring-1 ring-black/40"
                   unoptimized />
          ) : (
            <span className="h-5 w-7 shrink-0 rounded-sm bg-white/5 ring-1 ring-black/40" />
          )}
        </div>
        <span className={clsx(
          'font-display text-xl tracking-tight tabular-nums',
          isLive ? 'text-amber-400'
          : score === null ? 'text-cream/25'
          : 'text-cream'
        )}>
          {score ?? 'vs'}
        </span>
        <div className="flex items-center gap-2 min-w-0">
          {match.away_flag ? (
            <Image src={match.away_flag} alt={match.away_code ?? '?'}
                   width={28} height={20}
                   className="h-5 w-7 shrink-0 rounded-sm object-cover ring-1 ring-black/40"
                   unoptimized />
          ) : (
            <span className="h-5 w-7 shrink-0 rounded-sm bg-white/5 ring-1 ring-black/40" />
          )}
          <span className={clsx(
            'truncate text-sm font-semibold',
            match.away_name == null ? 'italic text-cream/30'
            : match.winner_id === match.away_id ? 'text-cream' : 'text-cream/70'
          )}>
            {match.away_name ?? 'TBD'}
          </span>
        </div>
      </div>

      <StatusPill status={match.status} />
    </Link>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    scheduled:        { label: 'SCHEDULED', cls: 'bg-white/8 text-cream/50' },
    live:             { label: 'LIVE',      cls: 'bg-live/15 text-live' },
    live_et:          { label: 'LIVE · ET', cls: 'bg-live/15 text-live' },
    live_penalties:   { label: 'LIVE · PEN',cls: 'bg-live/15 text-live' },
    final:            { label: 'FINAL',     cls: 'bg-amber-500/15 text-amber-400' },
    postponed:        { label: 'POSTPONED', cls: 'bg-white/8 text-cream/40' },
  }
  const { label, cls } = map[status] ?? { label: status.toUpperCase(), cls: 'bg-white/8 text-cream/50' }
  return (
    <span className={clsx('rounded-full px-2.5 py-1 text-[10px] font-bold tracking-widest', cls)}>
      {label}
    </span>
  )
}

function scoreFor(m: AdminMatchRow): string | null {
  if (m.pen_home !== null && m.pen_away !== null) return `${m.et_home ?? m.ft_home ?? 0}–${m.et_away ?? m.ft_away ?? 0} (${m.pen_home}–${m.pen_away})`
  if (m.et_home !== null && m.et_away !== null) return `${m.et_home}–${m.et_away}`
  if (m.ft_home !== null && m.ft_away !== null) return `${m.ft_home}–${m.ft_away}`
  if (m.ht_home !== null && m.ht_away !== null) return `${m.ht_home}–${m.ht_away}`
  return null
}
