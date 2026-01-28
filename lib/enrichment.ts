"use client";

import { VocabularyWord } from "./types";

type EnrichmentCache = Record<string, {
    cantonese?: string;
    examples?: string[];
    updatedAt: string;
}>;

const CACHE_KEY = "c2-enrichment-cache-v1";

const sanitize = (text: string) =>
    text
        .replace(/\r|\n/g, " ")
        .replace(/,/g, "，") // keep CSV safe; parser splits on comma
        .replace(/\|/g, "／") // avoid breaking example splitter
        .trim();

const loadCache = (): EnrichmentCache => {
    if (typeof window === "undefined") return {};
    try {
        const stored = window.localStorage.getItem(CACHE_KEY);
        return stored ? JSON.parse(stored) : {};
    } catch (error) {
        console.warn("Unable to read enrichment cache", error);
        return {};
    }
};

const saveCache = (cache: EnrichmentCache) => {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
        console.warn("Unable to persist enrichment cache", error);
    }
};

async function fetchTranslation(headword: string): Promise<string | undefined> {
    try {
        // Use MyMemory free API (English -> Traditional Chinese). Good enough for Cantonese reading.
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(headword)}&langpair=en|zh-TW`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Translation HTTP ${res.status}`);
        const data = await res.json();
        const translated = data?.responseData?.translatedText as string | undefined;
        if (translated) return sanitize(translated);
    } catch (error) {
        console.warn(`MyMemory translation failed for ${headword}`, error);
    }

    // Fallback: Lingva (Google Translate proxy) zh locale
    try {
        const lingvaUrl = `https://lingva.pot-app.com/api/v1/en/zh/${encodeURIComponent(headword)}`;
        const res = await fetch(lingvaUrl);
        if (!res.ok) throw new Error(`Lingva HTTP ${res.status}`);
        const data = await res.json();
        const translated = data?.translation as string | undefined;
        return translated ? sanitize(translated) : undefined;
    } catch (error) {
        console.warn(`Lingva translation failed for ${headword}`, error);
        return undefined;
    }
}

async function fetchExamples(headword: string): Promise<string[]> {
    try {
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(headword)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Dictionary HTTP ${res.status}`);
        const payload = await res.json();

        const collected: string[] = [];

        if (Array.isArray(payload)) {
            for (const entry of payload) {
                const meanings = entry?.meanings ?? [];
                for (const meaning of meanings) {
                    const definitions = meaning?.definitions ?? [];
                    for (const def of definitions) {
                        if (def?.example) {
                            collected.push(def.example as string);
                            if (collected.length >= 2) break;
                        }
                    }
                    if (collected.length >= 2) break;
                }
                if (collected.length >= 2) break;
            }
        }

        if (collected.length === 0) {
            collected.push(`I am learning the word "${headword}" today.`);
        }

        return collected.map(sanitize);
    } catch (error) {
        console.warn(`Example fetch failed for ${headword}`, error);
        return [`I am learning the word "${headword}" today.`];
    }
}

// Ensure we don't hammer APIs when many cards share the same headword
const inFlight = new Map<string, Promise<{ cantonese?: string; examples?: string[] }>>();

async function enrichSingle(word: VocabularyWord, cache: EnrichmentCache): Promise<VocabularyWord> {
    const key = word.headword.toLowerCase();
    const cached = cache[key];

    if (cached?.cantonese && cached.examples?.length) {
        return {
            ...word,
            cantonese: cached.cantonese,
            examples: cached.examples,
        };
    }

    if (inFlight.has(key)) {
        const result = await inFlight.get(key)!;
        return { ...word, ...result };
    }

    const task = (async () => {
        let cantonese = cached?.cantonese ?? (await fetchTranslation(word.headword));
        let examples = cached?.examples ?? (await fetchExamples(word.headword));

        // Fallbacks for lower levels to guarantee content (A1-C1)
        const needsFallback = ['A1', 'A2', 'B1', 'B2', 'C1'].includes(word.level);
        if (!cantonese && needsFallback) {
            cantonese = '翻譯暫缺（稍後提供）';
        }
        if ((!examples || examples.length === 0) && needsFallback) {
            examples = [`我正在學習「${word.headword}」這個單詞。`];
        }

        const enrichment = { cantonese, examples };
        cache[key] = {
            ...cache[key],
            ...enrichment,
            updatedAt: new Date().toISOString(),
        };
        saveCache(cache);
        return enrichment;
    })();

    inFlight.set(key, task);
    try {
        const result = await task;
        return { ...word, ...result };
    } finally {
        inFlight.delete(key);
    }
}

/**
 * Enrich a batch of words with Cantonese translation and example sentences.
 * Uses localStorage cache to avoid repeated API calls across sessions.
 */
export async function enrichWords(words: VocabularyWord[]): Promise<VocabularyWord[]> {
    const cache = loadCache();
    const enriched = await Promise.all(words.map(word => enrichSingle(word, cache)));
    return enriched;
}
