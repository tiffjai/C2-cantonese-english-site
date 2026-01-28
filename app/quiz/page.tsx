'use client';

import { useState, useEffect } from 'react';
import { VocabularyWord, QuizQuestion, CEFRLevel, CEFR_LEVELS } from '@/lib/types';
import { loadVocabulary, filterByLevel } from '@/lib/csvParser';
import { generateQuiz, calculateScore } from '@/lib/quizGenerator';
import { useProgress } from '@/contexts/ProgressContext';
import styles from './page.module.css';

export default function QuizPage() {
    const [allWords, setAllWords] = useState<VocabularyWord[]>([]);
    const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
    const [showResults, setShowResults] = useState(false);
    const [selectedLevel, setSelectedLevel] = useState<CEFRLevel>('C2');
    const [questionCount, setQuestionCount] = useState(10);
    const [loading, setLoading] = useState(true);
    const [quizStarted, setQuizStarted] = useState(false);

    const { addQuizScore } = useProgress();

    useEffect(() => {
        async function loadWords() {
            setLoading(true);
            const words = await loadVocabulary();
            setAllWords(words);
            setLoading(false);
        }
        loadWords();
    }, []);

    const startQuiz = () => {
        if (allWords.length === 0) return;

        const levelWords = filterByLevel(allWords, selectedLevel);
        const newQuiz = generateQuiz(levelWords, allWords, questionCount);
        setQuiz(newQuiz);
        setSelectedAnswers(new Array(newQuiz.length).fill(-1));
        setCurrentQuestionIndex(0);
        setShowResults(false);
        setQuizStarted(true);
    };

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

    const handleSubmit = () => {
        const score = calculateScore(quiz, selectedAnswers);
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
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.loading}>
                    <div className={styles.spinner}></div>
                    <p>載入中...</p>
                </div>
            </div>
        );
    }

    if (!quizStarted) {
        return (
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

                        <button onClick={startQuiz} className="btn-primary" style={{ fontSize: '1.25rem', padding: '1rem 2rem' }}>
                            開始測驗 🚀
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (showResults) {
        const score = calculateScore(quiz, selectedAnswers);
        return (
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
                        <button onClick={() => window.location.href = '/flashcards'} className="btn-secondary">
                            返回閃卡
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const currentQuestion = quiz[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / quiz.length) * 100;

    return (
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
                    <p className={styles.questionText}>選擇正確的意思：</p>
                </div>

                <div className={styles.options}>
                    {currentQuestion.options.map((option, index) => (
                        <button
                            key={index}
                            onClick={() => handleAnswerSelect(index)}
                            className={`${styles.option} ${selectedAnswers[currentQuestionIndex] === index ? styles.selected : ''
                                }`}
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
    );
}
