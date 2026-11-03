'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Mic, Paperclip, Play, Plus, Send, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const prompts = ['Cinematic café reel', 'Product showcase', 'Event highlight', 'Instagram reel']
const waveform = [18, 30, 46, 25, 58, 36, 66, 42, 72, 28, 54, 38, 64, 22, 48, 34, 58, 27]
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000'

type Footage = { name: string; duration: string; colors: string }

export function SmartRoughCutApp() {
  const [files, setFiles] = useState<Footage[]>([])
  const [rawFiles, setRawFiles] = useState<File[]>([])
  const [brief, setBrief] = useState(
    'Make a warm, energetic 30-second reel for Bean & Bloom. Start outside, show coffee being made and the latte art, happy customers, pastries, my welcome, the ribbon cutting, and end with a toast.'
  )
  const [recording, setRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const uploadTimerRef = useRef<number | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch indexed workspace footage automatically on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/state`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.footage && Array.isArray(data.footage) && data.footage.length > 0) {
          const loaded: Footage[] = data.footage.map((f: { name: string; duration?: number }, index: number) => ({
            name: f.name,
            duration: f.duration ? `${Math.floor(f.duration / 60)}:${Math.floor(f.duration % 60).toString().padStart(2, '0')}` : '00:30',
            colors: ['from-[#7651c6] via-[#c744bc] to-[#e06a91]', 'from-[#376f61] via-[#6d9b6a] to-[#b8b66b]', 'from-[#a65d43] via-[#d28d58] to-[#dfb66e]'][index % 3],
          }))
          setFiles(loaded)
        }
      })
      .catch(() => {})
  }, [])

  const canGenerate = brief.trim().length > 3

  function handleFiles(nextFiles: FileList | null) {
    if (!nextFiles) return
    const additions = Array.from(nextFiles).filter((file) => file.type.startsWith('video/')).map((file, index) => ({
      name: file.name,
      duration: '00:--',
      colors: ['from-[#7651c6] via-[#c744bc] to-[#e06a91]', 'from-[#376f61] via-[#6d9b6a] to-[#b8b66b]', 'from-[#a65d43] via-[#d28d58] to-[#dfb66e]'][index % 3],
    }))
    if (!additions.length) return
    const incoming = Array.from(nextFiles).filter((file) => file.type.startsWith('video/'))
    setRawFiles((current) => [...current, ...incoming.filter((file) => !current.some((item) => item.name === file.name))])
    setFiles((current) => [...current, ...additions.filter((addition) => !current.some((file) => file.name === addition.name))])
    setIsUploading(true)
    setUploadProgress(12)
    if (uploadTimerRef.current) window.clearInterval(uploadTimerRef.current)
    uploadTimerRef.current = window.setInterval(() => {
      setUploadProgress((current) => {
        const next = Math.min(current + 18, 100)
        if (next === 100 && uploadTimerRef.current) {
          window.clearInterval(uploadTimerRef.current)
          uploadTimerRef.current = null
          window.setTimeout(() => setIsUploading(false), 400)
        }
        return next
      })
    }, 220)
  }

  function cancelUpload() {
    if (uploadTimerRef.current) window.clearInterval(uploadTimerRef.current)
    uploadTimerRef.current = null
    setFiles([])
    setRawFiles([])
    setUploadProgress(0)
    setIsUploading(false)
  }

  function removeFile(name: string) {
    setFiles((current) => current.filter((file) => file.name !== name))
    setRawFiles((current) => current.filter((file) => file.name !== name))
  }

  async function toggleRecording() {
    if (recording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      setRecording(false)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        if (audioBlob.size === 0) return

        setIsTranscribing(true)
        try {
          const form = new FormData()
          form.append('file', audioBlob, 'mic_recording.webm')
          const res = await fetch(`${API_BASE}/api/transcribe`, { method: 'POST', body: form })
          if (res.ok) {
            const data = await res.json() as { transcript: string; success: boolean }
            if (data.transcript) {
              setBrief((current) => (current ? `${current} ${data.transcript}` : data.transcript))
            }
          }
        } catch (err) {
          console.error('STT Transcription error:', err)
        } finally {
          setIsTranscribing(false)
        }
      }

      recorder.start()
      setRecording(true)
    } catch (err) {
      console.warn('Microphone error or permission denied, using Web Speech API fallback', err)
      const SpeechRecognition = (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition()
        recognition.continuous = false
        recognition.interimResults = false
        recognition.onresult = (e: any) => {
          const spoken = e.results[0]?.[0]?.transcript
          if (spoken) setBrief((current) => (current ? `${current} ${spoken}` : spoken))
          setRecording(false)
        }
        recognition.onerror = () => setRecording(false)
        recognition.onend = () => setRecording(false)
        recognition.start()
        setRecording(true)
      } else {
        alert('Microphone access is unavailable or denied.')
      }
    }
  }

  function beginGeneration() {
    if (!canGenerate) return
    setIsGenerating(true)
    const form = new FormData()
    form.append('brief', brief.trim())
    rawFiles.forEach((file) => form.append('files', file))
    void fetch(`${API_BASE}/api/projects`, { method: 'POST', body: form })
      .then(async (response) => {
        if (!response.ok) throw new Error('Project creation failed')
        return response.json() as Promise<{ id: string }>
      })
      .then((project) => { window.location.href = `/project/${project.id}/processing` })
      .catch(() => setIsGenerating(false))
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#f7f5f1] text-[#242321] selection:bg-[#dce7da]">
      <div className="pointer-events-none fixed inset-0 opacity-50 [background-image:radial-gradient(#d7d3cb_0.7px,transparent_0.7px)] [background-size:20px_20px]" />
      <nav className="relative z-10 mx-auto flex w-full max-w-7xl justify-center px-6 pb-[65px] pt-6 text-center lg:px-10">
        <a href="/" className="font-serif text-[22px] font-bold tracking-[-0.02em]">Smart Rough Cut</a>
      </nav>
      <section className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center gap-0 px-6 pb-24 pt-0 text-center">
        <h1 className="max-w-3xl font-serif text-5xl leading-[0.96] tracking-[-0.055em] text-[#252422] sm:text-[67px]">What are we creating<br /><em className="font-normal text-[#b56e48]">today?</em></h1>
        {files.length === 0 && !isUploading && <p className="mt-6 max-w-lg text-[20px] leading-7 text-[#77736d]">Drop your footage. Tell us the story. We&apos;ll find the moments and build your first cut.</p>}

        {(files.length === 0 || isUploading) && <div className="mt-8 w-full rounded-[28px] border border-[#dedad3] bg-white/65 p-3 shadow-[0_16px_50px_rgba(55,48,38,0.06)]" onDragOver={(event) => { event.preventDefault(); setIsDragging(true) }} onDragLeave={() => setIsDragging(false)} onDrop={(event) => { event.preventDefault(); setIsDragging(false); handleFiles(event.dataTransfer.files) }}>
          {isUploading ? <div className="flex min-h-40 flex-col justify-center rounded-[20px] bg-[#202722] px-6 text-left text-white"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold">Preparing your footage</p><p className="mt-1 truncate text-xs text-white/55">{files[0]?.name}</p></div><button onClick={cancelUpload} className="rounded-full px-3 py-1 text-xs text-white/55 transition-colors hover:bg-white/10 hover:text-white">Cancel</button></div><div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#d79b72] transition-[width] duration-300" style={{ width: `${uploadProgress}%` }} /></div><div className="mt-2 flex justify-between text-[11px] text-white/40"><span>Building clip context</span><span>{uploadProgress}%</span></div></div> : <button onClick={() => inputRef.current?.click()} className={cn('flex min-h-40 w-full flex-col items-center justify-center rounded-[20px] border border-dashed text-center transition-all', isDragging ? 'border-[#b56e48] bg-[#fffaf4]' : 'border-[#cbc4b9] hover:border-[#b56e48] hover:bg-white/55')}><span className="mb-4 grid size-12 place-items-center rounded-2xl bg-[#242321] text-[#f7f5f1]"><Upload className="size-5" /></span><span className="text-sm font-semibold">Upload your video</span><span className="mt-1 text-xs text-[#8e8a83]">Drop footage here or browse · MP4, MOV, WebM</span><span className="mt-4 rounded-full bg-[#f0e8dd] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#9b6040]">{isDragging ? 'Release to add footage' : 'One or more clips'}</span></button>}
          <input ref={inputRef} type="file" accept="video/*" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
        </div>}

        {files.length > 0 && !isUploading && <div className="mt-1 w-full text-center">
          <div className="overflow-hidden rounded-[27px] border border-[#72806f]/45 bg-[#202722] p-4 pt-3.5 text-[#f7f5f1] shadow-[0_20px_55px_rgba(35,43,38,0.18)] sm:p-5 sm:pt-3.5" style={{ height: '300px' }} onDragOver={(event) => { event.preventDefault(); setIsDragging(true) }} onDragLeave={() => setIsDragging(false)} onDrop={(event) => { event.preventDefault(); setIsDragging(false); handleFiles(event.dataTransfer.files) }}>
            {files.length > 0 && <div className="mb-4 flex gap-2 overflow-x-auto pb-1">{files.map((file) => <div key={file.name} className="group relative min-w-[144px] overflow-hidden rounded-xl border border-white/10 bg-[#303a35] p-1.5 transition-all duration-200 hover:-translate-y-0.5"><div className="relative h-[76px] overflow-hidden rounded-lg bg-[#303a35]"><img src="/cafe-footage-thumb.png" alt={`${file.name} thumbnail`} className="size-full object-cover" /><span className="absolute inset-0 bg-black/15" /><Play className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 fill-white text-white" /><span className="absolute bottom-1 left-1 rounded bg-black/45 px-1.5 py-0.5 text-[10px] text-white">{file.duration}</span><button onClick={() => removeFile(file.name)} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/45 text-white/80 transition-colors hover:bg-black/70 hover:text-white" aria-label={`Remove ${file.name}`}><X className="size-3" /></button></div><p className="mt-1 truncate px-1 text-[10px] text-white/65">{file.name}</p></div>)}<button onClick={() => inputRef.current?.click()} className="grid min-w-[48px] place-items-center rounded-xl border border-dashed border-white/20 text-white/45 transition-colors hover:border-white/50 hover:text-white" aria-label="Add more videos"><Plus className="size-5" /></button></div>}
            <textarea value={brief} onChange={(event) => setBrief(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); beginGeneration() } }} rows={2} placeholder="Describe the video you want to create..." className="min-h-16 w-full resize-none bg-transparent px-1 py-2 text-[19px] leading-7 text-white outline-none placeholder:text-white/30" />
            <div className="flex items-center justify-between border-t border-white/10"><div className="flex items-center gap-3"><button onClick={toggleRecording} className={cn('relative grid size-16 place-items-center rounded-full transition-all duration-200 active:scale-95', recording ? 'bg-[#c27745] shadow-[0_0_0_9px_rgba(194,119,69,0.14)]' : 'bg-[#435149] hover:bg-[#53635a]')} aria-label={recording ? 'Stop recording' : 'Start recording'}><Mic className={cn('size-6', recording && 'animate-pulse')} />{recording && <><span className="absolute inset-[-8px] animate-ping rounded-full border border-[#c27745]/50" /><span className="absolute inset-[-3px] rounded-full border border-[#c27745]/40" /></>}</button>{recording ? <div className="flex items-center gap-1" aria-label="Recording waveform">{waveform.map((height, index) => <span key={index} className="w-1 rounded-full bg-[#d79b72] transition-all" style={{ height: `${height}px`, animation: `pulse 900ms ${index * 40}ms ease-in-out infinite alternate` }} />)}</div> : <span className="text-xs text-white/45">Speak your brief</span>}</div><div className="flex items-center gap-3"><button onClick={() => inputRef.current?.click()} className="hidden items-center gap-2 rounded-full px-3 py-2 text-xs text-white/55 transition-colors hover:bg-white/10 hover:text-white sm:flex"><Paperclip className="size-4" /> Add video</button><button onClick={beginGeneration} disabled={!canGenerate || isGenerating} className="grid size-12 place-items-center rounded-full bg-[#e4d8c9] text-[#242321] transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-30" aria-label="Generate first cut">{isGenerating ? <span className="size-4 animate-spin rounded-full border-2 border-[#242321]/30 border-t-[#242321]" /> : <Send className="size-5" />}</button></div></div>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">{prompts.map((prompt) => <button key={prompt} onClick={() => setBrief(prompt + ' with a warm, natural rhythm')} className="rounded-full border border-[#dedad3] bg-white/60 px-3 py-1.5 text-xs text-[#77736d] transition-all hover:-translate-y-0.5 hover:border-[#c9c1b6] hover:bg-white">{prompt}</button>)}</div>
        </div>}
      </section>
    </main>
  )
}

export function ProcessingScreen() {
  const stages = ['Uploading footage', 'Extracting metadata and keyframes', 'Analysing scenes and audio', 'Understanding your brief', 'Matching requested shots', 'Constructing the editing timeline']
  const [active, setActive] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setActive((current) => Math.min(current + 1, stages.length - 1)), 950)
    return () => window.clearInterval(timer)
  }, [])
  return <main className="min-h-screen bg-[#242321] px-6 py-8 text-[#f7f5f1] sm:px-10"><header className="mx-auto flex max-w-6xl items-center justify-center"><a href="/" className="font-serif text-[22px] font-bold tracking-[-0.02em]">Smart Rough Cut</a></header><section className="mx-auto grid max-w-6xl gap-10 py-20 lg:grid-cols-[1fr_0.8fr] lg:items-center"><div><h1 className="max-w-xl font-serif text-5xl leading-none tracking-[-0.05em] sm:text-7xl">Finding the story<br /><em className="font-normal text-[#cfa47c]">inside your footage.</em></h1><p className="mt-7 max-w-md text-sm leading-6 text-white/50">Smart Rough Cut is reading the room, listening for the rhythm, and assembling the moments that make your brief feel real.</p><button disabled={active !== stages.length - 1} onClick={() => { window.location.href = '/project/editor' }} className="mt-9 flex items-center gap-2 rounded-full bg-[#e4d8c9] px-5 py-3 text-sm font-semibold text-[#242321] transition-opacity disabled:cursor-not-allowed disabled:opacity-35">Open editor <ArrowUpRight className="size-4" /></button></div><div className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5"><div className="mb-5 flex items-center justify-between"><span className="text-xs font-medium text-white/45">Analysis pipeline</span><span className="text-xs text-[#cfa47c]">{active === stages.length - 1 ? 'Ready' : 'In progress'}</span></div><div className="flex flex-col gap-1">{stages.map((stage, index) => <div key={stage} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors"><span className={cn('grid size-7 shrink-0 place-items-center rounded-full border text-xs', index < active ? 'border-[#849e7a] bg-[#849e7a] text-[#242321]' : index === active ? 'border-[#c27745] text-[#c27745]' : 'border-white/15 text-white/25')}>{index < active ? <Check className="size-3.5" /> : index + 1}</span><span className={cn('text-sm', index < active ? 'text-white/70' : index === active ? 'font-medium text-white' : 'text-white/30')}>{stage}</span></div>)}</div><div className="mt-5 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#c27745] transition-all duration-500" style={{ width: `${((active + 1) / stages.length) * 100}%` }} /></div></div></section></main>
}
