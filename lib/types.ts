// CEFR Level Types
export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

// Vocabulary Word Interface
export interface VocabularyWord {
    id: string;
    headword: string;
    level: CEFRLevel;
    pos?: string; // Optional part of speech
    cantonese?: string; // Optional Cantonese translation
    examples?: string[]; // Optional example sentences
}

// Quiz Question Interface
export interface QuizQuestion {
    id: string;
    word: VocabularyWord;
    question: string;
    options: string[];
    correctAnswer: number; // Index of correct option
}

// User Progress Interface
export interface UserProgress {
    wordsLearned: Set<string>; // Set of word IDs
    quizScores: QuizScore[];
    lastStudied: Date;
    currentLevel: CEFRLevel;
    streak: number; // Days streak
}

// Quiz Score Interface
export interface QuizScore {
    date: Date;
    level: CEFRLevel;
    totalQuestions: number;
    correctAnswers: number;
    accuracy: number; // Percentage
}

// Flashcard Session Interface
export interface FlashcardSession {
    level: CEFRLevel;
    words: VocabularyWord[];
    currentIndex: number;
    markedAsLearned: Set<string>;
}

// Statistics Interface
export interface Statistics {
    totalWordsLearned: number;
    wordsByLevel: Record<CEFRLevel, number>;
    averageAccuracy: number;
    totalQuizzesTaken: number;
    currentStreak: number;
    longestStreak: number;
}

// Level Info Interface
export interface LevelInfo {
    level: CEFRLevel;
    name: string; // Cantonese name
    description: string;
    wordCount: number;
    color: string; // Theme color for the level
}

// Constants
export const CEFR_LEVELS: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export const LEVEL_INFO: Record<CEFRLevel, Omit<LevelInfo, 'wordCount'>> = {
    A1: {
        level: 'A1',
        name: '初級入門',
        description: '基礎詞彙',
        color: 'hsl(145, 70%, 55%)',
    },
    A2: {
        level: 'A2',
        name: '初級進階',
        description: '日常詞彙',
        color: 'hsl(120, 65%, 50%)',
    },
    B1: {
        level: 'B1',
        name: '中級基礎',
        description: '常用詞彙',
        color: 'hsl(60, 75%, 55%)',
    },
    B2: {
        level: 'B2',
        name: '中級進階',
        description: '進階詞彙',
        color: 'hsl(40, 85%, 60%)',
    },
    C1: {
        level: 'C1',
        name: '高級基礎',
        description: '專業詞彙',
        color: 'hsl(20, 85%, 60%)',
    },
    C2: {
        level: 'C2',
        name: '高級精通',
        description: '專家詞彙',
        color: 'hsl(0, 85%, 65%)',
    },
};
