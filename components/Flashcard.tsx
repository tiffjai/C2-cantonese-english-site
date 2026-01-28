'use client';

import { CSSProperties, useMemo, useState } from 'react';
import { VocabularyWord, LEVEL_INFO } from '@/lib/types';
import styles from './Flashcard.module.css';

interface FlashcardProps {
    word: VocabularyWord;
    onMarkLearned?: () => void;
    showControls?: boolean;
}

export default function Flashcard({ word, onMarkLearned, showControls = true }: FlashcardProps) {
    const [isFlipped, setIsFlipped] = useState(false);
    const levelColor = useMemo(
        () => LEVEL_INFO[word.level]?.color ?? 'var(--primary)',
        [word.level]
    );

    const handleFlip = () => {
        setIsFlipped(!isFlipped);
    };

    return (
        <div className={styles.container}>
            <div
                className={`${styles.card} ${isFlipped ? styles.flipped : ''}`}
                onClick={handleFlip}
                style={{ '--level-color': levelColor } as CSSProperties}
            >
                <div className={styles.cardInner}>
                    {/* Front Side - English Word */}
                    <div className={`${styles.cardFace} ${styles.cardFront}`}>
                        <div className={styles.levelBadge}>{word.level}</div>
                        <div className={styles.wordContainer}>
                            <h2 className={styles.word}>{word.headword}</h2>
                            <p className={styles.hint}>點擊翻轉查看解釋</p>
                        </div>
                        <div className={styles.flipIcon}>🔄</div>
                    </div>

                    {/* Back Side - Cantonese Translation */}
                    <div className={`${styles.cardFace} ${styles.cardBack}`}>
                        <div className={styles.levelBadge}>{word.level}</div>
                        <div className={styles.translationContainer}>
                            <h3 className={styles.englishWord}>{word.headword}</h3>
                            <div className={styles.translation}>
                                {word.cantonese || (
                                    <div className={styles.noTranslation}>
                                        <p>粵語翻譯即將推出</p>
                                        <p className={styles.placeholder}>Translation coming soon</p>
                                    </div>
                                )}
                            </div>
                            <div className={styles.examples}>
                                <h4>例句：</h4>
                                {(word.examples && word.examples.length > 0 ? word.examples : ['暫未找到例句']).map((example, index) => (
                                    <p key={index} className={styles.example}>
                                        {example}
                                    </p>
                                ))}
                            </div>
                        </div>
                        <div className={styles.flipIcon}>🔄</div>
                    </div>
                </div>
            </div>

            {showControls && onMarkLearned && (
                <div className={styles.controls}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onMarkLearned();
                        }}
                        className="btn-primary"
                    >
                        ✓ 已學會
                    </button>
                </div>
            )}
        </div>
    );
}
