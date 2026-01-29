'use client';

import { Suspense, useState, useEffect, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { VocabularyWord, QuizQuestion, CEFRLevel, CEFR_LEVELS } from '@/lib/types';
import { filterByLevel, getRandomWords } from '@/lib/csvParser';
import { generateQuiz, calculateScore } from '@/lib/quizGenerator';
import { enrichWords } from '@/lib/enrichment';
import { useProgress } from '@/contexts/ProgressContext';
import RequireAuth from '@/components/RequireAuth';
import { loadLevelWords, getCachedLevel } from '@/lib/vocabClient';
import { QuizSkeleton, ErrorState } from '@/components/AsyncState';
import { getWrongQueue, updateWrongQueue, saveLastSession, loadLastSession } from '@/lib/clientStorage';
import styles from './page.module.css';

function QuizPageContent() {
    const [allWords, setAllWords] = useState<VocabularyWord[]>([]);
    const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
    const [showResults, setShowResults] = useState(false);
    const [selectedLevel, setSelectedLevel] = useState<CEFRLevel>('C2');
    const [questionCount, setQuestionCount] = useState(10);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [hasOfflineCache, setHasOfflineCache] = useState(false);
    const [quizStarted, setQuizStarted] = useState(false);
    const [buildingQuiz, setBuildingQuiz] = useState(false);
    const [levelWrongQueue, setLevelWrongQueue] = useState<VocabularyWord[]>([]);
    const [lastWrongWords, setLastWrongWords] = useState<VocabularyWord[]>([]);

    const { addQuizScore } = useProgress();

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const session = loadLastSession();
        if (session?.mode === 'quiz') {
            setSelectedLevel(session.level);
            const payload = session.payload?.quiz;
            if (payload?.questions?.length) {
                const startIndex = Math.min(session.index ?? 0, payload.questions.length - 1);
                setQuiz(payload.questions);
                setSelectedAnswers(payload.selectedAnswers ?? new Array(payload.questions.length).fill(-1));
                setCurrentQuestionIndex(startIndex);
                setQuizStarted(true);
                setShowResults(false);
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        setLevelWrongQueue(getWrongQueue(selectedLevel));
    }, [selectedLevel]);

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
                setLoadError('詞彙載入失敗，請稍後再試或換一個級別。');
                setLoading(false);
            }
        })();

        return () => {
            active = false;
            controller.abort();
        };
    }, [selectedLevel, reloadToken]);

    const [startNotice, setStartNotice] = useState<string | null>(null);

    const startQuiz = useCallback(async (useWrongOnly = false) => {
        if (buildingQuiz) return;
        setStartNotice(null);

        if (useWrongOnly) {
            if (levelWrongQueue.length === 0) {
                setStartNotice('暫時沒有錯題可複習');
                return;
            }
            setBuildingQuiz(true);
            const usableCount = Math.min(levelWrongQueue.length, questionCount);
            const reviewSlice = levelWrongQueue.slice(0, usableCount);
            const quizQuestions = generateQuiz(reviewSlice, levelWrongQueue, usableCount);
            const initialAnswers = new Array(quizQuestions.length).fill(-1);
            setQuiz(quizQuestions);
            setSelectedAnswers(initialAnswers);
            setCurrentQuestionIndex(0);
            setShowResults(false);
            setQuizStarted(true);
            setLastWrongWords([]);
            saveLastSession({
                mode: 'quiz',
                level: selectedLevel,
                index: 0,
                timestamp: new Date().toISOString(),
                payload: { quiz: { questions: quizQuestions, selectedAnswers: initialAnswers } },
            });
            setBuildingQuiz(false);
            return;
        }

        if (allWords.length === 0) {
            setStartNotice('詞彙仍在準備中，請稍候。');
            return;
        }

        setBuildingQuiz(true);
        const levelWords = filterByLevel(allWords, selectedLevel);
        const sampleSize = Math.min(levelWords.length, questionCount * 3 + 8);
        const sessionCandidates = getRandomWords(levelWords, sampleSize);

        try {
            const enriched = await enrichWords(sessionCandidates);
            const withTranslations = enriched.filter(word => !!word.cantonese && word.cantonese.trim().length > 0);
            const usableCount = Math.min(questionCount, withTranslations.length);

            if (usableCount === 0) {
                setStartNotice('尚未取得粵語翻譯，請稍後再試或換一個級別。');
                return;
            }

            const mainWords = withTranslations.slice(0, usableCount);
            const newQuiz = generateQuiz(mainWords, withTranslations, usableCount);
            const initialAnswers = new Array(newQuiz.length).fill(-1);
            setQuiz(newQuiz);
            setSelectedAnswers(initialAnswers);
            setCurrentQuestionIndex(0);
            setShowResults(false);
            setQuizStarted(true);
            setLastWrongWords([]);
            saveLastSession({
                mode: 'quiz',
                level: selectedLevel,
                index: 0,
                timestamp: new Date().toISOString(),
                payload: { quiz: { questions: newQuiz, selectedAnswers: initialAnswers } },
            });
        } finally {
            setBuildingQuiz(false);
        }
    }, [allWords, buildingQuiz, levelWrongQueue, questionCount, selectedLevel]);

    const handleAnswerSelect = (answerIndex: number) => {
        const newAnswers = [...selectedAnswers];
        newAnswers[currentQuestionIndex] = answerIndex;
        setSelectedAnswers(newAnswers);
    };

    const handleNext = () => {
        if (currentQuestionIndex < quiz.length - 1) {
            setCurrentQuestionIndex(currentQuestionIndex + 1);
        }
    };

    const handlePrevious = () => {
        if (currentQuestionIndex > 0) {
            setCurrentQuestionIndex(currentQuestionIndex - 1);
        }
    };

    useEffect(() => {
        if (!quizStarted || quiz.length === 0) return;
        saveLastSession({
            mode: 'quiz',
            level: selectedLevel,
            index: currentQuestionIndex,
            timestamp: new Date().toISOString(),
            payload: { quiz: { questions: quiz, selectedAnswers } },
        });
    }, [quizStarted, quiz, selectedAnswers, currentQuestionIndex, selectedLevel]);

    const handleSubmit = () => {
        const score = calculateScore(quiz, selectedAnswers);
        const wrongWords = quiz
            .filter((question, index) => selectedAnswers[index] !== question.correctAnswer)
            .map(q => q.word);
        setLastWrongWords(wrongWords);
        const askedIds = quiz.map(q => q.word.id);
        const updatedQueue = updateWrongQueue(selectedLevel, askedIds, wrongWords);
        setLevelWrongQueue(updatedQueue);
        addQuizScore({
            date: new Date(),
            level: selectedLevel,
            totalQuestions: score.total,
            correctAnswers: score.correct,
            accuracy: score.accuracy,
        });
        setShowResults(true);
    };

    const handleRestart = () => {
        setQuizStarted(false);
        setQuiz([]);
        setSelectedAnswers([]);
        setCurrentQuestionIndex(0);
        setShowResults(false);
        setLastWrongWords([]);
        saveLastSession({
            mode: 'quiz',
            level: selectedLevel,
            index: 0,
            timestamp: new Date().toISOString(),
            payload: { quiz: { questions: [], selectedAnswers: [] } },
        });
    };

    const handleRetry = () => {
        setLoadError(null);
        setLoading(true);
        setAllWords([]);
        setReloadToken(token => token + 1);
    };

    const handleUseOffline = async () => {
        const cached = await getCachedLevel(selectedLevel);
        if (cached.entry) {
            setAllWords(cached.entry.words);
            setLoadError(null);
            setLoading(false);
        }
    };

    let content: ReactNode;

    if (loading && allWords.length === 0 && !quizStarted) {
        content = <QuizSkeleton ctaLabel="載入中" />;
    } else if (loadError && allWords.length === 0 && !quizStarted) {
        content = (
            <ErrorState
                message={loadError}
                onRetry={handleRetry}
                onUseOffline={handleUseOffline}
                showOffline={hasOfflineCache}
            />
        );
    } else if (!quizStarted) {
        content = (
            <div className={styles.container}>
                <div className={styles.setup}>
                    <h1>測驗模式</h1>
                    <p className={styles.subtitle}>選擇級別和題目數量開始測驗</p>

                    <div className={styles.setupCard}>
                        <div className={styles.formGroup}>
                            <label>選擇級別：</label>
                            <div className={styles.levelGrid}>
                                {CEFR_LEVELS.map((level) => (
                                    <button
                                        key={level}
                                        onClick={() => setSelectedLevel(level)}
                                        className={`${styles.levelButton} ${selectedLevel === level ? styles.active : ''
                                            }`}
                                    >
                                        {level}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className={styles.formGroup}>
                            <label>題目數量：</label>
                            <div className={styles.countButtons}>
                                {[5, 10, 15, 20].map((count) => (
                                    <button
                                        key={count}
                                        onClick={() => setQuestionCount(count)}
                                        className={`${styles.countButton} ${questionCount === count ? styles.active : ''
                                            }`}
                                    >
                                        {count} 題
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className={styles.formGroup}>
                            <label>錯題複習：</label>
                            <div className={styles.countButtons}>
                                <button
                                    onClick={() => startQuiz(true)}
                                    className="btn-secondary"
                                    disabled={buildingQuiz || levelWrongQueue.length === 0}
                                >
                                    再試錯題（{levelWrongQueue.length}）
                                </button>
                                <button
                                    onClick={() => startQuiz(false)}
                                    className="btn-primary"
                                    style={{ fontSize: '1.1rem', padding: '0.85rem 1.6rem' }}
                                    disabled={buildingQuiz}
                                >
                                    {buildingQuiz ? '載入翻譯中…' : '開始測驗 🚀'}
                                </button>
                            </div>
                            {startNotice && <p className={styles.helper}>{startNotice}</p>}
                        </div>
                    </div>
                </div>
            </div>
        );
    } else if (showResults) {
        const score = calculateScore(quiz, selectedAnswers);
        content = (
            <div className={styles.container}>
                <div className={styles.results}>
                    <h1>測驗結果</h1>

                    <div className={styles.scoreCard}>
                        <div className={styles.scoreCircle}>
                            <div className={styles.scoreNumber}>{score.accuracy}%</div>
                            <div className={styles.scoreLabel}>準確率</div>
                        </div>

                        <div className={styles.scoreDetails}>
                            <div className={styles.scoreItem}>
                                <span className={styles.scoreValue}>{score.correct}</span>
                                <span className={styles.scoreText}>答對</span>
                            </div>
                            <div className={styles.scoreItem}>
                                <span className={styles.scoreValue}>{score.total - score.correct}</span>
                                <span className={styles.scoreText}>答錯</span>
                            </div>
                            <div className={styles.scoreItem}>
                                <span className={styles.scoreValue}>{score.total}</span>
                                <span className={styles.scoreText}>總題數</span>
                            </div>
                        </div>
                    </div>

                    {lastWrongWords.length > 0 && (
                        <div className={styles.reviewSection}>
                            <h2>錯題清單</h2>
                            <div className={styles.wrongList}>
                                {lastWrongWords.map((word) => (
                                    <div key={word.id} className={styles.wrongItem}>
                                        <div>
                                            <strong>{word.headword}</strong>
                                            <span className={styles.wrongLevel}>{word.level}</span>
                                        </div>
                                        {word.cantonese && (
                                            <p className={styles.wrongTranslation}>{word.cantonese}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div className={styles.resultActions}>
                                <button
                                    onClick={() => startQuiz(true)}
                                    className="btn-primary"
                                    disabled={buildingQuiz || levelWrongQueue.length === 0}
                                >
                                    再試錯題
                                </button>
                                <span className={styles.helper}>
                                    錯題庫：{levelWrongQueue.length} 題
                                </span>
                            </div>
                        </div>
                    )}

                    <div className={styles.reviewSection}>
                        <h2>答案回顧</h2>
                        {quiz.map((question, index) => {
                            const isCorrect = selectedAnswers[index] === question.correctAnswer;
                            return (
                                <div key={question.id} className={`${styles.reviewItem} ${isCorrect ? styles.correct : styles.incorrect}`}>
                                    <div className={styles.reviewHeader}>
                                        <span className={styles.reviewNumber}>第 {index + 1} 題</span>
                                        <span className={styles.reviewStatus}>
                                            {isCorrect ? '✓ 正確' : '✗ 錯誤'}
                                        </span>
                                    </div>
                                    <div className={styles.reviewQuestion}>
                                        <strong>{question.word.headword}</strong>
                                    </div>
                                    {question.word.cantonese && (
                                        <p className={styles.reviewTranslation}>
                                            粵語意思：{question.word.cantonese}
                                        </p>
                                    )}
                                    <div className={styles.reviewOptions}>
                                        {question.options.map((option, optIndex) => {
                                            const isSelected = selectedAnswers[index] === optIndex;
                                            const isCorrectOption = optIndex === question.correctAnswer;
                                            return (
                                                <div
                                                    key={optIndex}
                                                    className={`${styles.reviewOption} ${isCorrectOption ? styles.correctOption : ''
                                                        } ${isSelected && !isCorrectOption ? styles.wrongOption : ''}`}
                                                >
                                                    {option}
                                                    {isCorrectOption && ' ✓'}
                                                    {isSelected && !isCorrectOption && ' ✗'}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className={styles.resultActions}>
                        <button onClick={handleRestart} className="btn-primary">
                            再測一次
                        </button>
                        <Link href="/flashcards" className="btn-secondary">
                            返回閃卡
                        </Link>
                    </div>
                </div>
            </div>
        );
    } else {
        const currentQuestion = quiz[currentQuestionIndex];
        const progress = ((currentQuestionIndex + 1) / quiz.length) * 100;

        content = currentQuestion ? (
            <div className={styles.container}>
                <div className={styles.quizHeader}>
                    <h1>測驗進行中</h1>
                    <div className={styles.progressBar}>
                        <div className={styles.progressFill} style={{ width: `${progress}%` }} />
                    </div>
                    <p className={styles.progressText}>
                        第 {currentQuestionIndex + 1} 題 / 共 {quiz.length} 題
                    </p>
                </div>

                <div className={styles.questionCard}>
                    <div className={styles.questionHeader}>
                        <span className={styles.levelBadge}>{currentQuestion.word.level}</span>
                        <span className={styles.questionNumber}>Q{currentQuestionIndex + 1}</span>
                    </div>

                    <div className={styles.questionContent}>
                        <h2 className={styles.word}>{currentQuestion.word.headword}</h2>
                        <p className={styles.questionText}>
                            選擇正確的粵語意思（提交後會顯示標準答案）
                        </p>
                        {currentQuestion.word.examples && currentQuestion.word.examples.length > 0 && (
                            <div className={styles.examples}>
                                {currentQuestion.word.examples.map((ex, idx) => (
                                    <p key={idx} className={styles.exampleLine}>
                                        ・{ex}
                                    </p>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className={styles.options}>
                        {currentQuestion.options.map((option, index) => (
                            <button
                                key={index}
                                type="button"
                                onClick={() => handleAnswerSelect(index)}
                                className={`${styles.option} ${selectedAnswers[currentQuestionIndex] === index ? styles.selected : ''
                                    }`}
                                aria-pressed={selectedAnswers[currentQuestionIndex] === index}
                                aria-label={`選擇答案 ${String.fromCharCode(65 + index)}：${option}`}
                            >
                                <span className={styles.optionLetter}>
                                    {String.fromCharCode(65 + index)}
                                </span>
                                <span className={styles.optionText}>{option}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className={styles.navigation}>
                    <button
                        onClick={handlePrevious}
                        disabled={currentQuestionIndex === 0}
                        className="btn-secondary"
                    >
                        ← 上一題
                    </button>

                    {currentQuestionIndex === quiz.length - 1 ? (
                        <button
                            onClick={handleSubmit}
                            disabled={selectedAnswers.includes(-1)}
                            className="btn-primary"
                        >
                            提交答案 ✓
                        </button>
                    ) : (
                        <button
                            onClick={handleNext}
                            disabled={selectedAnswers[currentQuestionIndex] === -1}
                            className="btn-primary"
                        >
                            下一題 →
                        </button>
                    )}
                </div>
            </div>
        ) : (
            <ErrorState
                message="未找到題目，請重新開始測驗。"
                onRetry={handleRestart}
            />
        );
    }

    return <RequireAuth>{content}</RequireAuth>;
}

export default function QuizPage() {
    return (
        <Suspense fallback={
            <QuizSkeleton ctaLabel="載入中" />
        }>
            <QuizPageContent />
        </Suspense>
    );
}
