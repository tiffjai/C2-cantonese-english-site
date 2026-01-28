'use client';

import { useProgress } from '@/contexts/ProgressContext';
import { LEVEL_INFO } from '@/lib/types';
import RequireAuth from '@/components/RequireAuth';
import styles from './page.module.css';

export default function ProgressPage() {
    const { progress, getStatistics, resetProgress } = useProgress();
    const stats = getStatistics();

    const handleReset = () => {
        if (confirm('確定要重置所有進度嗎？此操作無法撤銷。')) {
            resetProgress();
        }
    };

    return (
        <RequireAuth>
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1>學習進度</h1>
                    <p className={styles.subtitle}>追蹤您的學習成果</p>
                </div>

                <div className={styles.statsGrid}>
                    <div className={`${styles.statCard} ${styles.primary}`}>
                        <div className={styles.statIcon}>📚</div>
                        <div className={styles.statContent}>
                            <div className={styles.statValue}>{stats.totalWordsLearned}</div>
                            <div className={styles.statLabel}>已學習單詞</div>
                        </div>
                    </div>

                    <div className={`${styles.statCard} ${styles.secondary}`}>
                        <div className={styles.statIcon}>✅</div>
                        <div className={styles.statContent}>
                            <div className={styles.statValue}>{stats.totalQuizzesTaken}</div>
                            <div className={styles.statLabel}>完成測驗</div>
                        </div>
                    </div>

                    <div className={`${styles.statCard} ${styles.accent}`}>
                        <div className={styles.statIcon}>🎯</div>
                        <div className={styles.statContent}>
                            <div className={styles.statValue}>{stats.averageAccuracy}%</div>
                            <div className={styles.statLabel}>平均準確率</div>
                        </div>
                    </div>

                    <div className={`${styles.statCard} ${styles.success}`}>
                        <div className={styles.statIcon}>🔥</div>
                        <div className={styles.statContent}>
                            <div className={styles.statValue}>{stats.currentStreak}</div>
                            <div className={styles.statLabel}>連續天數</div>
                        </div>
                    </div>
                </div>

                <div className={styles.section}>
                    <h2>最近測驗成績</h2>
                    {progress.quizScores.length > 0 ? (
                        <div className={styles.quizHistory}>
                            {progress.quizScores.slice(-10).reverse().map((score, index) => (
                                <div key={index} className={styles.quizItem}>
                                    <div className={styles.quizHeader}>
                                        <span className={styles.quizLevel}>{score.level}</span>
                                        <span className={styles.quizDate}>
                                            {new Date(score.date).toLocaleDateString('zh-HK')}
                                        </span>
                                    </div>
                                    <div className={styles.quizStats}>
                                        <div className={styles.quizScore}>
                                            <span className={styles.scoreNumber}>{score.accuracy}%</span>
                                            <span className={styles.scoreText}>準確率</span>
                                        </div>
                                        <div className={styles.quizDetails}>
                                            <span>{score.correctAnswers} / {score.totalQuestions} 題正確</span>
                                        </div>
                                    </div>
                                    <div className={styles.progressBar}>
                                        <div
                                            className={styles.progressFill}
                                            style={{
                                                width: `${score.accuracy}%`,
                                                background: score.accuracy >= 80
                                                    ? 'var(--success)'
                                                    : score.accuracy >= 60
                                                        ? 'var(--warning)'
                                                        : 'var(--error)',
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className={styles.emptyState}>
                            <p>還沒有測驗記錄</p>
                            <a href="/quiz">
                                <button className="btn-primary">開始第一個測驗</button>
                            </a>
                        </div>
                    )}
                </div>

                <div className={styles.section}>
                    <h2>級別分佈</h2>
                    <div className={styles.levelStats}>
                        {Object.entries(LEVEL_INFO).map(([level, info]) => (
                            <div key={level} className={styles.levelItem}>
                                <div className={styles.levelHeader}>
                                    <span className={styles.levelName}>
                                        {level} - {info.name}
                                    </span>
                                    <span className={styles.levelCount}>
                                        {stats.wordsByLevel[level as keyof typeof stats.wordsByLevel] || 0} 個單詞
                                    </span>
                                </div>
                                <div className={styles.levelBar}>
                                    <div
                                        className={styles.levelFill}
                                        style={{
                                            width: `${Math.min(
                                                ((stats.wordsByLevel[level as keyof typeof stats.wordsByLevel] || 0) / 100) * 100,
                                                100
                                            )}%`,
                                            background: info.color,
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className={styles.actions}>
                    <button onClick={handleReset} className="btn-secondary" style={{ color: 'var(--error)' }}>
                        🗑️ 重置進度
                    </button>
                </div>
            </div>
        </RequireAuth>
    );
}
