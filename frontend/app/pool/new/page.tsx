'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { competeFetch, CompeteError } from '@/lib/compete'

function slugify(s: string): string {
  return s.toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-')
          .slice(0, 40)
}

export default function NewPoolPage() {
  const router = useRouter()
  const [name, setName]       = useState('')
  const [slug, setSlug]       = useState('')
  const [slugManual, setSlugManual] = useState(false)
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  // Auto-derive slug from name unless the user has typed in slug themselves
  function onNameChange(v: string) {
    setName(v)
    if (!slugManual) setSlug(slugify(v))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !slug.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const res = await competeFetch<{ ok: boolean; slug: string }>(
        '/pools',
        { method: 'POST', body: JSON.stringify({ name, slug }) }
      )
      router.push(`/pool/${res.slug}`)
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
        ← Pools
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-white/10 panel p-8">
        <div className="absolute -top-20 -right-20 h-48 w-48 rounded-full bg-amber-500/20 blur-3xl" />
        <div className="relative">
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">CREATE POOL</div>
          <h1 className="mt-1 font-display text-3xl tracking-wide text-cream">NEW POOL</h1>
          <p className="mt-2 text-sm text-cream/50">
            A pool is a private leaderboard. Share its URL with people who should be on it.
            Anyone with the URL can join.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <Field label="Pool name">
              <input type="text" autoFocus maxLength={60} value={name}
                     onChange={e => onNameChange(e.target.value)}
                     placeholder="e.g. Sam's Friends"
                     className="adm-input" />
            </Field>
            <Field label="URL slug (auto-generated)">
              <input type="text" maxLength={40} value={slug}
                     onChange={e => { setSlug(slugify(e.target.value)); setSlugManual(true) }}
                     placeholder="sams-friends"
                     className="adm-input" />
              <p className="mt-1 text-[10px] text-cream/40">
                Your pool URL will be <code className="text-amber-400">/pool/{slug || '…'}</code>
              </p>
            </Field>

            {err && (
              <div className="rounded-lg border border-live/30 bg-live/10 px-3 py-2 text-xs font-semibold text-live">
                {err}
              </div>
            )}
            <button type="submit" disabled={busy || !name.trim() || !slug.trim()}
                    className="w-full rounded-xl bg-gold-gradient py-3 font-display tracking-wider text-ink shadow-gold disabled:opacity-50">
              {busy ? 'CREATING…' : 'CREATE POOL'}
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
