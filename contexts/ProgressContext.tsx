'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { UserProgress, QuizScore, CEFRLevel, Statistics } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';

interface ProgressContextType {
    progress: UserProgress;
    addLearnedWord: (wordId: string) => void;
    addQuizScore: (score: QuizScore) => void;
    getStatistics: () => Statistics;
    resetProgress: () => void;
    ready: boolean;
}

const ProgressContext = createContext<ProgressContextType | undefined>(undefined);

const createDefaultProgress = (): UserProgress => ({
    wordsLearned: new Set<string>(),
    quizScores: [],
    lastStudied: new Date(),
    currentLevel: 'A1',
    streak: 0,
});

export function ProgressProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const storageKey = user ? `userProgress-${user.id}` : 'userProgress-guest';

    const [progress, setProgress] = useState<UserProgress>(createDefaultProgress());
    const [hydratedKey, setHydratedKey] = useState<string | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        setReady(false);
        const savedProgress = localStorage.getItem(storageKey);
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
        } else {
            setProgress(createDefaultProgress());
        }
        setHydratedKey(storageKey);
        setReady(true);
    }, [storageKey]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (hydratedKey !== storageKey) return;

        const toSave = {
            ...progress,
            wordsLearned: Array.from(progress.wordsLearned),
        };
        localStorage.setItem(storageKey, JSON.stringify(toSave));
    }, [progress, storageKey, hydratedKey]);

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
        setProgress(createDefaultProgress());
        localStorage.removeItem(storageKey);
    };

    return (
        <ProgressContext.Provider
            value={{
                progress,
                addLearnedWord,
                addQuizScore,
                getStatistics,
                resetProgress,
                ready,
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
