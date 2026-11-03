'use client'

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  Clapperboard,
  Download,
  Film,
  GripVertical,
  Layers3,
  Pause,
  Play,
  Redo2,
  Search,
  Sparkles,
  Undo2,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000'

type Alternative = {
  file: string
  start: number
  end: number
  confidence: number
  reason: string
}

type Shot = {
  id: string
  title: string
  detail: string
  duration: number
  file: string
  start: number
  end: number
  confidence: number
  quality: number
  reason: string
  tone: string
  tag: string
  status: 'found' | 'missing'
  media_url?: string
  alternatives?: Alternative[]
}

type Clip = {
  id: string
  title: string
  file: string
  source_start: number
  source_end: number
  start: number
  duration: number
  confidence: number
  tone: string
}

type Timeline = { clips: Clip[]; revision: number }
type ApiState = {
  brief: string
  shots: Shot[]
  footage: Array<{ name: string; media_url: string }>
  timeline: Timeline
  total_duration: number
  target_duration: number
}
type ProjectResponse = { id: string; status: string; state: ApiState }

function mediaSrc(path?: string) {
  if (!path) return ''
  return path.startsWith('http') ? path : `${API_BASE}${path}`
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const tenths = Math.floor((seconds % 1) * 10)
  return `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`
}

function formatRange(start: number, end: number) {
  return `${formatTime(start)} — ${formatTime(end)}`
}

