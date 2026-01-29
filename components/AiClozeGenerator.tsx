'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiOutput } from '@/workers/ai-v2.worker';
import styles from './AiClozeGenerator.module.css';

type Status = 'idle' | 'downloading' | 'generating' | 'success' | 'error';

interface AiClozeGeneratorProps {
    word: string;
    level: string;
    meaning?: string;
    distractors?: string[];
}

export default function AiClozeGenerator({ word, level, meaning, distractors }: AiClozeGeneratorProps) {
    const workerRef = useRef<Worker | null>(null);
    const [status, setStatus] = useState<Status>('idle');
    const [error, setError] = useState<string | null>(null);
    const [debugText, setDebugText] = useState<string | null>(null);
    const [result, setResult] = useState<AiOutput | null>(null);
    const [modelReady, setModelReady] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState<{ loaded: number; total: number } | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const worker = new Worker(new URL('../workers/ai-v2.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;

        worker.onmessage = (event: MessageEvent<any>) => {
            const msg = event.data;
            if (!msg || !msg.type) return;

            if (msg.type === 'status') {
                if (msg.status === 'loading-model') {
                    setStatus('downloading');
                    setDownloadProgress(null);
                } else if (msg.status === 'model-ready') {
                    setModelReady(true);
                } else if (msg.status === 'generating') {
                    setStatus('generating');
                }
                return;
            }

            if (msg.type === 'progress') {
                setDownloadProgress({ loaded: msg.loaded, total: msg.total });
                setStatus('downloading');
                return;
            }

            if (msg.type === 'result') {
                setResult(msg.payload);
                setStatus('success');
                setError(null);
                setDebugText(msg.rawText || null);
                return;
            }

            if (msg.type === 'error') {
                setError(msg.message || 'Something went wrong. Please try again.');
                setDebugText(msg.rawText || null);
                setStatus('error');
                return;
            }
        };

        return () => {
            worker.terminate();
            workerRef.current = null;
        };
    }, []);

    // Reset UI when switching words
    useEffect(() => {
        setStatus('idle');
        setError(null);
        setResult(null);
        setDebugText(null);
    }, [word]);

    const handleGenerate = () => {
        if (!workerRef.current || !word) return;
        setError(null);
        setResult(null);
        setStatus(modelReady ? 'generating' : 'downloading');
        setDownloadProgress(null);

        workerRef.current.postMessage({
            type: 'generate',
            word,
            level,
            meaning,
            distractors: distractors ?? [],
        });
    };

    const isBusy = status === 'downloading' || status === 'generating';

    const buttonLabel = useMemo(() => {
        if (status === 'downloading') return 'Downloading model…';
        if (status === 'generating') return 'Generating…';
        if (status === 'success') return '↻ Regenerate';
        return '✨ AI Generate';
    }, [status]);

    const statusLine = useMemo(() => {
        if (status === 'downloading') return 'Downloading the small on-device model (cached for future runs)…';
        if (status === 'generating') return 'Generating examples and a cloze quiz in your browser…';
        if (status === 'success') return 'Generated locally. You can regenerate for a new variant.';
        if (status === 'error') return 'Generation failed. Please retry.';
        if (modelReady) return 'Model cached. Ready to generate instantly.';
        return 'Runs fully in-browser. First run may take a few seconds to load.';
    }, [status, modelReady]);

    const answerOption = useMemo(() => {
        if (!result) return '';
        const idx = result.cloze.answer ? result.cloze.answer.charCodeAt(0) - 65 : -1;
        if (idx < 0 || idx >= result.cloze.options.length) return '';
        return result.cloze.options[idx];
    }, [result]);

    return (
        <div className={styles.card} aria-live="polite">
            <div className={styles.header}>
                <div className={styles.titleGroup}>
                    <span className={styles.eyebrow}>Browser-only AI</span>
                    <div className={styles.title}>✨ AI Generate</div>
                    <p className={styles.subtitle}>
                        Create three levelled sentences using "{word}" and a cloze quiz without leaving the page or sending data to servers.
                    </p>
                </div>
                <button
                    className={`${styles.cta} btn-primary`}
                    onClick={handleGenerate}
                    disabled={isBusy || !word}
                >
                    {buttonLabel}
                </button>
            </div>

            <div className={styles.status}>
                <span className={styles.pulse} />
                <span>{statusLine}</span>
                {modelReady && <span className={styles.badge}>Model cached</span>}
            </div>

            {error && (
                <div className={styles.error}>
                    <p>{error}</p>
                    <button className="btn-secondary" onClick={handleGenerate} disabled={isBusy}>
                        Retry
                    </button>
                </div>
            )}

            {debugText && (
                <div className={styles.debug}>
                    <div className={styles.debugTitle}>Model output</div>
                    <pre>{debugText}</pre>
                </div>
            )}

            {status === 'downloading' && downloadProgress?.total ? (
                <div className={styles.progressBar} aria-label="Model download progress">
                    <div
                        className={styles.progressFill}
                        style={{ width: `${Math.min(100, (downloadProgress.loaded / downloadProgress.total) * 100)}%` }}
                    />
                </div>
            ) : null}

            {result && status === 'success' && (
                <div className={styles.results}>
                    <div className={styles.examples}>
                        <h4>Example sentences</h4>
                        {result.examples.map((ex, idx) => (
                            <div key={`${ex.difficulty}-${idx}`} className={styles.exampleItem}>
                                <span className={styles.difficulty}>{ex.difficulty}</span>
                                <span>{ex.sentence}</span>
                            </div>
                        ))}
                    </div>

                    <div className={styles.cloze}>
                        <h4>Cloze quiz</h4>
                        <p className={styles.clozeSentence}>{result.cloze.sentence}</p>
                        <ul className={styles.options}>
                            {result.cloze.options.map((opt, index) => (
                                <li key={opt + index} className={styles.option}>
                                    <span className={styles.optionLabel}>{String.fromCharCode(65 + index)}.</span>
                                    <span>{opt}</span>
                                </li>
                            ))}
                        </ul>
                        <p className={styles.answer}>
                            Answer: {result.cloze.answer} {answerOption ? `— ${answerOption}` : ''}
                        </p>
                        <p>{result.cloze.explanation}</p>
                    </div>
                </div>
            )}
        </div>
    );
}
