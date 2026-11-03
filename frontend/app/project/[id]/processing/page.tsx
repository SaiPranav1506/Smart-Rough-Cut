'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, Clapperboard } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000'
const stages = [
  'Uploading footage',
  'Extracting scenes, frames and audio',
  'Understanding your footage with AI',
  'Finding the requested shots',
  'Building your first editing timeline',
]

type ProgressPayload = {
  status: string
  progress: { step: number; total: number; label: string }
  state: { brief: string; footage: Array<{ name: string }> }
}

export default function ProcessingPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [payload, setPayload] = useState<ProgressPayload | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const update = (next: ProgressPayload) => {
      if (!active) return
      setPayload(next)
      if (next.status === 'editing') router.replace(`/project/${id}/editor`)
    }
    const events = new EventSource(`${API_BASE}/api/projects/${id}/events`)
    events.onmessage = (event) => update(JSON.parse(event.data) as ProgressPayload)
    events.onerror = () => {
      events.close()
      void fetch(`${API_BASE}/api/projects/${id}`).then((response) => response.json()).then(update).catch(() => setError('Could not read processing progress.'))
    }
    return () => { active = false; events.close() }
  }, [id, router])

  const active = payload?.progress.step ?? 0
  return <main className="min-h-screen bg-[#f7f5f1] px-6 py-7 text-[#242321] selection:bg-[#dce7da] sm:px-10">
    <div className="pointer-events-none fixed inset-0 opacity-45 [background-image:radial-gradient(#d7d3cb_0.7px,transparent_0.7px)] [background-size:20px_20px]" />
    <header className="relative mx-auto flex max-w-6xl items-center justify-between border-b border-[#dedad3] pb-5"><a href="/" className="flex items-center gap-2 font-serif text-lg font-bold"><span className="grid size-8 place-items-center rounded-lg bg-[#242321] text-[#f7f5f1]"><Clapperboard className="size-4" /></span>Smart Rough Cut</a><span className="font-serif text-sm text-[#8e8a83]">Project / {id}</span></header>
    <section className="relative mx-auto grid max-w-6xl gap-12 py-16 lg:grid-cols-[1fr_0.82fr] lg:items-center lg:py-24"><div><p className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-[#b56e48]">Creating your first cut</p><h1 className="max-w-xl font-serif text-5xl leading-[0.94] tracking-[-0.055em] sm:text-7xl">Finding the story<br /><em className="font-normal text-[#b56e48]">inside your footage.</em></h1><p className="mt-7 max-w-md font-serif text-base leading-7 text-[#77736d]">{payload?.state?.brief || 'We are reading the room, listening for rhythm, and assembling the moments that make your brief feel real.'}</p><button disabled={payload?.status !== 'editing'} onClick={() => router.push(`/project/${id}/editor`)} className="mt-9 flex items-center gap-2 rounded-full bg-[#242321] px-5 py-3 text-sm font-semibold text-[#f7f5f1] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-35">Open editor <ArrowUpRight className="size-4" /></button></div><div className="rounded-[26px] border border-[#dedad3] bg-white/60 p-5 shadow-[0_18px_60px_rgba(55,48,38,0.08)]"><div className="mb-5 flex items-center justify-between"><span className="font-serif text-sm text-[#77736d]">Analysis pipeline</span><span className="text-xs text-[#b56e48]">{payload?.status === 'editing' ? 'Ready' : 'In progress'}</span></div><div className="flex flex-col gap-1">{stages.map((stage, index) => <div key={stage} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left"><span className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs ${index + 1 < active ? 'border-[#849e7a] bg-[#849e7a] text-[#242321]' : index + 1 === active ? 'border-[#b56e48] text-[#b56e48]' : 'border-[#d4cec4] text-[#aaa39a]'}`}>{index + 1 < active ? <Check className="size-4" /> : index + 1}</span><span className={`text-sm ${index + 1 <= active ? 'text-[#4e4942]' : 'text-[#aaa39a]'}`}>{stage}</span></div>)}</div><div className="mt-4 h-1 overflow-hidden rounded-full bg-[#e7e1d8]"><div className="h-full rounded-full bg-[#b56e48] transition-[width] duration-700" style={{ width: `${Math.max(4, (active / stages.length) * 100)}%` }} /></div><p className="mt-3 text-xs text-[#8e8a83]">{payload?.state?.footage?.length ?? 0} source videos indexed · {payload?.progress?.label ?? 'Preparing your edit'}</p>{error && <p className="mt-3 text-xs text-[#a65d43]">{error}</p>}</div></section>
  </main>
}
