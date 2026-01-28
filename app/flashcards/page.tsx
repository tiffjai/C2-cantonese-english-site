'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Flashcard from '@/components/Flashcard';
import { VocabularyWord, CEFRLevel, CEFR_LEVELS } from '@/lib/types';
import { loadVocabulary, filterByLevel, getRandomWords } from '@/lib/csvParser';
import { useProgress } from '@/contexts/ProgressContext';
import styles from './page.module.css';

export default function FlashcardsPage() {
    const searchParams = useSearchParams();
    const initialLevel = (searchParams.get('level') as CEFRLevel) || 'C2';

    const [allWords, setAllWords] = useState<VocabularyWord[]>([]);
    const [currentWords, setCurrentWords] = useState<VocabularyWord[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [selectedLevel, setSelectedLevel] = useState<CEFRLevel>(initialLevel);
    const [loading, setLoading] = useState(true);
    const [wordsPerSession] = useState(10);

    const { addLearnedWord, progress } = useProgress();

    useEffect(() => {
        async function loadWords() {
            setLoading(true);
            const words = await loadVocabulary();
            setAllWords(words);
            setLoading(false);
        }
        loadWords();
    }, []);

    useEffect(() => {
        if (allWords.length > 0) {
            const levelWords = filterByLevel(allWords, selectedLevel);
            const sessionWords = getRandomWords(levelWords, wordsPerSession);
            setCurrentWords(sessionWords);
            setCurrentIndex(0);
        }
    }, [allWords, selectedLevel, wordsPerSession]);

    const handleNext = () => {
        if (currentIndex < currentWords.length - 1) {
            setCurrentIndex(currentIndex + 1);
        }
    };

    const handlePrevious = () => {
        if (currentIndex > 0) {
            setCurrentIndex(currentIndex - 1);
        }
    };

    const handleMarkLearned = () => {
        if (currentWords[currentIndex]) {
            addLearnedWord(currentWords[currentIndex].id);
            handleNext();
        }
    };

    const handleLevelChange = (level: CEFRLevel) => {
        setSelectedLevel(level);
    };

    const handleNewSession = () => {
        if (allWords.length > 0) {
            const levelWords = filterByLevel(allWords, selectedLevel);
            const sessionWords = getRandomWords(levelWords, wordsPerSession);
            setCurrentWords(sessionWords);
            setCurrentIndex(0);
        }
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.loading}>
                    <div className={styles.spinner}></div>
                    <p>載入詞彙中...</p>
                </div>
            </div>
        );
    }

    const currentWord = currentWords[currentIndex];

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1>閃卡學習模式</h1>
                <p className={styles.subtitle}>
                    已學習 {progress.wordsLearned.size} 個單詞
                </p>
            </div>

            <div className={styles.levelSelector}>
                {CEFR_LEVELS.map((level) => (
                    <button
                        key={level}
                        onClick={() => handleLevelChange(level)}
                        className={`${styles.levelButton} ${selectedLevel === level ? styles.active : ''
                            }`}
                    >
                        {level}
                    </button>
                ))}
            </div>

            {currentWord ? (
                <>
                    <div className={styles.progress}>
                        <div className={styles.progressBar}>
                            <div
                                className={styles.progressFill}
                                style={{
                                    width: `${((currentIndex + 1) / currentWords.length) * 100}%`,
                                }}
                            />
                        </div>
                        <p className={styles.progressText}>
                            {currentIndex + 1} / {currentWords.length}
                        </p>
                    </div>

                    <Flashcard
                        word={currentWord}
                        onMarkLearned={handleMarkLearned}
                    />

                    <div className={styles.navigation}>
                        <button
                            onClick={handlePrevious}
                            disabled={currentIndex === 0}
                            className="btn-secondary"
                        >
                            ← 上一張
                        </button>
                        <button
                            onClick={handleNewSession}
                            className="btn-secondary"
                        >
                            🔄 新一組
                        </button>
                        <button
                            onClick={handleNext}
                            disabled={currentIndex === currentWords.length - 1}
                            className="btn-secondary"
                        >
                            下一張 →
                        </button>
                    </div>
                </>
            ) : (
                <div className={styles.empty}>
                    <p>沒有找到單詞</p>
                    <button onClick={handleNewSession} className="btn-primary">
                        重新載入
                    </button>
                </div>
            )}
        </div>
    );
}
