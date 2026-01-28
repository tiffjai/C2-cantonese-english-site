import { VocabularyWord, QuizQuestion } from './types';

/**
 * Generate a quiz question from a vocabulary word
 */
export function generateQuizQuestion(
    word: VocabularyWord,
    allWords: VocabularyWord[]
): QuizQuestion {
    // Get 3 random words from the same level as distractors
    const sameLevel = allWords.filter(w =>
        w.level === word.level && w.id !== word.id
    );

    const distractors = getRandomItems(sameLevel, 3);

    // Create options array with correct answer and distractors
    const options = [word, ...distractors]
        .sort(() => Math.random() - 0.5)
        .map(w => w.headword);

    const correctAnswer = options.indexOf(word.headword);

    return {
        id: `quiz-${word.id}`,
        word,
        question: `What is the meaning of "${word.headword}"?`,
        options,
        correctAnswer,
    };
}

/**
 * Generate multiple quiz questions
 */
export function generateQuiz(
    words: VocabularyWord[],
    allWords: VocabularyWord[],
    count: number
): QuizQuestion[] {
    const selectedWords = getRandomItems(words, count);
    return selectedWords.map(word => generateQuizQuestion(word, allWords));
}

/**
 * Get random items from an array
 */
function getRandomItems<T>(array: T[], count: number): T[] {
    const shuffled = [...array].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, array.length));
}

/**
 * Calculate quiz score
 */
export function calculateScore(
    questions: QuizQuestion[],
    answers: number[]
): {
    correct: number;
    total: number;
    accuracy: number;
} {
    const correct = questions.reduce((count, question, index) => {
        return count + (question.correctAnswer === answers[index] ? 1 : 0);
    }, 0);

    const total = questions.length;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    return { correct, total, accuracy };
}

/**
 * Spaced Repetition: Calculate next review date
 * Simple implementation - can be enhanced with SM-2 algorithm
 */
export function calculateNextReview(
    correctCount: number,
    totalAttempts: number
): Date {
    const accuracy = totalAttempts > 0 ? correctCount / totalAttempts : 0;

    let daysUntilReview: number;

    if (accuracy >= 0.9) {
        daysUntilReview = 7; // Review in 1 week
    } else if (accuracy >= 0.7) {
        daysUntilReview = 3; // Review in 3 days
    } else if (accuracy >= 0.5) {
        daysUntilReview = 1; // Review tomorrow
    } else {
        daysUntilReview = 0; // Review today
    }

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + daysUntilReview);

    return nextReview;
}
