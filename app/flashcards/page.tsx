'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Flashcard from '@/components/Flashcard';
import { VocabularyWord, CEFRLevel, CEFR_LEVELS } from '@/lib/types';
import { filterByLevel, getRandomWords } from '@/lib/csvParser';
import { loadLevelWords, getCachedLevel } from '@/lib/vocabClient';
import { enrichWords } from '@/lib/enrichment';
import { useProgress } from '@/contexts/ProgressContext';
import RequireAuth from '@/components/RequireAuth';
import { FlashcardSkeleton, ErrorState } from '@/components/AsyncState';
import { saveLastSession, loadLastSession, LastSession } from '@/lib/clientStorage';
import styles from './page.module.css';
import AiClozeGenerator from '@/components/AiClozeGenerator';

function FlashcardsPageContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialLevel = (searchParams.get('level') as CEFRLevel) || 'C2';

    const [allWords, setAllWords] = useState<VocabularyWord[]>([]);
    const [currentWords, setCurrentWords] = useState<VocabularyWord[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [selectedLevel, setSelectedLevel] = useState<CEFRLevel>(initialLevel);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [hasOfflineCache, setHasOfflineCache] = useState(false);
    const [pendingRestore, setPendingRestore] = useState<LastSession | null>(null);
    const [enriching, setEnriching] = useState(false);
    const [wordsPerSession] = useState(10);
    const [notice, setNotice] = useState<string | null>(null);

    const { addLearnedWord, progress } = useProgress();

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const session = loadLastSession();
        if (session?.mode === 'flashcards') {
            setSelectedLevel(session.level);
            setPendingRestore(session);
        }
    }, []);

    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        setLoading(true);
        setLoadError(null);

        (async () => {
            const cached = await getCachedLevel(selectedLevel);
            if (!active) return;

            const hasCache = Boolean(cached.entry);
            setHasOfflineCache(hasCache);

            if (cached.entry && !cached.stale) {
                setAllWords(cached.entry.words);
                setLoading(false);
            }

            try {
                const result = await loadLevelWords(selectedLevel, {
                    signal: controller.signal,
                    preferCache: !cached.entry,
                });
                if (!active) return;
                setAllWords(result.words);
                setLoading(false);
            } catch (error) {
                if (!active) return;
                setLoadError('詞彙下載失敗，請檢查網絡連線後重試。');
                setLoading(false);
            }
        })();

        return () => {
            active = false;
            controller.abort();
        };
    }, [selectedLevel, reloadToken]);

    useEffect(() => {
        const controller = new AbortController();
        async function buildSession() {
            // Restore previous session if available
            if (pendingRestore?.mode === 'flashcards' && pendingRestore.level === selectedLevel) {
                const savedWords = pendingRestore.payload?.flashcards?.words;
                if (savedWords && savedWords.length > 0) {
                    const restoredIndex = Math.min(pendingRestore.index, savedWords.length - 1);
                    setCurrentWords(savedWords);
                    setCurrentIndex(restoredIndex);
                    setNotice('已恢復上次進度');
                    saveLastSession({
                        ...pendingRestore,
                        index: restoredIndex,
                        timestamp: new Date().toISOString(),
                    });
                    setPendingRestore(null);
                    return;
                }
                setPendingRestore(null);
            }

            if (allWords.length === 0) return;

            const levelWords = filterByLevel(allWords, selectedLevel);
            if (levelWords.length === 0) return;

            setEnriching(true);
            setNotice(null);
            const candidateCount = Math.min(levelWords.length, wordsPerSession * 3 + 10);
            const sessionCandidates = getRandomWords(levelWords, candidateCount);

            // Optimistically show raw cards
            setCurrentWords(sessionCandidates.slice(0, wordsPerSession));
            setCurrentIndex(0);
            saveLastSession({
                mode: 'flashcards',
                level: selectedLevel,
                index: 0,
                timestamp: new Date().toISOString(),
                payload: { flashcards: { words: sessionCandidates.slice(0, wordsPerSession) } },
            });

            try {
                const enriched = await enrichWords(sessionCandidates);
                if (controller.signal.aborted) return;

                const translated = enriched.filter(w => w.cantonese && w.cantonese.trim().length > 0);
                if (translated.length === 0) {
                    setNotice('未能取得粵語翻譯，請再試一次或更換級別。');
                    setCurrentWords([]);
                    return;
                }

                if (translated.length < wordsPerSession) {
                    setNotice(`只找到 ${translated.length} 張包含粵語翻譯的卡片。`);
                }

                const nextWords = translated.slice(0, wordsPerSession);
                setCurrentWords(nextWords);
                setCurrentIndex(0);
                saveLastSession({
                    mode: 'flashcards',
                    level: selectedLevel,
                    index: 0,
                    timestamp: new Date().toISOString(),
                    payload: { flashcards: { words: nextWords } },
                });
            } finally {
                if (!controller.signal.aborted) setEnriching(false);
            }
        }

        buildSession();
        return () => controller.abort();
    }, [allWords, pendingRestore, selectedLevel, wordsPerSession]);

    const persistSessionState = useCallback((words: VocabularyWord[], index: number) => {
        saveLastSession({
            mode: 'flashcards',
            level: selectedLevel,
            index,
            timestamp: new Date().toISOString(),
            payload: { flashcards: { words } },
        });
    }, [selectedLevel]);

    const handleNext = () => {
        if (currentIndex < currentWords.length - 1) {
            const nextIndex = currentIndex + 1;
            setCurrentIndex(nextIndex);
            persistSessionState(currentWords, nextIndex);
        }
    };

    const handlePrevious = () => {
        if (currentIndex > 0) {
            const prevIndex = currentIndex - 1;
            setCurrentIndex(prevIndex);
            persistSessionState(currentWords, prevIndex);
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
        setPendingRestore(null);
    };

    const handleNewSession = () => {
        if (allWords.length === 0) return;

        const levelWords = filterByLevel(allWords, selectedLevel);
        const candidateCount = Math.min(levelWords.length, wordsPerSession * 3 + 10);
        const sessionCandidates = getRandomWords(levelWords, candidateCount);

        setEnriching(true);
        setNotice(null);
        const initialSlice = sessionCandidates.slice(0, wordsPerSession);
        setCurrentWords(initialSlice);
        setCurrentIndex(0);
        persistSessionState(initialSlice, 0);

        enrichWords(sessionCandidates).then(enriched => {
            const translated = enriched.filter(w => w.cantonese && w.cantonese.trim().length > 0);
            if (translated.length === 0) {
                setNotice('未能取得粵語翻譯，請再試一次或更換級別。');
                setCurrentWords([]);
            } else {
                if (translated.length < wordsPerSession) {
                    setNotice(`只找到 ${translated.length} 張包含粵語翻譯的卡片。`);
                }
                const nextWords = translated.slice(0, wordsPerSession);
                setCurrentWords(nextWords);
                setCurrentIndex(0);
                persistSessionState(nextWords, 0);
            }
        }).finally(() => setEnriching(false));
    };

    const handleRetry = () => {
        setLoadError(null);
        setLoading(true);
        setAllWords([]);
        setReloadToken((token) => token + 1);
    };

    const handleUseOffline = async () => {
        const cached = await getCachedLevel(selectedLevel);
        if (cached.entry) {
            setAllWords(cached.entry.words);
            setLoadError(null);
            setLoading(false);
        }
    };

    if (loading && allWords.length === 0) {
        return <FlashcardSkeleton ctaLabel="載入詞彙中" />;
    }

    if (loadError && allWords.length === 0) {
        return (
            <ErrorState
                message={loadError}
                onRetry={handleRetry}
                onUseOffline={handleUseOffline}
                showOffline={hasOfflineCache}
            />
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

                    {enriching && (
                        <div className={styles.helperText}>翻譯與例句載入中…</div>
                    )}
                    {notice && (
                        <div className={styles.helperText}>{notice}</div>
                    )}

                    <AiClozeGenerator
                        word={currentWord.headword}
                        level={selectedLevel}
                        pos={currentWord.pos}
                        meaning={currentWord.cantonese}
                        distractors={currentWords
                            .map((word) => word.headword)
                            .filter((headword) => headword && headword !== currentWord.headword)}
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
                            onClick={() => router.push('/')}
                            className="btn-secondary"
                        >
                            🏠 返回主頁
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
                    <p>沒有找到含粵語翻譯的單詞</p>
                    {notice && <p className={styles.helperText}>{notice}</p>}
                    <button onClick={handleNewSession} className="btn-primary">
                        重新載入
                    </button>
                </div>
            )}
        </div>
    );
}

export default function FlashcardsPage() {
    return (
        <Suspense fallback={
            <FlashcardSkeleton ctaLabel="載入詞彙中" />
        }>
            <RequireAuth>
                <FlashcardsPageContent />
            </RequireAuth>
        </Suspense>
    );
}
