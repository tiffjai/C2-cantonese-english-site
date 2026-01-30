'use client';

import { useState, useCallback, useMemo } from 'react';
import type { SimplifyChunk, VocabTerm } from '@/lib/types';
import styles from './SimplifiedText.module.css';

interface SimplifiedTextProps {
    chunks: SimplifyChunk[];
    vocabMap: Record<string, VocabTerm>;
}

type TokenPart = string | { id: string; surface: string };

/**
 * Parse [[id|text]] tokens from simplified text
 * Returns array of strings and token objects
 */
function parseTokens(text: string): TokenPart[] {
    const regex = /\[\[([^|\]]+)\|([^\]]+)\]\]/g;
    const parts: TokenPart[] = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        // Add text before this token
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }
        // Add token object
        parts.push({ id: match[1], surface: match[2] });
        lastIndex = regex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }

    return parts;
}

interface ToggleableTermProps {
    termId: string;
    chunkId: number;
    vocabTerm: VocabTerm;
    isToggled: boolean;
    onToggle: () => void;
}

function ToggleableTerm({ termId, chunkId, vocabTerm, isToggled, onToggle }: ToggleableTermProps) {
    const [showTooltip, setShowTooltip] = useState(false);

    const displayText = isToggled ? vocabTerm.difficult_surface : vocabTerm.simple_surface;

    return (
        <span
            className={`${styles.term} ${isToggled ? styles.termToggled : ''}`}
            onClick={onToggle}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle();
                }
            }}
            aria-label={`Toggle between simple and difficult word. Currently showing: ${displayText}`}
        >
            {displayText}
            {showTooltip && (
                <span className={styles.tooltip}>
                    <span className={styles.tooltipMeaning}>{vocabTerm.meaning_plain}</span>
                    {vocabTerm.pos && <span className={styles.tooltipPos}>({vocabTerm.pos})</span>}
                    <span className={styles.tooltipHint}>
                        {isToggled ? 'Click for simple word' : 'Click for original word'}
                    </span>
                </span>
            )}
        </span>
    );
}

interface ChunkRendererProps {
    chunk: SimplifyChunk;
    vocabMap: Record<string, VocabTerm>;
    toggledTerms: Set<string>;
    onToggle: (chunkId: number, termId: string) => void;
}

function ChunkRenderer({ chunk, vocabMap, toggledTerms, onToggle }: ChunkRendererProps) {
    const tokens = useMemo(() => parseTokens(chunk.simple), [chunk.simple]);

    return (
        <>
            {tokens.map((token, index) => {
                if (typeof token === 'string') {
                    return <span key={index}>{token}</span>;
                }

                const vocabTerm = vocabMap[token.id];
                if (!vocabTerm) {
                    // Fallback if term not found in vocab_map
                    return <span key={index}>{token.surface}</span>;
                }

                const key = `${chunk.id}-${token.id}`;
                const isToggled = toggledTerms.has(key);

                return (
                    <ToggleableTerm
                        key={index}
                        termId={token.id}
                        chunkId={chunk.id}
                        vocabTerm={vocabTerm}
                        isToggled={isToggled}
                        onToggle={() => onToggle(chunk.id, token.id)}
                    />
                );
            })}
        </>
    );
}

export default function SimplifiedText({ chunks, vocabMap }: SimplifiedTextProps) {
    const [toggledTerms, setToggledTerms] = useState<Set<string>>(new Set());

    const handleToggle = useCallback((chunkId: number, termId: string) => {
        const key = `${chunkId}-${termId}`;
        setToggledTerms(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }, []);

    const toggleAll = useCallback((showDifficult: boolean) => {
        if (showDifficult) {
            // Show all difficult words
            const allKeys = new Set<string>();
            chunks.forEach(chunk => {
                chunk.vocab_ids.forEach(termId => {
                    allKeys.add(`${chunk.id}-${termId}`);
                });
            });
            setToggledTerms(allKeys);
        } else {
            // Show all simple words
            setToggledTerms(new Set());
        }
    }, [chunks]);

    const totalTerms = useMemo(() => {
        return chunks.reduce((sum, chunk) => sum + chunk.vocab_ids.length, 0);
    }, [chunks]);

    return (
        <div className={styles.container}>
            <div className={styles.controls}>
                <span className={styles.termCount}>
                    {totalTerms} vocabulary terms highlighted
                </span>
                <div className={styles.toggleButtons}>
                    <button
                        className={styles.toggleBtn}
                        onClick={() => toggleAll(false)}
                        title="Show all simplified words"
                    >
                        Show Simple
                    </button>
                    <button
                        className={styles.toggleBtn}
                        onClick={() => toggleAll(true)}
                        title="Show all original difficult words"
                    >
                        Show Original
                    </button>
                </div>
            </div>

            <div className={styles.columns}>
                {/* Left column: Simplified text */}
                <div className={styles.column}>
                    <h3 className={styles.columnTitle}>Simplified (B1)</h3>
                    <div className={styles.textContent}>
                        {chunks.map((chunk, index) => (
                            <p key={chunk.id} className={styles.chunk}>
                                <ChunkRenderer
                                    chunk={chunk}
                                    vocabMap={vocabMap}
                                    toggledTerms={toggledTerms}
                                    onToggle={handleToggle}
                                />
                            </p>
                        ))}
                    </div>
                </div>

                {/* Right column: Original text */}
                <div className={styles.column}>
                    <h3 className={styles.columnTitle}>Original (C2)</h3>
                    <div className={styles.textContent}>
                        {chunks.map((chunk) => (
                            <p key={chunk.id} className={styles.chunk}>
                                {chunk.original}
                            </p>
                        ))}
                    </div>
                </div>
            </div>

            {/* Vocabulary Reference */}
            <details className={styles.vocabReference}>
                <summary>Vocabulary Reference ({Object.keys(vocabMap).length} terms)</summary>
                <div className={styles.vocabGrid}>
                    {Object.entries(vocabMap).map(([id, term]) => (
                        <div key={id} className={styles.vocabItem}>
                            <div className={styles.vocabTerms}>
                                <span className={styles.simpleTerm}>{term.simple_surface}</span>
                                <span className={styles.arrow}>→</span>
                                <span className={styles.difficultTerm}>{term.difficult_surface}</span>
                            </div>
                            <div className={styles.vocabMeaning}>{term.meaning_plain}</div>
                            {term.pos && <div className={styles.vocabPos}>{term.pos}</div>}
                        </div>
                    ))}
                </div>
            </details>
        </div>
    );
}
