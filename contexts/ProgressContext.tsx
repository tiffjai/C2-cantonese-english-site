'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { UserProgress, QuizScore, CEFRLevel, Statistics } from '@/lib/types';

interface ProgressContextType {
    progress: UserProgress;
    addLearnedWord: (wordId: string) => void;
    addQuizScore: (score: QuizScore) => void;
    getStatistics: () => Statistics;
    resetProgress: () => void;
}

const ProgressContext = createContext<ProgressContextType | undefined>(undefined);

const defaultProgress: UserProgress = {
    wordsLearned: new Set<string>(),
    quizScores: [],
    lastStudied: new Date(),
    currentLevel: 'A1',
    streak: 0,
};

export function ProgressProvider({ children }: { children: ReactNode }) {
    const [progress, setProgress] = useState<UserProgress>(defaultProgress);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const savedProgress = localStorage.getItem('userProgress');
        if (savedProgress) {
            try {
                const parsed = JSON.parse(savedProgress);
                setProgress({
                    ...parsed,
                    wordsLearned: new Set(parsed.wordsLearned || []),
                    lastStudied: new Date(parsed.lastStudied),
                    quizScores: (parsed.quizScores || []).map((score: any) => ({
                        ...score,
                        date: new Date(score.date),
                    })),
                });
            } catch (error) {
                console.error('Failed to load progress:', error);
            }
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const toSave = {
            ...progress,
            wordsLearned: Array.from(progress.wordsLearned),
        };
        localStorage.setItem('userProgress', JSON.stringify(toSave));
    }, [progress]);

    const addLearnedWord = (wordId: string) => {
        setProgress(prev => ({
            ...prev,
            wordsLearned: new Set([...prev.wordsLearned, wordId]),
            lastStudied: new Date(),
        }));
    };

    const addQuizScore = (score: QuizScore) => {
        setProgress(prev => ({
            ...prev,
            quizScores: [...prev.quizScores, score],
            lastStudied: new Date(),
        }));
    };

    const getStatistics = (): Statistics => {
        const wordsByLevel: Record<CEFRLevel, number> = {
            A1: 0,
            A2: 0,
            B1: 0,
            B2: 0,
            C1: 0,
            C2: 0,
        };

        // This is a simplified version - in a real app, we'd track level per word
        const totalWordsLearned = progress.wordsLearned.size;

        const totalQuizzesTaken = progress.quizScores.length;
        const averageAccuracy = totalQuizzesTaken > 0
            ? progress.quizScores.reduce((sum, score) => sum + score.accuracy, 0) / totalQuizzesTaken
            : 0;

        return {
            totalWordsLearned,
            wordsByLevel,
            averageAccuracy: Math.round(averageAccuracy),
            totalQuizzesTaken,
            currentStreak: progress.streak,
            longestStreak: progress.streak, // Simplified
        };
    };

    const resetProgress = () => {
        setProgress(defaultProgress);
        localStorage.removeItem('userProgress');
    };

    return (
        <ProgressContext.Provider
            value={{
                progress,
                addLearnedWord,
                addQuizScore,
                getStatistics,
                resetProgress,
            }}
        >
            {children}
        </ProgressContext.Provider>
    );
}

export function useProgress() {
    const context = useContext(ProgressContext);
    if (context === undefined) {
        throw new Error('useProgress must be used within a ProgressProvider');
    }
    return context;
}
