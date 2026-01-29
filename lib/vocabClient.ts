import { CEFRLevel, VocabularyWord } from './types';

type CacheSource = 'idb' | 'local';

interface LevelCacheEntry {
    level: CEFRLevel;
    version: string;
    words: VocabularyWord[];
    updatedAt: string;
}

interface LoadResult {
    words: VocabularyWord[];
    fromCache: boolean;
    stale: boolean;
    cacheAvailable: boolean;
}

const VOCAB_VERSION = '2026-01-29';
const DB_NAME = 'c2-vocab-cache';
const STORE_NAME = 'levels';
const LOCAL_KEY = 'c2-level-cache-v1';

const isBrowser = typeof window !== 'undefined';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const openDb = (): Promise<IDBDatabase | null> => {
    if (!isBrowser || !('indexedDB' in window)) return Promise.resolve(null);

    return new Promise((resolve) => {
        const request = window.indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'level' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });
};

const readFromDb = async (level: CEFRLevel): Promise<LevelCacheEntry | null> => {
    const db = await openDb();
    if (!db) return null;

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(level);
        req.onsuccess = () => resolve(req.result as LevelCacheEntry | undefined || null);
        req.onerror = () => resolve(null);
    });
};

const writeToDb = async (entry: LevelCacheEntry) => {
    const db = await openDb();
    if (!db) return;

    await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
};

const readFromLocal = (level: CEFRLevel): LevelCacheEntry | null => {
    if (!isBrowser) return null;
    try {
        const raw = window.localStorage.getItem(LOCAL_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Record<string, LevelCacheEntry>;
        return parsed[level] || null;
    } catch {
        return null;
    }
};

const writeToLocal = (entry: LevelCacheEntry) => {
    if (!isBrowser) return;
    try {
        const raw = window.localStorage.getItem(LOCAL_KEY);
        const parsed: Record<string, LevelCacheEntry> = raw ? JSON.parse(raw) : {};
        parsed[entry.level] = entry;
        window.localStorage.setItem(LOCAL_KEY, JSON.stringify(parsed));
    } catch {
        // ignore
    }
};

const mapPayloadToWords = (payload: any, level: CEFRLevel): VocabularyWord[] => {
    if (!payload) return [];
    const wordsArray = Array.isArray(payload)
        ? payload
        : payload.words || payload.items || [];

    return (wordsArray as any[])
        .map((item, index) => ({
            id: item.id ?? `${level}-${item.headword ?? item.word ?? 'item'}-${index}`,
            headword: item.headword ?? item.word ?? '',
            level: (item.level as CEFRLevel) ?? level,
            cantonese: item.cantonese,
            examples: item.examples,
        }))
        .filter(word => word.headword && word.level);
};

export const getCachedLevel = async (level: CEFRLevel): Promise<{ entry: LevelCacheEntry | null; source?: CacheSource; stale: boolean; }> => {
    const dbEntry = await readFromDb(level);
    if (dbEntry) {
        return { entry: dbEntry, source: 'idb', stale: dbEntry.version !== VOCAB_VERSION };
    }

    const localEntry = readFromLocal(level);
    if (localEntry) {
        return { entry: localEntry, source: 'local', stale: localEntry.version !== VOCAB_VERSION };
    }

    return { entry: null, stale: false };
};

export const fetchLevel = async (level: CEFRLevel, signal?: AbortSignal): Promise<LevelCacheEntry> => {
    const url = `${basePath}/levels/${level}.json`;
    const res = await fetch(url, { signal });
    if (!res.ok) {
        throw new Error(`Failed to load ${level} list (${res.status})`);
    }
    const data = await res.json();
    const words = mapPayloadToWords(data, level);
    const entry: LevelCacheEntry = {
        level,
        version: VOCAB_VERSION,
        words,
        updatedAt: new Date().toISOString(),
    };
    writeToDb(entry);
    writeToLocal(entry);
    return entry;
};

export const loadLevelWords = async (
    level: CEFRLevel,
    opts: { signal?: AbortSignal; preferCache?: boolean; allowStale?: boolean } = {}
): Promise<LoadResult> => {
    const { preferCache = true, allowStale = true, signal } = opts;
    const cached = await getCachedLevel(level);

    if (preferCache && cached.entry && !cached.stale) {
        return {
            words: cached.entry.words,
            fromCache: true,
            stale: false,
            cacheAvailable: true,
        };
    }

    try {
        const fresh = await fetchLevel(level, signal);
        return {
            words: fresh.words,
            fromCache: false,
            stale: false,
            cacheAvailable: true,
        };
    } catch (error) {
        if (cached.entry && allowStale) {
            return {
                words: cached.entry.words,
                fromCache: true,
                stale: true,
                cacheAvailable: true,
            };
        }
        throw error;
    }
};

export const hasAnyCache = async (level: CEFRLevel): Promise<boolean> => {
    const cached = await getCachedLevel(level);
    return Boolean(cached.entry);
};

export const VOCAB_DATA_VERSION = VOCAB_VERSION;
