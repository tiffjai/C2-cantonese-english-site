'use client';

import { useState } from 'react';
import SimplifiedText from '@/components/SimplifiedText';
import type { SimplifyResponse } from '@/lib/types';
import styles from './page.module.css';

type Status = 'idle' | 'loading' | 'success' | 'error';

const SAMPLE_PASSAGE = `The inexorable march of technological advancement has fundamentally reconfigured the epistemological frameworks through which contemporary society apprehends reality. The proliferation of algorithmic decision-making systems has engendered unprecedented challenges to traditional notions of human agency and autonomous cognition. Scholars contend that this paradigmatic shift may precipitate a wholesale reconceptualization of what constitutes authentic human experience in an increasingly mediated world.

Furthermore, the commodification of personal data has given rise to novel forms of surveillance capitalism that operate through mechanisms largely opaque to the average citizen. These emergent power asymmetries demand rigorous interrogation, particularly as they pertain to the erosion of privacy and the subtle manipulation of consumer behavior through sophisticated predictive analytics.`;

export default function SimplifyPage() {
    const [passage, setPassage] = useState('');
    const [targetLevel, setTargetLevel] = useState<'A2' | 'B1' | 'B2'>('B1');
    const [strength, setStrength] = useState<'light' | 'medium' | 'strong'>('medium');
    const [status, setStatus] = useState<Status>('idle');
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<SimplifyResponse | null>(null);

    const handleSimplify = async () => {
        if (!passage.trim()) {
            setError('Please enter a passage to simplify');
            return;
        }

        setStatus('loading');
        setError(null);
        setResult(null);

        try {
            const response = await fetch('/api/simplify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    passage: passage.trim(),
                    target_level: targetLevel,
                    strength,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to simplify passage');
            }

            setResult(data.data);
            setStatus('success');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Something went wrong';
            setError(message);
            setStatus('error');
        }
    };

    const handleUseSample = () => {
        setPassage(SAMPLE_PASSAGE);
    };

    const handleClear = () => {
        setPassage('');
        setResult(null);
        setError(null);
        setStatus('idle');
    };

    return (
        <main className={styles.main}>
            <div className={styles.header}>
                <h1 className={styles.title}>📖 C2 Passage Simplifier</h1>
                <p className={styles.subtitle}>
                    Paste a complex C2-level passage and get a simplified version with toggleable vocabulary.
                    Click highlighted words to switch between simple and original forms.
                </p>
            </div>

            {/* Input Section */}
            <section className={styles.inputSection}>
                <div className={styles.textareaWrapper}>
                    <textarea
                        className={styles.textarea}
                        value={passage}
                        onChange={(e) => setPassage(e.target.value)}
                        placeholder="Paste your C2-level English passage here (at least 50 characters)..."
                        rows={8}
                        disabled={status === 'loading'}
                    />
                    <div className={styles.charCount}>
                        {passage.length} / 10,000 characters
                    </div>
                </div>

                <div className={styles.controls}>
                    <div className={styles.options}>
                        <div className={styles.optionGroup}>
                            <label htmlFor="targetLevel" className={styles.label}>
                                Target Level
                            </label>
                            <select
                                id="targetLevel"
                                className={styles.select}
                                value={targetLevel}
                                onChange={(e) => setTargetLevel(e.target.value as 'A2' | 'B1' | 'B2')}
                                disabled={status === 'loading'}
                            >
                                <option value="A2">A2 (Elementary)</option>
                                <option value="B1">B1 (Intermediate)</option>
                                <option value="B2">B2 (Upper-Intermediate)</option>
                            </select>
                        </div>

                        <div className={styles.optionGroup}>
                            <label htmlFor="strength" className={styles.label}>
                                Simplification Strength
                            </label>
                            <select
                                id="strength"
                                className={styles.select}
                                value={strength}
                                onChange={(e) => setStrength(e.target.value as 'light' | 'medium' | 'strong')}
                                disabled={status === 'loading'}
                            >
                                <option value="light">Light</option>
                                <option value="medium">Medium</option>
                                <option value="strong">Strong</option>
                            </select>
                        </div>
                    </div>

                    <div className={styles.buttons}>
                        <button
                            className={styles.sampleBtn}
                            onClick={handleUseSample}
                            disabled={status === 'loading'}
                            type="button"
                        >
                            📄 Use Sample
                        </button>
                        <button
                            className={styles.clearBtn}
                            onClick={handleClear}
                            disabled={status === 'loading' || (!passage && !result)}
                            type="button"
                        >
                            🗑️ Clear
                        </button>
                        <button
                            className={styles.simplifyBtn}
                            onClick={handleSimplify}
                            disabled={status === 'loading' || passage.trim().length < 50}
                            type="button"
                        >
                            {status === 'loading' ? '⏳ Simplifying...' : '✨ Simplify'}
                        </button>
                    </div>
                </div>
            </section>

            {/* Error Message */}
            {error && (
                <div className={styles.error}>
                    <span className={styles.errorIcon}>⚠️</span>
                    <span>{error}</span>
                    <button
                        className={styles.retryBtn}
                        onClick={handleSimplify}
                        disabled={status === 'loading'}
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* Loading State */}
            {status === 'loading' && (
                <div className={styles.loading}>
                    <div className={styles.spinner} />
                    <p>Analyzing and simplifying your passage...</p>
                    <p className={styles.loadingHint}>This may take 10-20 seconds</p>
                </div>
            )}

            {/* Results */}
            {result && status === 'success' && (
                <section className={styles.resultsSection}>
                    <SimplifiedText
                        chunks={result.chunks}
                        vocabMap={result.vocab_map}
                    />

                    {result.overall_notes && result.overall_notes.length > 0 && (
                        <div className={styles.notes}>
                            <h4>Notes</h4>
                            <ul>
                                {result.overall_notes.map((note, index) => (
                                    <li key={index}>{note}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </section>
            )}

            {/* Instructions */}
            {status === 'idle' && !result && (
                <section className={styles.instructions}>
                    <h3>How it works</h3>
                    <ol>
                        <li>
                            <strong>Paste a C2-level passage</strong> — Academic articles, research papers, or advanced texts work best.
                        </li>
                        <li>
                            <strong>Choose your target level</strong> — B1 is recommended for most learners.
                        </li>
                        <li>
                            <strong>Click Simplify</strong> — The AI will create a side-by-side comparison.
                        </li>
                        <li>
                            <strong>Click highlighted words</strong> — Toggle between simple and original vocabulary to learn new words in context.
                        </li>
                    </ol>
                </section>
            )}
        </main>
    );
}
