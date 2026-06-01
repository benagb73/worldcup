'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { usePool } from '@/lib/hooks'
import { competeFetch, CompeteError, markAsOwner, ownedIds } from '@/lib/compete'
import { PoolDetail } from '@/lib/types'

export default function JoinPoolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router  = useRouter()
  const { data: pool, isLoading } = usePool(slug)

  const owned = ownedIds()

  const [mode, setMode] = useState<'new' | 'existing'>(owned.length > 0 ? 'existing' : 'new')
  const [name, setName]               = useState('')
  const [teamName, setTeamName]       = useState('')
  const [existingId, setExistingId]   = useState<number | ''>(owned[0] ?? '')
  const [busy, setBusy]               = useState(false)
  const [err, setErr]                 = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      let body: any
      if (mode === 'new') {
        if (!name.trim() || !teamName.trim()) { setErr('Fill both fields'); setBusy(false); return }
        body = { new_name: name, new_team_name: teamName }
      } else {
        if (!existingId) { setErr('Select your competitor'); setBusy(false); return }
        body = { competitor_id: Number(existingId) }
      }
      const res = await competeFetch<{ ok: boolean; competitor_id: number }>(
        `/pools/${slug}/members`,
        { method: 'POST', body: JSON.stringify(body) }
      )
      if (mode === 'new') markAsOwner(res.competitor_id)
      router.push(`/compete/${res.competitor_id}`)
    } catch (e) {
      setErr(e instanceof CompeteError ? e.message : String(e))
      setBusy(false)
    }
  }

  if (isLoading) return <div className="py-20"><div className="h-40 rounded-3xl shimmer" /></div>
  if (!pool)    return <div className="py-20 text-center text-cream/40">Pool not found</div>

  const p: PoolDetail = pool

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link
        href={`/pool/${slug}`}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream/60 hover:border-amber-400/30 hover:text-gold"
      >
        ← {p.name}
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-white/10 panel p-8">
        <div className="absolute -top-20 -right-20 h-48 w-48 rounded-full bg-amber-500/20 blur-3xl" />
        <div className="relative">
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">JOIN POOL</div>
          <h1 className="mt-1 font-display text-3xl tracking-wide text-cream">{p.name.toUpperCase()}</h1>

          {owned.length > 0 && (
            <div className="mt-5 flex gap-2 text-[11px] font-bold tracking-widest">
              <button
                onClick={() => setMode('existing')}
                className={mode === 'existing'
                  ? 'rounded-full border border-amber-400/50 bg-amber-500/10 px-3 py-1.5 text-amber-400'
                  : 'rounded-full border border-white/10 px-3 py-1.5 text-cream/50 hover:text-cream'}
              >USE MY EXISTING TEAM</button>
              <button
                onClick={() => setMode('new')}
                className={mode === 'new'
                  ? 'rounded-full border border-amber-400/50 bg-amber-500/10 px-3 py-1.5 text-amber-400'
                  : 'rounded-full border border-white/10 px-3 py-1.5 text-cream/50 hover:text-cream'}
              >CREATE NEW TEAM</button>
            </div>
          )}

          <form onSubmit={submit} className="mt-5 space-y-3">
            {mode === 'new' ? (
              <>
                <Field label="Your name">
                  <input type="text" autoFocus maxLength={80} value={name}
                         onChange={e => setName(e.target.value)} placeholder="e.g. Sam"
                         className="adm-input" />
                </Field>
                <Field label="Team name (unique)">
                  <input type="text" maxLength={40} value={teamName}
                         onChange={e => setTeamName(e.target.value)} placeholder="e.g. Sam's Side"
                         className="adm-input" />
                </Field>
              </>
            ) : (
              <Field label="Which of your teams?">
                <select value={existingId}
                        onChange={e => setExistingId(e.target.value ? Number(e.target.value) : '')}
                        className="adm-input">
                  <option value="">— select —</option>
                  {owned.map(id => <option key={id} value={id}>Competitor #{id}</option>)}
                </select>
                <p className="mt-1 text-[10px] text-cream/40">
                  These are teams you&rsquo;ve claimed on this browser. Picks will stay shared
                  across every pool you&rsquo;re in.
                </p>
              </Field>
            )}

            {err && (
              <div className="rounded-lg border border-live/30 bg-live/10 px-3 py-2 text-xs font-semibold text-live">
                {err}
              </div>
            )}
            <button type="submit" disabled={busy}
                    className="w-full rounded-xl bg-gold-gradient py-3 font-display tracking-wider text-ink shadow-gold disabled:opacity-50">
              {busy ? 'JOINING…' : 'JOIN POOL'}
            </button>
          </form>
        </div>

        <style jsx>{`
          :global(.adm-input) {
            width: 100%;
            background: rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 10px;
            padding: 10px 12px;
            color: #f7f5ef;
            font-size: 14px;
          }
          :global(.adm-input:focus) {
            outline: none;
            border-color: rgba(251,191,36,0.5);
            box-shadow: 0 0 0 3px rgba(251,191,36,0.15);
          }
        `}</style>
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold tracking-widest text-cream/40 mb-1">{label.toUpperCase()}</span>
      {children}
    </label>
  )
}
