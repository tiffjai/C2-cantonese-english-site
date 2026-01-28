import { VocabularyWord, CEFRLevel } from './types';

/**
 * Parse CSV content and convert to VocabularyWord array
 * Format: headword,CEFR,cantonese,example1|example2|example3
 */
export async function parseVocabularyCSV(csvContent: string): Promise<VocabularyWord[]> {
    const lines = csvContent.trim().split('\n');
    const words: VocabularyWord[] = [];

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Split by comma, but handle commas within quoted fields
        const parts = line.split(',').map(part => part.trim().replace(/\r$/, ''));

        if (parts.length < 2) continue;

        const headword = parts[0];
        const level = parts[1] as CEFRLevel;

        // Validate level
        if (!['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(level)) {
            continue;
        }

        // Parse optional cantonese translation (3rd column)
        const cantonese = parts.length > 2 && parts[2] ? parts[2] : undefined;

        // Parse optional examples (4th column, pipe-separated)
        const examplesStr = parts.length > 3 && parts[3] ? parts[3] : '';
        const examples = examplesStr
            ? examplesStr.split('|').map(ex => ex.trim()).filter(ex => ex.length > 0)
            : undefined;

        words.push({
            id: `${level}-${headword}-${i}`,
            headword,
            level,
            cantonese,
            examples,
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
