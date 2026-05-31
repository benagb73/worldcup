'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { competeFetch, CompeteError, markAsOwner } from '@/lib/compete'

export default function JoinPage() {
  const router = useRouter()
  const [name, setName]         = useState('')
  const [teamName, setTeamName] = useState('')
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !teamName.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const res = await competeFetch<{ ok: boolean; id: number }>(
        '/competitors',
        { method: 'POST', body: JSON.stringify({ name, team_name: teamName }) }
      )
      // Remember this browser owns the new competitor — lets them see their own
      // pre-kickoff picks (and hides them from anyone else's browser).
      markAsOwner(res.id)
      router.push(`/compete/${res.id}`)
    } catch (e) {
      setErr(e instanceof CompeteError ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link
        href="/compete"
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream/60 hover:border-amber-400/30 hover:text-gold"
      >
        ← Leaderboard
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-white/10 panel p-8">
        <div className="absolute -top-20 -right-20 h-48 w-48 rounded-full bg-amber-500/20 blur-3xl" />
        <div className="relative">
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">JOIN THE COMP</div>
          <h1 className="mt-1 font-display text-3xl tracking-wide text-cream">PICK YOUR TEAM</h1>
          <p className="mt-2 text-sm text-cream/50">
            Pick a unique team name. After signing up you&rsquo;ll get your own picks page —
            bookmark it. Anyone with the URL can edit your picks, so keep it to yourself.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <Field label="Your name">
              <input
                type="text"
                autoFocus
                value={name}
                maxLength={80}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Ben"
                className="adm-input"
              />
            </Field>
            <Field label="Team name (unique)">
              <input
                type="text"
                value={teamName}
                maxLength={40}
                onChange={e => setTeamName(e.target.value)}
                placeholder="e.g. Rosie's Rovers"
                className="adm-input"
              />
            </Field>

            {err && (
              <div className="rounded-lg border border-live/30 bg-live/10 px-3 py-2 text-xs font-semibold text-live">
                {err}
              </div>
            )}
            <button
              type="submit"
              disabled={busy || !name.trim() || !teamName.trim()}
              className="w-full rounded-xl bg-gold-gradient py-3 font-display tracking-wider text-ink shadow-gold transition-transform hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
            >
              {busy ? 'JOINING…' : 'JOIN'}
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