export function EditorWorkspace({ projectId }: { projectId: string }) {
  const [state, setState] = useState<ApiState | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(58)
  const [tracks, setTracks] = useState(['Narrative edit', 'Music bed'])
  const [history, setHistory] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [briefDraft, setBriefDraft] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const [playbackMode, setPlaybackMode] = useState<'narrative' | 'shot'>('narrative')
  const [currentClipIndex, setCurrentClipIndex] = useState(0)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportingVideo, setExportingVideo] = useState(false)

  const loadProject = useCallback(async () => {
    setBusy(true)
    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/state`)
      if (!response.ok) throw new Error('Project could not be loaded.')
      const next = await response.json() as ApiState
      setState(next)
      setBriefDraft(next.brief)
      setSelectedId((current) => current || next.shots[0]?.id || '')
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Project could not be loaded.')
    } finally {
      setBusy(false)
    }
  }, [projectId])

  useEffect(() => { void loadProject() }, [loadProject])

  const selected = state?.shots.find((shot) => shot.id === selectedId) ?? state?.shots[0]
  const clips = state?.timeline.clips ?? []
  const selectedClip = clips.find((clip) => clip.id === selected?.id)
  
  // Current playing clip when in full narrative edit playback mode
  const activeClip = playbackMode === 'narrative' ? (clips[currentClipIndex] ?? clips[0]) : selectedClip
  const currentSource = activeClip ? mediaSrc(`/api/media/${activeClip.file}`) : mediaSrc(selected?.media_url)

  // Manage video position and playback
  useEffect(() => {
    const video = videoRef.current
    if (!video || !activeClip) return
    video.currentTime = activeClip.source_start
    if (playing) {
      void video.play().catch(() => setPlaying(false))
    } else {
      video.pause()
    }
  }, [currentClipIndex, playbackMode, activeClip?.id])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      void video.play().catch(() => setPlaying(false))
    } else {
      video.pause()
    }
  }, [playing])

  function handleTimeUpdate(event: React.SyntheticEvent<HTMLVideoElement>) {
    if (!activeClip) return
    const cur = event.currentTarget.currentTime
    if (cur >= activeClip.source_end) {
      if (playbackMode === 'narrative') {
        if (currentClipIndex < clips.length - 1) {
          setCurrentClipIndex((prev) => prev + 1)
        } else {
          // Finished entire narrative edit
          event.currentTarget.pause()
          setPlaying(false)
          setCurrentClipIndex(0)
        }
      } else {
        event.currentTarget.pause()
        setPlaying(false)
      }
    }
  }

  function record(action: string) {
    setHistory((current) => [...current, action])
  }

  async function mutate(path: string, init?: RequestInit) {
    setBusy(true)
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      })
      if (!response.ok) throw new Error(await response.text())
      const next = await response.json() as ApiState
      setState(next)
      setBriefDraft(next.brief)
      setError('')
      return next
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save this edit.')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function saveBrief() {
    if (briefDraft.trim().length < 10) return
    await mutate(`/api/projects/${projectId}/plan`, {
      method: 'POST',
      body: JSON.stringify({ brief: briefDraft.trim() }),
    })
    record('Rebuilt shot list')
  }

  async function moveShot(index: number, direction: -1 | 1) {
    if (!state) return
    const target = index + direction
    if (target < 0 || target >= state.shots.length) return
    const next = [...state.shots]
    ;[next[index], next[target]] = [next[target], next[index]]
    await mutate(`/api/projects/${projectId}/shots/reorder`, {
      method: 'POST',
      body: JSON.stringify({ shot_ids: next.map((shot) => shot.id) }),
    })
    record(`Moved ${state.shots[index].title}`)
  }

  async function applyAlternative(alt: Alternative) {
    if (!selected) return
    await mutate(`/api/projects/${projectId}/shots/${selected.id}`, {
      method: 'PATCH',
      body: JSON.stringify(alt),
    })
    record(`Applied alternative to ${selected.title}`)
  }

  async function updateSelected(fields: Partial<Shot>) {
    if (!selected) return
    await mutate(`/api/projects/${projectId}/shots/${selected.id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    })
    record(`Edited ${selected.title}`)
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !selected) return
    const form = new FormData()
    form.append('file', file)
    setBusy(true)
    try {
      const uploadResponse = await fetch(`${API_BASE}/api/projects/${projectId}/footage/upload`, { method: 'POST', body: form })
      if (!uploadResponse.ok) throw new Error('Footage upload failed.')
      await updateSelected({ file: file.name, start: 0, end: 3, confidence: 60, quality: 60, reason: 'Uploaded as a replacement take.' })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Footage upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function downloadVideo() {
    setExportingVideo(true)
    setError('')
    try {
      const url = `${API_BASE}/api/projects/${projectId}/export/video`
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Export render error (${res.status}): ${await res.text()}`)
      }
      const blob = await res.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `smart-rough-cut-${projectId}.mp4`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(downloadUrl)
    } catch (e: any) {
      setError(e.message || 'Video export failed.')
    } finally {
      setExportingVideo(false)
    }
  }

  function openExport(format: 'json' | 'csv' | 'video') {
    if (format === 'video') {
      void downloadVideo()
      return
    }
    window.open(`${API_BASE}/api/projects/${projectId}/export/${format}`, '_blank', 'noopener,noreferrer')
  }

  if (!state) {
    return <main className="grid min-h-screen place-items-center bg-[#1c1b19] px-6 text-[#f7f5f1]"><div className="rounded-2xl bg-[#252421] p-8 text-center"><p className="text-xs uppercase tracking-[0.16em] text-[#cfa47c]">Smart Rough Cut</p><h1 className="mt-4 font-serif text-3xl">{error || 'Loading your edit bay…'}</h1><button onClick={() => void loadProject()} className="mt-6 rounded-full bg-[#e4d8c9] px-4 py-2 text-xs font-semibold text-[#242321]">Retry</button></div></main>
  }

  return <main className="min-h-screen bg-[#1c1b19] text-[#f7f5f1] selection:bg-[#d7b99a]">
    <header className="relative flex h-16 items-center justify-between border-b border-white/10 px-5">
      <a href="/" className="absolute left-1/2 -translate-x-1/2 font-serif text-[22px] font-bold tracking-[-0.02em]">Smart Rough Cut</a>
      <div className="flex items-center gap-3 text-sm text-white/55"><span>Project / {projectId}</span><ChevronDown className="size-3" /></div>
      <div className="flex items-center gap-2">
        <button onClick={() => { setHistory((current) => current.slice(0, -1)); void mutate(`/api/projects/${projectId}/timeline/undo`, { method: 'POST' }) }} disabled={busy || !history.length} className="rounded-lg p-2 text-white/45 hover:bg-white/5 disabled:opacity-20" aria-label="Undo"><Undo2 className="size-4" /></button>
        <button onClick={() => void mutate(`/api/projects/${projectId}/timeline/redo`, { method: 'POST' })} disabled={busy} className="rounded-lg p-2 text-white/45 hover:bg-white/5 disabled:opacity-20" aria-label="Redo"><Redo2 className="size-4" /></button>
        
        {/* Export dropdown menu */}
        <div className="relative">
          <button onClick={() => setExportOpen((prev) => !prev)} className="flex items-center gap-2 rounded-full bg-[#e4d8c9] px-4 py-2 text-xs font-semibold text-[#242321] transition-transform hover:scale-105">
            <ArrowDownToLine className="size-3.5" />
            <span>Export</span>
            <ChevronDown className="size-3 opacity-60" />
          </button>

          {exportOpen && (
            <div className="absolute right-0 top-11 z-50 w-52 rounded-2xl border border-white/10 bg-[#252421] p-2 shadow-2xl backdrop-blur-md">
              <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/40">Select Export Format</p>
              <button
                onClick={() => { setExportOpen(false); void downloadVideo() }}
                disabled={exportingVideo}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium text-white transition-colors hover:bg-white/10"
              >
                <div className="flex items-center gap-2">
                  <Film className="size-3.5 text-[#cfa47c]" />
                  <span>Rendered Video (.mp4)</span>
                </div>
                {exportingVideo ? <span className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Download className="size-3 text-white/40" />}
              </button>
              <button
                onClick={() => { setExportOpen(false); openExport('json') }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium text-white transition-colors hover:bg-white/10"
              >
                <div className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#849e7a]" />
                  <span>Decision State (.json)</span>
                </div>
                <Download className="size-3 text-white/40" />
              </button>
              <button
                onClick={() => { setExportOpen(false); openExport('csv') }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium text-white transition-colors hover:bg-white/10"
              >
                <div className="flex items-center gap-2">
                  <Clapperboard className="size-3.5 text-[#b56e48]" />
                  <span>Timeline Clips (.csv)</span>
                </div>
                <Download className="size-3 text-white/40" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>

    <div className="mx-auto grid min-h-[calc(100vh-64px)] max-w-[1500px] gap-3 p-3 md:grid-cols-[220px_minmax(0,1fr)_290px]">
      <aside className="rounded-2xl bg-[#252421] p-4">
        <div className="mb-5 flex items-center justify-between"><h2 className="font-serif text-lg">Media library</h2><span className="text-[10px] uppercase tracking-[0.14em] text-white/35">{state.footage.length} files</span></div>
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs text-white/40"><Search className="size-3.5" /> Indexed footage</div>
        <div className="space-y-3">{state.footage.map((item) => <div key={item.name} className="rounded-xl bg-white/[0.03] p-2"><div className="relative aspect-video overflow-hidden rounded-lg bg-[#121210]"><video src={mediaSrc(item.media_url)} muted playsInline preload="metadata" className="size-full object-cover" /></div><p className="mt-2 truncate text-xs text-white/80">{item.name}</p><p className="text-[10px] text-white/35">Source available</p></div>)}</div>
      </aside>

      <section className="grid min-h-0 grid-rows-[minmax(280px,1fr)_auto] gap-3">
        <div className="relative flex min-h-[360px] flex-col items-center justify-center overflow-hidden rounded-2xl bg-[#121210] p-5">
          {/* Narrative Edit Mode / Shot Preview Toggle */}
          <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 rounded-full bg-black/60 p-1 text-[11px] backdrop-blur-md">
            <button
              onClick={() => { setPlaybackMode('narrative'); setPlaying(false); setCurrentClipIndex(0) }}
              className={cn('rounded-full px-3 py-1 font-medium transition-colors', playbackMode === 'narrative' ? 'bg-[#b56e48] text-white' : 'text-white/60 hover:text-white')}
            >
              Narrative Edit (Full Rough Cut)
            </button>
            <button
              onClick={() => { setPlaybackMode('shot'); setPlaying(false) }}
              className={cn('rounded-full px-3 py-1 font-medium transition-colors', playbackMode === 'shot' ? 'bg-[#b56e48] text-white' : 'text-white/60 hover:text-white')}
            >
              Shot Preview
            </button>
          </div>

          {currentSource ? (
            <video
              ref={videoRef}
              src={currentSource}
              playsInline
              preload="metadata"
              onTimeUpdate={handleTimeUpdate}
              className="size-full max-h-[58vh] rounded-xl object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-center text-white/45">
              <Film className="size-8" />
              <span>No matching footage for this shot</span>
              <small className="max-w-xs text-xs text-white/25">Choose an alternative take or upload a replacement source.</small>
            </div>
          )}

          <div className="absolute inset-5 rounded-xl bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
          
          <div className="absolute bottom-9 left-9 flex items-center gap-2 text-sm text-white/90">
            <Film className="size-4 text-[#cfa47c]" />
            <span>
              {playbackMode === 'narrative'
                ? `Narrative Edit · Clip ${currentClipIndex + 1}/${clips.length}: ${activeClip?.title ?? 'Rough cut'}`
                : (selected?.title ?? 'No selection')}
            </span>
          </div>

          <button
            onClick={() => setPlaying((current) => !current)}
            disabled={!currentSource}
            className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#f7f5f1] text-[#242321] transition-transform hover:scale-105 disabled:opacity-40"
            aria-label={playing ? 'Pause preview' : 'Play preview'}
          >
            {playing ? <Pause className="size-5 fill-current" /> : <Play className="ml-1 size-5 fill-current" />}
          </button>
        </div>

        <div className="rounded-2xl bg-[#252421] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-serif text-lg">Narrative Timeline</h2>
              <p className="text-[10px] text-white/35">{formatTime(state.total_duration)} / {state.target_duration}s target · revision {state.timeline.revision}</p>
            </div>
            <div className="flex items-center gap-2 text-white/45">
              <button onClick={() => setZoom(Math.max(30, zoom - 8))} aria-label="Zoom out"><ZoomOut className="size-4" /></button>
              <input aria-label="Timeline zoom" type="range" min="30" max="100" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="accent-[#c27745]" />
              <button onClick={() => setZoom(Math.min(100, zoom + 8))} aria-label="Zoom in"><ZoomIn className="size-4" /></button>
            </div>
          </div>
          {tracks.map((track) => (
            <div key={track} className="mb-2 flex items-center gap-3">
              <span className="w-24 truncate text-[10px] text-white/40">{track}</span>
              <div className="flex h-10 flex-1 gap-1 overflow-hidden rounded-lg bg-white/5 p-1">
                {track === tracks[0] ? clips.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedId(item.id)
                      if (playbackMode === 'narrative') {
                        setCurrentClipIndex(index)
                      }
                    }}
                    className={cn(
                      'flex min-w-0 items-center gap-1 rounded-md px-3 text-[10px] font-medium text-[#242321] transition-all',
                      (playbackMode === 'narrative' ? currentClipIndex === index : item.id === selected?.id) ? 'ring-2 ring-[#f7f5f1]' : '',
                      item.tone === 'lime' ? 'bg-[#9cae6c]' : 'bg-[#b56e48]'
                    )}
                    style={{ width: `${Math.max(10, (item.duration / Math.max(state.total_duration, 1)) * 100)}%` }}
                  >
                    <GripVertical className="size-3 shrink-0" />
                    <span className="truncate">{item.title}</span>
                  </button>
                )) : <div className="flex-1 rounded-md border border-dashed border-white/10" />}
              </div>
            </div>
          ))}
          <button onClick={() => setTracks((current) => [...current, `Track ${current.length + 1}`])} className="mt-2 flex items-center gap-2 text-xs text-[#cfa47c] hover:text-white"><Layers3 className="size-3.5" /> Add track</button>
        </div>
      </section>

      <aside className="rounded-2xl bg-[#252421] p-5">
        <div className="flex items-center gap-2 text-[#d1a47d]"><Sparkles className="size-4" /><span className="text-xs font-semibold uppercase tracking-[0.14em]">Shot inspector</span></div>
        <textarea value={briefDraft} onChange={(event) => setBriefDraft(event.target.value)} className="mt-5 min-h-24 w-full resize-y rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-5 text-white/75 outline-none focus:border-[#cfa47c]" aria-label="Editable customer brief" />
        <button onClick={() => void saveBrief()} disabled={busy || briefDraft.trim().length < 10} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15 disabled:opacity-40"><WandSparkles className="size-3.5" /> Rebuild shot list</button>
        {selected ? <>
          <div className="mt-8 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-[#d1a47d]">{selected.tag} / {selected.id}</p>
              <h2 className="mt-2 font-serif text-3xl leading-tight">{selected.title}</h2>
            </div>
            <span className={cn('rounded-full px-2 py-1 text-[10px] font-semibold', selected.status === 'found' ? 'bg-[#849e7a]/20 text-[#b8d1ad]' : 'bg-[#b56e48]/20 text-[#e2a982]')}>{selected.status === 'found' ? 'MATCHED' : 'MISSING'}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-white/50">{selected.detail}</p>
          <div className="mt-6 grid grid-cols-2 gap-3">{[['Confidence', selected.status === 'found' ? `${selected.confidence}%` : '—'], ['Quality', selected.status === 'found' ? `${selected.quality}%` : '—'], ['Source', selected.file || 'No source'], ['Range', selected.status === 'found' ? formatRange(selected.start, selected.end) : '—']].map(([label, value]) => <div key={label} className="min-w-0 rounded-xl bg-white/[0.04] p-3"><span className="block text-[10px] uppercase tracking-[0.12em] text-white/35">{label}</span><span className="mt-2 block truncate text-xs text-white/80">{value}</span></div>)}</div>
          <div className="mt-5 rounded-xl border-l-2 border-[#cfa47c] bg-white/[0.04] p-3"><span className="text-[10px] uppercase tracking-[0.12em] text-[#cfa47c]">Match note</span><p className="mt-2 text-xs leading-5 text-white/60">{selected.reason}</p></div>
          <div className="mt-6 flex items-center justify-between"><h3 className="font-serif text-lg">Alternatives</h3><span className="text-[10px] text-white/35">{selected.alternatives?.length ?? 0} indexed</span></div>
          <div className="mt-2 space-y-2">{(selected.alternatives ?? []).map((alt, index) => <div key={`${alt.file}-${index}`} className="flex items-center gap-2 rounded-xl border border-white/10 p-2"><div className="min-w-0 flex-1"><p className="truncate text-xs text-white/80">Take {String(index + 2).padStart(2, '0')} · {alt.file}</p><p className="text-[10px] text-white/35">{formatRange(alt.start, alt.end)} · {alt.confidence}%</p></div><button onClick={() => void applyAlternative(alt)} className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold hover:bg-white/20">Use</button></div>)}</div>
          {selected.status === 'missing' && <label className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#cfa47c]/40 px-3 py-3 text-xs text-[#cfa47c] hover:bg-white/5"><input type="file" accept="video/*" className="hidden" onChange={upload} />Upload replacement</label>}
          <div className="mt-7 border-t border-white/10 pt-5"><div className="mb-3 flex items-center justify-between"><h3 className="font-serif text-lg">Ordered shots</h3><span className="text-[10px] text-white/35">{state.shots.length}</span></div><div className="space-y-1.5">{state.shots.map((shot, index) => <div key={shot.id} className={cn('flex items-center gap-2 rounded-lg px-2 py-2', shot.id === selected.id ? 'bg-white/10' : 'hover:bg-white/5')}><button onClick={() => { setSelectedId(shot.id); setPlaybackMode('shot') }} className="min-w-0 flex-1 truncate text-left text-xs text-white/70">{shot.id} · {shot.title}</button><span className={cn('text-[10px]', shot.status === 'found' ? 'text-[#b8d1ad]' : 'text-[#e2a982]')}>{shot.status === 'found' ? `${shot.confidence}%` : 'MISS'}</span><button onClick={() => void moveShot(index, -1)} disabled={index === 0 || busy} className="text-white/35 hover:text-white disabled:opacity-20" aria-label={`Move ${shot.title} up`}>↑</button><button onClick={() => void moveShot(index, 1)} disabled={index === state.shots.length - 1 || busy} className="text-white/35 hover:text-white disabled:opacity-20" aria-label={`Move ${shot.title} down`}>↓</button></div>)}</div></div>
        </> : <div className="mt-8 text-sm text-white/45">Select a shot to inspect it.</div>}
        {error && <div className="mt-4 flex items-start justify-between gap-3 rounded-xl bg-[#b56e48]/15 p-3 text-xs text-[#e2a982]"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X className="size-3.5" /></button></div>}
        
        {/* Quick export buttons with feedback */}
        <div className="mt-6 flex flex-col gap-2">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Available Export Formats</p>
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => openExport('csv')} className="rounded-xl bg-white/5 px-2 py-2.5 text-[11px] font-medium text-white/75 hover:bg-white/10">CSV</button>
            <button onClick={() => openExport('json')} className="rounded-xl bg-white/5 px-2 py-2.5 text-[11px] font-medium text-white/75 hover:bg-white/10">JSON</button>
            <button
              onClick={() => void downloadVideo()}
              disabled={exportingVideo}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-[#e4d8c9] px-2 py-2.5 text-[11px] font-semibold text-[#242321] transition-transform hover:scale-[1.02] disabled:opacity-50"
            >
              {exportingVideo ? <span className="size-3 animate-spin rounded-full border-2 border-[#242321]/30 border-t-[#242321]" /> : <Film className="size-3" />}
              <span>MP4</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  </main>
}
