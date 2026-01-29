'use client'

import { useEffect, useMemo, useState } from 'react'
import styles from './page.module.css'

type Sense = { pos: string; zh: string }
type Entry = {
    id: number
    word: string
    ipa: string
    senses: Sense[]
    examples: string[]
}

const getEndpoint = () => {
    if (process.env.NEXT_PUBLIC_TTS_ENDPOINT) return process.env.NEXT_PUBLIC_TTS_ENDPOINT
    if (typeof window !== 'undefined') {
        const { protocol, hostname } = window.location
        return `${protocol}//${hostname}:5005/speak`
    }
    return 'http://127.0.0.1:5005/speak'
}

// Extract the leading英文片段；英語模型處理中文會重複/怪音，因此只送出第一段英文字。
// 若完全沒有英文，返回空字串以便 fallback。
const extractEnglish = (t: string) => {
    const firstCJK = t.search(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u)
    const slice = firstCJK === -1 ? t : t.slice(0, firstCJK)
    return slice.replace(/[，。！？、【】（）《》〈〉「」『』：；·]/g, ' ').trim()
}

async function speak(text: string, setVoiceSource?: (v: 'coqui' | 'browser' | 'idle') => void) {
    if (!text) return
    const coquiText = extractEnglish(text)
    // 1) try local Coqui server
    try {
        const res = await fetch(getEndpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: coquiText || text }),
        })
        if (res.ok) {
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            await audio.play()
            setVoiceSource?.('coqui')
            return
        }
    } catch (_) {
        // fall back to browser TTS
    }
    // 2) fallback: browser speech synthesis
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        const utter = new SpeechSynthesisUtterance(text)
        // let瀏覽器自動偵測語言；若只剩英文會用預設 en-US。
        utter.rate = 1.0
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(utter)
        setVoiceSource?.('browser')
    }
}

export default function TTSFlashcards() {
    const [items, setItems] = useState<Entry[]>([])
    const [current, setCurrent] = useState<Entry | null>(null)
    const [idx, setIdx] = useState(0)
    const [search, setSearch] = useState('')
    const [voiceSource, setVoiceSource] = useState<'coqui' | 'browser' | 'idle'>('idle')

    useEffect(() => {
        fetch('/vocab.json', { cache: 'no-store' })
            .then((r) => r.json())
            .then((d) => {
                const list = (d.items as Entry[]) || []
                setItems(list)
                setIdx(0)
                setCurrent(list[0] ?? null)
            })
            .catch(console.error)
    }, [])

    useEffect(() => {
        setCurrent(items[idx] ?? null)
    }, [idx, items])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return items
        return items.filter(
            (e) =>
                e.word.toLowerCase().includes(q) ||
                e.senses.some((s) => s.zh.includes(q)) ||
                e.examples.some((ex) => ex.toLowerCase().includes(q))
        )
    }, [items, search])

    const jumpTo = (id: number) => {
        const pos = items.findIndex((e) => e.id === id)
        if (pos >= 0) setIdx(pos)
    }

    const next = () => setIdx((i) => (i + 1) % Math.max(items.length, 1))
    const prev = () => setIdx((i) => (i - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1))
    const shuffle = () => setIdx(Math.floor(Math.random() * Math.max(items.length, 1)))

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div>
                    <div className={styles.title}>發音閃卡 | vocabulary_complete.md</div>
                    <div>含 {items.length} 條單字，可搜尋與文字轉語音。</div>
                </div>
                <div className={styles.controls}>
                    <button className={`${styles.btn} ${styles.primary}`} onClick={() => speak(current?.word ?? '', setVoiceSource)}>
                        🔊 讀單字
                    </button>
                    <button className={styles.btn} onClick={() => current?.examples[0] && speak(current.examples[0], setVoiceSource)}>
                        🗣️ 讀例句
                    </button>
                    <span className={styles.badge}>
                        聲源：{voiceSource === 'coqui' ? 'Coqui (本機)' : voiceSource === 'browser' ? '瀏覽器 TTS' : '未播放'}
                    </span>
                </div>
            </div>

            <div className={styles.card}>
                {current ? (
                    <>
                        <div className={styles.wordLine}>
                            <span className={styles.word}>{current.word}</span>
                            {current.ipa && <span className={styles.ipa}>[{current.ipa}]</span>}
                            <span className={styles.tag}>#{current.id.toString().padStart(3, '0')}</span>
                        </div>
                        <div className={styles.senses}>
                            {current.senses.map((s, i) => (
                                <div key={i} className={styles.sense}>
                                    <strong>{s.pos}</strong> {s.zh}
                                </div>
                            ))}
                        </div>
                        <div className={styles.examples}>
                            {current.examples.map((ex, i) => (
                                <div key={i}>· {ex}</div>
                            ))}
                        </div>
                    </>
                ) : (
                    '載入中…'
                )}
                <div className={styles.controls}>
                    <button className={styles.btn} onClick={prev}>
                        ◀︎ 上一張
                    </button>
                    <button className={styles.btn} onClick={next}>
                        下一張 ▶︎
                    </button>
                    <button className={styles.btn} onClick={shuffle}>
                        🎲 隨機
                    </button>
                </div>
                <div className={styles.progressDots}>
                    {[...Array(Math.min(10, Math.max(items.length, 1)))]
                        .map((_, i) => (Math.floor((idx / Math.max(items.length, 1)) * 10) === i ? 1 : 0))
                        .map((active, i) => (
                            <span key={i} className={`${styles.dot} ${active ? styles.active : ''}`} />
                        ))}
                </div>
            </div>

            <div className={styles.list}>
                <input
                    className={styles.listSearch}
                    placeholder="搜尋英文 / 中文 / 例句片段"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                {filtered.map((e) => (
                    <div key={e.id} className={styles.listItem} onClick={() => jumpTo(e.id)}>
                        <span>{e.word}</span>
                        <div className={styles.meta}>
                            {e.ipa && <span className={styles.ipa}>[{e.ipa}]</span>}
                            <span className={styles.tag}>#{e.id}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
