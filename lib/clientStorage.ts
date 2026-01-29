import { CEFRLevel, QuizQuestion, VocabularyWord } from './types';

export type SessionMode = 'flashcards' | 'quiz';

export interface LastSession {
    mode: SessionMode;
    level: CEFRLevel;
    index: number;
    timestamp: string;
    payload?: {
        flashcards?: {
            words: VocabularyWord[];
        };
        quiz?: {
            questions: QuizQuestion[];
            selectedAnswers: number[];
        };
    };
}

type WrongQueue = Record<CEFRLevel, VocabularyWord[]>;

const SESSION_KEY = 'c2-last-session-v2';
const WRONG_KEY = 'c2-wrong-queue-v1';

const isBrowser = typeof window !== 'undefined';

const readJson = <T>(key: string): T | null => {
    if (!isBrowser) return null;
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : null;
    } catch {
        return null;
    }
};

const writeJson = (key: string, value: any) => {
    if (!isBrowser) return;
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // ignore
    }
};

export const saveLastSession = (session: LastSession) => writeJson(SESSION_KEY, session);

export const loadLastSession = (): LastSession | null => {
    const session = readJson<LastSession>(SESSION_KEY);
    return session ? { ...session } : null;
};

export const clearLastSession = () => {
    if (!isBrowser) return;
    window.localStorage.removeItem(SESSION_KEY);
};

const dedupeWords = (words: VocabularyWord[]): VocabularyWord[] => {
    const map = new Map<string, VocabularyWord>();
    words.forEach(word => {
        if (!map.has(word.id)) {
            map.set(word.id, word);
        }
    });
    return Array.from(map.values());
};

const readWrongQueue = (): WrongQueue => readJson<WrongQueue>(WRONG_KEY) || {
    A1: [],
    A2: [],
    B1: [],
    B2: [],
    C1: [],
    C2: [],
};

const persistWrongQueue = (queue: WrongQueue) => writeJson(WRONG_KEY, queue);

export const getWrongQueue = (level: CEFRLevel): VocabularyWord[] => {
    const queue = readWrongQueue();
    return queue[level] || [];
};

export const updateWrongQueue = (
    level: CEFRLevel,
    askedIds: string[],
    wrongWords: VocabularyWord[]
): VocabularyWord[] => {
    const queue = readWrongQueue();
    const remaining = (queue[level] || []).filter(word => !askedIds.includes(word.id));
    const merged = dedupeWords([...remaining, ...wrongWords]);
    queue[level] = merged;
    persistWrongQueue(queue);
    return merged;
};
