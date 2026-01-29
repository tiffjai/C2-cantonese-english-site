'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from '@/lib/three.module.js'
import styles from './page.module.css'

let sceneRefGlobal: THREE.Scene | null = null


type Sense = { pos: string; zh: string }
type Vocab = {
    id: number
    word: string
    ipa: string
    senses: Sense[]
    examples: string[]
}

type Option = { label: string; isCorrect: boolean }

async function fetchVocab(): Promise<Vocab[]> {
    const res = await fetch('/vocab.json', { cache: 'no-store' })
    const data = await res.json()
    return (data.items as Vocab[]) ?? []
}

function makeTextTexture(text: string) {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 256
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
    gradient.addColorStop(0, '#0a1a2f')
    gradient.addColorStop(1, '#122f4f')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#3ef3ff'
    ctx.shadowColor = '#00c2ff'
    ctx.shadowBlur = 12
    ctx.font = 'bold 48px "Segoe UI", "Noto Sans TC", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const wrapped = text.slice(0, 28)
    ctx.fillText(wrapped, canvas.width / 2, canvas.height / 2)
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
}

export default function VocabGamePage() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const [vocab, setVocab] = useState<Vocab[]>([])
    const [current, setCurrent] = useState<Vocab | null>(null)
    const [options, setOptions] = useState<Option[]>([])
    const [status, setStatus] = useState<'idle' | 'correct' | 'wrong' | 'timeout'>('idle')
    const [score, setScore] = useState({ correct: 0, wrong: 0, streak: 0, points: 0 })
    const [timeLeft, setTimeLeft] = useState(12)
    const sceneRef = useRef<THREE.Scene>()
    const cameraRef = useRef<THREE.PerspectiveCamera>()
    const rendererRef = useRef<THREE.WebGLRenderer>()
    const cubesRef = useRef<THREE.Mesh[]>([])
    const raycaster = useMemo(() => new THREE.Raycaster(), [])
    const mouse = useMemo(() => new THREE.Vector2(), [])
    const timerRef = useRef<NodeJS.Timeout>()
    const audioCtxRef = useRef<AudioContext | null>(null)

    useEffect(() => {
        fetchVocab().then((items) => {
            setVocab(items)
            pickNext(items)
        })
    }, [])

    // countdown timer
    useEffect(() => {
        if (status !== 'idle') return
        clearInterval(timerRef.current as any)
        setTimeLeft(12)
        timerRef.current = setInterval(() => {
            setTimeLeft((t) => {
                if (t <= 1) {
                    clearInterval(timerRef.current as any)
                    setStatus('timeout')
                    setScore((s) => ({ ...s, wrong: s.wrong + 1, streak: 0 }))
                    setTimeout(() => pickNext(), 700)
                    return 0
                }
                return t - 1
            })
        }, 1000)
        return () => clearInterval(timerRef.current as any)
    }, [status])

    useEffect(() => {
        if (!canvasRef.current) return
        const canvas = canvasRef.current
        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(55, canvas.clientWidth / canvas.clientHeight, 0.1, 1000)
        camera.position.set(0, 2.2, 5.5)
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
        renderer.setSize(canvas.clientWidth, canvas.clientHeight)
        renderer.setPixelRatio(window.devicePixelRatio || 1)

        const ambient = new THREE.AmbientLight(0xffffff, 1.1)
        scene.add(ambient)
        const dir = new THREE.DirectionalLight(0xa0d8ff, 1.1)
        dir.position.set(2, 5, 4)
        const rim = new THREE.PointLight(0x66ffdd, 0.6, 10)
        rim.position.set(-3, 3, -2)
        scene.add(dir)
        scene.add(rim)

        sceneRef.current = scene
        sceneRefGlobal = scene
        cameraRef.current = camera
        rendererRef.current = renderer

        const handleResize = () => {
            if (!canvasRef.current || !cameraRef.current || !rendererRef.current) return
            const { clientWidth, clientHeight } = canvasRef.current
            cameraRef.current.aspect = clientWidth / clientHeight
            cameraRef.current.updateProjectionMatrix()
            rendererRef.current.setSize(clientWidth, clientHeight)
        }
        window.addEventListener('resize', handleResize)

        let frame: number
        const animate = () => {
            frame = requestAnimationFrame(animate)
            cubesRef.current.forEach((cube, idx) => {
                cube.rotation.y += 0.01 + idx * 0.001
                cube.rotation.x += 0.005
            })
            renderer.render(scene, camera)
        }
        animate()

        return () => {
            window.removeEventListener('resize', handleResize)
            cancelAnimationFrame(frame)
            renderer.dispose()
        }
    }, [])

    const pickNext = (list = vocab) => {
        if (!list.length) return
        const pool = list.filter((e) => e.senses?.length)
        const next = pool[Math.floor(Math.random() * pool.length)]
        const correctMeaning = next.senses[0]?.zh ?? '（無中文釋義）'
        const distractors = shuffle(
            pool
                .filter((e) => e.word !== next.word)
                .slice(0, 60)
                .map((e) => e.senses[0]?.zh ?? e.word)
        )
            .filter(Boolean)
            .slice(0, 3)
        const optionSet = shuffle([
            { label: correctMeaning, isCorrect: true },
            ...distractors.map((d) => ({ label: d, isCorrect: false })),
        ])
        setCurrent(next)
        setOptions(optionSet)
        setStatus('idle')
        updateCubes(optionSet)
        setTimeLeft(12)
    }

    const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5)

    const updateCubes = (optionSet: Option[]) => {
        if (!sceneRef.current) return
        // clear old
        cubesRef.current.forEach((cube) => sceneRef.current!.remove(cube))
        cubesRef.current = []

        const radius = 2.4
        optionSet.forEach((opt, i) => {
            const angle = (i / optionSet.length) * Math.PI * 2
            const geo = new THREE.BoxGeometry(1.35, 0.85, 0.3, 2, 2, 2)
            const tex = makeTextTexture(opt.label)
            const mat = new THREE.MeshStandardMaterial({
                map: tex,
                roughness: 0.35,
                metalness: 0.25,
                emissive: new THREE.Color(0x0c1e35),
                emissiveIntensity: 0.08,
            })
            const mesh = new THREE.Mesh(geo, mat)
            mesh.position.set(Math.cos(angle) * radius, 0.9, Math.sin(angle) * radius)
            mesh.lookAt(0, 0.9, 0)
            mesh.userData = opt
            cubesRef.current.push(mesh)
            sceneRef.current!.add(mesh)
        })
    }

    const handlePick = (opt: Option) => {
        if (status !== 'idle') return
        const correct = opt.isCorrect
        setStatus(correct ? 'correct' : 'wrong')
        playTone(correct)
        if (correct) spawnBurst()
        setScore((s) => {
            const streak = correct ? s.streak + 1 : 0
            const delta = correct ? Math.max(1, streak) : 0
            return {
                correct: s.correct + (correct ? 1 : 0),
                wrong: s.wrong + (!correct ? 1 : 0),
                streak,
                points: s.points + delta,
            }
        })
        setTimeout(() => pickNext(), 800)
    }

    const onCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (!cameraRef.current || !sceneRef.current || !rendererRef.current) return
        const rect = (event.target as HTMLCanvasElement).getBoundingClientRect()
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(mouse, cameraRef.current)
        const intersects = raycaster.intersectObjects(cubesRef.current)
        if (intersects.length) {
            const opt = intersects[0].object.userData as Option
            handlePick(opt)
        }
    }

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div>
                    <div className={styles.title}>3D 單字練習場</div>
                    <div className={styles.subtitle}>依據 vocabulary_extracted.md 即時生成題目</div>
                </div>
                <div className={styles.hud}>
                    <span className={styles.badge}>詞彙數：{vocab.length || '載入中…'}</span>
                    <span className={styles.badge}>狀態：{status === 'idle' ? '作答中' : status === 'correct' ? '正確' : status === 'wrong' ? '再試一次' : '逾時'}</span>
                    <span className={styles.timer}>⏳ {timeLeft}s</span>
                </div>
            </div>

            <div className={styles.canvasShell}>
                <canvas ref={canvasRef} className={styles.canvas} onClick={onCanvasClick} />
            </div>

            <div className={styles.panel}>
                <div className={styles.question}>
                    {current ? (
                        <>
                            <span>{current.word}</span>
                            {current.ipa && <span style={{ marginLeft: '8px', color: '#00c2ff' }}>[{current.ipa}]</span>}
                        </>
                    ) : (
                        '載入中…'
                    )}
                </div>
                <div className={styles.options}>
                    {options.map((opt, i) => (
                        <button
                            key={i}
                            className={`${styles.option} ${
                                status === 'wrong' && !opt.isCorrect ? styles.wrong : ''
                            }`}
                            onClick={() => handlePick(opt)}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
                <div className={styles.footer}>
                    <button className={`${styles.btn} ${styles.primary}`} onClick={() => pickNext()}>
                        下一題
                    </button>
                    <button
                        className={`${styles.btn} ${styles.ghost}`}
                        onClick={() => setScore({ correct: 0, wrong: 0, streak: 0 })}
                    >
                        重設分數
                    </button>
                </div>
                <div className={styles.scoreCard}>
                    <div className={styles.scoreItem}>
                        <span className={styles.scoreLabel}>答對</span>
                        <span className={styles.scoreValue}>{score.correct}</span>
                    </div>
                    <div className={styles.scoreItem}>
                        <span className={styles.scoreLabel}>答錯</span>
                        <span className={styles.scoreValue}>{score.wrong}</span>
                    </div>
                    <div className={styles.scoreItem}>
                        <span className={styles.scoreLabel}>連勝</span>
                        <span className={styles.scoreValue}>{score.streak}</span>
                    </div>
                    <div className={styles.scoreItem}>
                        <span className={styles.scoreLabel}>分數</span>
                        <span className={styles.scoreValue}>{score.points}</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

// --- helpers ---

function playTone(correct: boolean) {
    if (typeof window === 'undefined') return
    const ctx = (playTone as any).ctx || new AudioContext()
    ;(playTone as any).ctx = ctx
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = correct ? 880 : 220
    gain.gain.value = 0.08
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.2)
}

function spawnBurst() {
    if (!sceneRefGlobal) return
    const count = 80
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 2
        positions[i * 3 + 1] = Math.random() * 2
        positions[i * 3 + 2] = (Math.random() - 0.5) * 2
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({ color: 0x35e29f, size: 0.08 })
    const points = new THREE.Points(geo, mat)
    points.position.set(0, 0.4, 0)
    sceneRefGlobal.add(points)
    setTimeout(() => {
        sceneRefGlobal.remove(points)
        geo.dispose()
        mat.dispose()
    }, 700)
}
