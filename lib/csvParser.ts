import { VocabularyWord, CEFRLevel } from './types';

/**
 * Parse CSV content and convert to VocabularyWord array
 */
export async function parseVocabularyCSV(csvContent: string): Promise<VocabularyWord[]> {
    const lines = csvContent.trim().split('\n');
    const words: VocabularyWord[] = [];

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Split by comma, handling potential quotes
        const match = line.match(/^([^,]+),([^,\r]+)/);
        if (!match) continue;

        const headword = match[1].trim();
        const level = match[2].trim().replace('\r', '') as CEFRLevel;

        // Validate level
        if (!['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(level)) {
            continue;
        }

        words.push({
            id: `${level}-${headword}-${i}`,
            headword,
            level,
        });
    }

    return words;
}

/**
 * Load vocabulary from CSV file
 */
export async function loadVocabulary(): Promise<VocabularyWord[]> {
    try {
        const response = await fetch('/ENGLISH_CERF_WORDS.csv');
        const csvContent = await response.text();
        return parseVocabularyCSV(csvContent);
    } catch (error) {
        console.error('Failed to load vocabulary:', error);
        return [];
    }
}

/**
 * Filter words by CEFR level
 */
export function filterByLevel(words: VocabularyWord[], level: CEFRLevel): VocabularyWord[] {
    return words.filter(word => word.level === level);
}

/**
 * Filter words by multiple levels
 */
export function filterByLevels(words: VocabularyWord[], levels: CEFRLevel[]): VocabularyWord[] {
    return words.filter(word => levels.includes(word.level));
}

/**
 * Get random words from a list
 */
export function getRandomWords(words: VocabularyWord[], count: number): VocabularyWord[] {
    const shuffled = [...words].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, words.length));
}

/**
 * Get word count by level
 */
export function getWordCountByLevel(words: VocabularyWord[]): Record<CEFRLevel, number> {
    const counts: Record<CEFRLevel, number> = {
        A1: 0,
        A2: 0,
        B1: 0,
        B2: 0,
        C1: 0,
        C2: 0,
    };

    words.forEach(word => {
        counts[word.level]++;
    });

    return counts;
}

/**
 * Search words by headword
 */
export function searchWords(words: VocabularyWord[], query: string): VocabularyWord[] {
    const lowerQuery = query.toLowerCase();
    return words.filter(word =>
        word.headword.toLowerCase().includes(lowerQuery)
    );
}
