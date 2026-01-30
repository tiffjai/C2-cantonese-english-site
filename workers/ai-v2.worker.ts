/// <reference lib="webworker" />
// AI generation worker for browser-only inference

import { pipeline, env, type TextGenerationPipelineType } from '@huggingface/transformers';

declare const self: DedicatedWorkerGlobalScope;
export {};

type GenerateMessage = {
    type: 'generate';
    word: string;
    level: string;
    pos?: string;
    meaning?: string;
    distractors?: string[];
};

type WorkerResponse =
    | { type: 'status'; status: 'loading-model' | 'model-ready' | 'generating' }
    | { type: 'progress'; loaded: number; total: number }
    | { type: 'result'; payload: AiOutput; rawText?: string }
    | { type: 'error'; message: string; rawText?: string };

type AiExample = { difficulty: string; sentence: string };
type AiCloze = {
    sentence: string;
    options: string[];
    answer: string;
    explanation: string;
};

export type AiOutput = {
    examples: AiExample[];
    cloze: AiCloze;
};

// Configure transformers.js for browser usage
env.allowRemoteModels = true;
env.allowLocalModels = false;

const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';
let generator: TextGenerationPipelineType | null = null;
let generatorDevice: 'webgpu' | 'wasm' | null = null;

const send = (message: WorkerResponse) => {
    self.postMessage(message);
};

// Simplified prompt for better reliability with small models
const createChatMessages = ({
    word,
    level,
    pos,
    meaning,
}: {
    word: string;
    level: string;
    pos?: string;
    meaning?: string;
}): Array<{ role: string; content: string }> => {
    const posBucket = normalizePosBucket(pos);
    const posHint = posBucket !== 'unknown' ? ` (${posBucket})` : '';
    
    return [
        {
            role: 'system',
            content: `You are a vocabulary tutor. Generate example sentences and a quiz for English learners. Be concise and follow the exact format requested. Do not add explanations or extra text.`
        },
        {
            role: 'user',
            content: `Create examples for the word "${word}"${posHint} at ${level} level.

Output exactly these 10 lines:
EASY: [simple sentence using "${word}"]
NORMAL: [medium sentence using "${word}"]
ADVANCED: [complex sentence using "${word}"]
CLOZE: [copy NORMAL sentence but replace "${word}" with ____]
A) [wrong option word]
B) [wrong option word]
C) ${word}
D) [wrong option word]
ANSWER: C
EXPLAIN: [brief reason why "${word}" fits]

Rules:
- Each sentence: 6-14 words, natural English
- Use "${word}" once per sentence
- Options A,B,D must be similar words but wrong for the context`
        }
    ];
};

// Fallback to raw prompt if chat template fails
const promptTemplate = ({
    word,
    level,
    pos,
    meaning,
}: {
    word: string;
    level: string;
    pos?: string;
    meaning?: string;
}) => {
    const posBucket = normalizePosBucket(pos);
    const posHint = posBucket !== 'unknown' ? ` (${posBucket})` : '';

    return `Create examples for "${word}"${posHint} at ${level} level.

Output exactly 10 lines:
EASY: [simple 6-14 word sentence using "${word}"]
NORMAL: [medium 6-14 word sentence using "${word}"]
ADVANCED: [complex 6-14 word sentence using "${word}"]
CLOZE: [NORMAL sentence with "${word}" replaced by ____]
A) [wrong word]
B) [wrong word]
C) ${word}
D) [wrong word]
ANSWER: C
EXPLAIN: [why "${word}" fits, under 20 words]

Use "${word}" exactly once in EASY, NORMAL, ADVANCED. No extra text.`;
};

const retryPromptTemplate = ({
    word,
    level,
    pos,
    meaning,
}: {
    word: string;
    level: string;
    pos?: string;
    meaning?: string;
}) => {
    const posBucket = normalizePosBucket(pos);
    const posHint = posBucket !== 'unknown' ? ` (${posBucket})` : '';

    return `Word: "${word}"${posHint}, Level: ${level}

EASY: The ${word} was very helpful today.
NORMAL: Many people consider ${word} important for success.
ADVANCED: The intricate nature of ${word} requires careful analysis.
CLOZE: Many people consider ____ important for success.
A) challenge
B) problem
C) ${word}
D) difficulty
ANSWER: C
EXPLAIN: "${word}" fits the context of importance.

Now generate YOUR OWN unique sentences for "${word}" following this exact format.`;
};

self.onmessage = async (event: MessageEvent<GenerateMessage>) => {
    const data = event.data;
    if (!data || data.type !== 'generate') return;

    const { word, level, pos, meaning } = data;

    let lastRawText = '';
    let attemptCount = 0;
    const MAX_ATTEMPTS = 4;

    try {
        if (!generator) {
            send({ type: 'status', status: 'loading-model' });
            generator = await loadGeneratorWithFallback();
            send({ type: 'status', status: 'model-ready' });
        } else {
            send({ type: 'status', status: 'model-ready' });
        }

        send({ type: 'status', status: 'generating' });

        // Try chat template format first (better for instruction-tuned models)
        const chatMessages = createChatMessages({ word, level, pos, meaning });
        const prompt = promptTemplate({ word, level, pos, meaning });
        const retryPrompt = retryPromptTemplate({ word, level, pos, meaning });
        
        // Generation parameters - more conservative for small models
        const chatParams = {
            max_new_tokens: 200,
            temperature: 0.3,
            top_p: 0.9,
            top_k: 30,
            do_sample: true,
            repetition_penalty: 1.3,
            return_full_text: false,
        };
        const baseParams = {
            max_new_tokens: 170,
            temperature: 0.5,
            top_p: 0.85,
            top_k: 40,
            do_sample: true,
            repetition_penalty: 1.3,
            return_full_text: false,
        };
        const strictParams = {
            max_new_tokens: 150,
            temperature: 0.0,
            top_p: 1.0,
            do_sample: false,
            repetition_penalty: 1.4,
            return_full_text: false,
        };

        // Define attempts with different prompts and params
        const attempts: Array<{ input: any; params: any; useChat: boolean }> = [
            { input: chatMessages, params: chatParams, useChat: true },
            { input: prompt, params: baseParams, useChat: false },
            { input: retryPrompt, params: strictParams, useChat: false },
            { input: prompt, params: strictParams, useChat: false },
        ];

        let lastError: Error | null = null;

        for (const { input, params, useChat } of attempts) {
            attemptCount++;
            
            try {
                const rawText = useChat 
                    ? await runChatGeneration(input, params)
                    : await runGeneration(input, params);
                lastRawText = rawText;

                // Early exit if output is clearly degenerate (save time)
                if (isDegenerateOutput(rawText)) {
                    console.warn(`[AI Worker] Attempt ${attemptCount}/${MAX_ATTEMPTS}: Degenerate output detected`);
                    lastError = new Error('Degenerate output detected.');
                    continue;
                }

                // Check for explicit error message
                const cleanedText = rawText.trim().toLowerCase();
                if (cleanedText.includes('error: cannot generate response')) {
                    lastError = new Error('Model reported it cannot generate response.');
                    continue;
                }

                const normalizedText = normalizeLabelFormatting(rawText);
                if (!hasMinimumLabels(normalizedText)) {
                    console.warn(`[AI Worker] Attempt ${attemptCount}/${MAX_ATTEMPTS}: Missing required labels`);
                    lastError = new Error('Output missing required labels.');
                    continue;
                }

                const parsed = parseLineOutput(normalizedText, word, pos);
                const validated = validatePayload(parsed, word);
                console.info(`[AI Worker] Success on attempt ${attemptCount}/${MAX_ATTEMPTS}`);
                send({ type: 'result', payload: validated, rawText });
                return;
            } catch (err: any) {
                console.warn(`[AI Worker] Attempt ${attemptCount}/${MAX_ATTEMPTS} failed:`, err.message);
                lastError = err;
                continue;
            }
        }

        // All attempts failed - send user-friendly error without raw gibberish
        const fallbackMessage = `I'm having trouble generating examples for "${word}" right now. The AI model is having difficulty with this particular word. Please try again or choose a different word!`;
        
        // Only include raw text if it's not gibberish (for debugging)
        const safeRawText = isDegenerateOutput(lastRawText) ? '(output was corrupted)' : lastRawText;
        send({ type: 'error', message: fallbackMessage, rawText: safeRawText });
        return;
    } catch (error: any) {
        console.error('[AI Worker] Critical error:', error);
        const message = normalizeErrorMessage(error?.message);
        // Don't expose corrupted output to user
        const safeRawText = lastRawText && !isDegenerateOutput(lastRawText) ? lastRawText : undefined;
        send({ type: 'error', message, rawText: safeRawText });
    }
};

function parseLineOutput(text: string, targetWord: string, pos?: string): AiOutput {
    const normalizedText = normalizeLabelFormatting(text);
    const lines = stripPreamble(normalizedText, [
        'easy',
        'normal',
        'advanced',
        'cloze',
        'a',
        'b',
        'c',
        'd',
        'answer',
        'explain',
    ]);

    const labelRegex = (label: string) =>
        new RegExp(`^${label}\\s*(?:[:\\)\\.]|\\-)?\\s+`, 'i');

    const getLine = (label: string, pattern?: RegExp) => {
        const regex = pattern ?? labelRegex(label);
        const match = lines.find((line) => regex.test(line));
        if (!match) return '';
        return match.replace(regex, '').trim();
    };

    const easy = getLine('easy');
    const normal = getLine('normal');
    const advanced = getLine('advanced');
    const cloze = getLine('cloze');
    const optionA = getLine('a', /^a\s*(?:[\):\.\-]|-)\s+/i);
    const optionB = getLine('b', /^b\s*(?:[\):\.\-]|-)\s+/i);
    const optionC = getLine('c', /^c\s*(?:[\):\.\-]|-)\s+/i);
    const optionD = getLine('d', /^d\s*(?:[\):\.\-]|-)\s+/i);
    const answer = getLine('answer').toUpperCase();
    const explanation = getLine('explain');

    if (!easy || !normal || !advanced || !cloze || !optionA || !optionB || !optionC || !optionD || !answer || !explanation) {
        throw new Error('Line output incomplete.');
    }

    // Enhanced validation for sentence quality
    for (const sentence of [easy, normal, advanced]) {
        if (countWordOccurrences(sentence, targetWord) !== 1) {
            throw new Error('WORD must appear exactly once in each sentence.');
        }
        
        // Check for proper sentence structure
        if (!isValidSentenceStructure(sentence)) {
            throw new Error('Sentence structure invalid.');
        }
        
        // Check for proper word usage
        if (!isValidWordUsage(sentence, targetWord, pos)) {
            throw new Error('Word usage invalid.');
        }
    }

    if (!cloze.includes('____')) {
        throw new Error('Cloze sentence must include "____".');
    }

    const expectedCloze = normalizeSpacing(replaceWord(normal, targetWord, '____'));
    if (normalizeSpacing(cloze) !== expectedCloze) {
        throw new Error('Cloze must match NORMAL with WORD replaced.');
    }

    const options = [optionA, optionB, optionC, optionD];
    if (!options.every((opt) => isSingleWord(opt))) {
        throw new Error('Options must be single words.');
    }
    const answerIndex = parseAnswerIndex(answer, options);
    if (answerIndex === -1) {
        throw new Error('Answer must be A, B, C, or D.');
    }

    for (const sentence of [easy, normal, advanced, cloze]) {
        if (!isValidSentence(sentence)) {
            throw new Error('Sentence constraints not met.');
        }
    }

    if (hasMetaLanguage(easy) || hasMetaLanguage(normal) || hasMetaLanguage(advanced) || hasMetaLanguage(cloze)) {
        throw new Error('Meta language detected.');
    }

    const posBucket = normalizePosBucket(pos);
    if (posBucket === 'adj') {
        if (violatesAdjConstraint(easy, targetWord) || violatesAdjConstraint(normal, targetWord) || violatesAdjConstraint(advanced, targetWord)) {
            throw new Error('Adjective used as a noun.');
        }
    }

    if (posBucket !== 'unknown') {
        for (const option of options) {
            if (option.toLowerCase() === targetWord.toLowerCase()) continue;
            if (getPosBucket(option) !== posBucket) {
                throw new Error('Option POS mismatch.');
            }
        }
    }

    return {
        examples: [
            { difficulty: 'easy', sentence: easy },
            { difficulty: 'normal', sentence: normal },
            { difficulty: 'advanced', sentence: advanced },
        ],
        cloze: {
            sentence: cloze,
            options,
            answer: ['A', 'B', 'C', 'D'][answerIndex],
            explanation: trimToWords(explanation, 20),
        },
    };
}

function isValidSentenceStructure(sentence: string): boolean {
    // Check for proper capitalization
    if (!/^[A-Z]/.test(sentence)) return false;
    
    // Check for proper ending punctuation
    if (!/[.!?]$/.test(sentence)) return false;
    
    // Check for reasonable length (not too short or too long)
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length < 3 || words.length > 20) return false;
    
    // Check for basic grammar patterns
    if (/\b(is|are|was|were|be|been|being)\s+(to\s+)?\b/.test(sentence)) return true;
    if (/\b(have|has|had|do|does|did|will|would|should|could|can|may|might|must|shall)\b/.test(sentence)) return true;
    if (/\b(the|a|an|this|that|these|those)\b/.test(sentence)) return true;
    
    return true;
}

function isValidWordUsage(sentence: string, targetWord: string, pos?: string): boolean {
    const posBucket = normalizePosBucket(pos);
    
    // Check for proper word context
    const lowerSentence = sentence.toLowerCase();
    const lowerWord = targetWord.toLowerCase();
    
    // For adjectives, ensure they're not used as nouns
    if (posBucket === 'adj') {
        if (/\bthe\s+/.test(lowerSentence) && lowerSentence.includes(lowerWord)) {
            return !/\bthe\s+/.test(lowerSentence.replace(new RegExp(`\\b${escapeRegExp(targetWord)}\\b`, 'gi'), ''));
        }
    }
    
    // Check for proper word boundaries
    const wordRegex = new RegExp(`\\b${escapeRegExp(targetWord)}\\b`, 'i');
    if (!wordRegex.test(sentence)) return false;
    
    // Check for reasonable context (not just the word by itself)
    const beforeMatch = sentence.match(new RegExp(`(.{0,20})\\b${escapeRegExp(targetWord)}\\b`, 'i'));
    const afterMatch = sentence.match(new RegExp(`\\b${escapeRegExp(targetWord)}\\b(.{0,20})`, 'i'));
    
    if (!beforeMatch || !afterMatch) return false;
    
    const beforeContext = beforeMatch[1];
    const afterContext = afterMatch[1];
    
    // Ensure there's meaningful context before and after the word
    if (beforeContext.length < 2 && afterContext.length < 2) return false;
    
    return true;
}

type GenerationParams = {
    max_new_tokens: number;
    temperature: number;
    top_p: number;
    top_k?: number;
    do_sample: boolean;
    repetition_penalty: number;
    no_repeat_ngram_size?: number;
    return_full_text: boolean;
};

async function loadGenerator(device: 'webgpu' | 'wasm'): Promise<TextGenerationPipelineType> {
    const dtype = device == 'webgpu' ? 'q4f16' : 'q4';
    console.info(`[AI Worker] Loading ${MODEL_ID} (device=${device}, dtype=${dtype})`);
    const loaded = await pipeline('text-generation', MODEL_ID, {
        device,
        dtype,
        progress_callback: (data: any) => {
            const loaded = Number(data?.loaded ?? 0);
            const total = Number(data?.total ?? 0);
            if (total > 0) {
                send({ type: 'progress', loaded, total });
            }
        },
    });
    generatorDevice = device;
    return loaded as TextGenerationPipelineType;
}

async function loadGeneratorWithFallback(): Promise<TextGenerationPipelineType> {
    const hasWebGPU = typeof (self as any).navigator?.gpu !== 'undefined';
    if (hasWebGPU) {
        try {
            return await loadGenerator('webgpu');
        } catch {
            return await loadGenerator('wasm');
        }
    }
    return await loadGenerator('wasm');
}

async function runGeneration(prompt: string, params: GenerationParams): Promise<string> {
    if (!generator) {
        throw new Error('Model not loaded.');
    }

    try {
        const output = await generator(prompt, params);
        return extractGeneratedText(output as any);
    } catch (error) {
        if (generatorDevice == 'webgpu') {
            generator = await loadGenerator('wasm');
            const output = await generator(prompt, params);
            return extractGeneratedText(output as any);
        }
        throw error;
    }
}

// Run generation using chat messages format (better for instruction-tuned models)
async function runChatGeneration(
    messages: Array<{ role: string; content: string }>,
    params: GenerationParams
): Promise<string> {
    if (!generator) {
        throw new Error('Model not loaded.');
    }

    try {
        // Try chat format first
        const output = await generator(messages as any, params);
        return extractGeneratedText(output as any);
    } catch (error) {
        // If chat format fails, convert to raw prompt and try again
        console.warn('[AI Worker] Chat format failed, falling back to raw prompt');
        const rawPrompt = messages.map(m => {
            if (m.role === 'system') return `System: ${m.content}\n`;
            if (m.role === 'user') return `User: ${m.content}\n`;
            return `${m.role}: ${m.content}\n`;
        }).join('') + 'Assistant:';
        
        try {
            const output = await generator(rawPrompt, params);
            return extractGeneratedText(output as any);
        } catch (fallbackError) {
            if (generatorDevice == 'webgpu') {
                generator = await loadGenerator('wasm');
                const output = await generator(rawPrompt, params);
                return extractGeneratedText(output as any);
            }
            throw fallbackError;
        }
    }
}

function replaceWord(sentence: string, targetWord: string, replacement: string): string {
    const strict = new RegExp(`\\b${escapeRegExp(targetWord)}\\b`, 'i');
    if (strict.test(sentence)) {
        return sentence.replace(strict, replacement);
    }
    const loose = new RegExp(`${escapeRegExp(targetWord)}`, 'i');
    return sentence.replace(loose, replacement);
}

function containsWord(sentence: string, targetWord: string): boolean {
    const strict = new RegExp(`\\b${escapeRegExp(targetWord)}\\b`, 'i');
    if (strict.test(sentence)) return true;
    const loose = new RegExp(`${escapeRegExp(targetWord)}`, 'i');
    return loose.test(sentence);
}

function getPosBucket(word: string, pos?: string): 'noun' | 'verb' | 'adj' | 'adv' | 'unknown' {
    const posBucket = normalizePosBucket(pos);
    if (posBucket !== 'unknown') return posBucket;
    const lower = word.toLowerCase();
    if (/(ly)$/.test(lower)) return 'adv';
    if (/(tion|ment|ness|ity|ship|ism|ence|ance)$/.test(lower)) return 'noun';
    if (/(ous|ive|al|ic|ful|less|able|ible|ent|ant)$/.test(lower)) return 'adj';
    if (/(ate|ify|ise|ize|en)$/.test(lower)) return 'verb';
    return 'unknown';
}

function normalizePosBucket(pos?: string): 'noun' | 'verb' | 'adj' | 'adv' | 'unknown' {
    if (!pos) return 'unknown';
    const lower = pos.trim().toLowerCase();
    if (['n', 'noun'].includes(lower)) return 'noun';
    if (['v', 'verb'].includes(lower)) return 'verb';
    if (['adj', 'adjective'].includes(lower)) return 'adj';
    if (['adv', 'adverb'].includes(lower)) return 'adv';
    return 'unknown';
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeErrorMessage(message: string | undefined): string {
    if (!message) return 'AI response incomplete. Please retry.';
    if (/json/i.test(message)) {
        return 'AI response incomplete. Please retry.';
    }
    return message;
}

function stripPreamble(text: string, labels: string[]): string[] {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*]\s+/, '').trim())
        .filter(Boolean);
    if (!lines.length) return [];
    const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const labelRegex = new RegExp(`^(${labelPattern})\\s*(?:[:\\)\\.]|\\-)?`, 'i');
    const startIndex = lines.findIndex((line) => labelRegex.test(line));
    if (startIndex === -1) return lines;
    return lines.slice(startIndex);
}

function normalizeLabelFormatting(text: string): string {
    if (!text) return '';
    const labelPattern = /\b(EASY|NORMAL|ADVANCED|CLOZE|ANSWER|EXPLAIN|A|B|C|D)\b\s*(?:[:\)\.\-])/gi;
    return text
        .replace(/\r/g, '')
        .replace(labelPattern, (match, label) => `\n${label}${match.slice(label.length)}`)
        .trim();
}

function hasMinimumLabels(text: string): boolean {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*]\s+/, '').trim())
        .filter(Boolean);
    if (!lines.length) return false;
    const labels = ['easy', 'normal', 'advanced', 'cloze', 'a', 'b', 'c', 'd', 'answer', 'explain'];
    const labelRegex = new RegExp(`^(${labels.join('|')})\\s*(?:[:\\)\\.]|\\-)?\\s+`, 'i');
    const found = new Set<string>();
    for (const line of lines) {
        const match = line.match(labelRegex);
        if (match?.[1]) {
            found.add(match[1].toLowerCase());
        }
    }
    return found.size >= 6;
}

function isValidSentence(sentence: string): boolean {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length < 6 || words.length > 14) return false;
    return true;
}

function hasMetaLanguage(sentence: string): boolean {
    const lowered = sentence.toLowerCase();
    if (/\b(word|sentence|example)\b/.test(lowered)) return true;
    if (/considered important/.test(lowered)) return true;
    if (/\bnoted\b/.test(lowered)) return true;
    return false;
}

function isSingleWord(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed || /\s/.test(trimmed)) return false;
    return /^[A-Za-z'-]+$/.test(trimmed);
}

function countWordOccurrences(sentence: string, targetWord: string): number {
    const regex = new RegExp(`\\b${escapeRegExp(targetWord)}\\b`, 'gi');
    const matches = sentence.match(regex);
    return matches ? matches.length : 0;
}

function normalizeSpacing(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function violatesAdjConstraint(sentence: string, targetWord: string): boolean {
    const regex = new RegExp(`\\bthe\\s+${escapeRegExp(targetWord)}\\b`, 'i');
    return regex.test(sentence);
}

function isDegenerateOutput(text: string): boolean {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return true;
    const lowered = cleaned.toLowerCase();

    // Check for label-related degenerate patterns
    if (/\b(labels?|mention|enclosed|specific|quotes|encapsulate|referencing|reference|define|defined|refer|referring|referscribing|refferending|referrence|referredence|referendration)\b/.test(lowered)) return true;
    if (/\b(usage|tag|schema|rules)\b/.test(lowered)) return true;
    if (/\b(word=|level=|pos=|meaning=)\b/.test(lowered)) return true;

    // Check for repetitive patterns
    if (/([a-z0-9])\1{7,}/i.test(cleaned)) return true;
    if (/([^\s])\1{9,}/.test(cleaned)) return true;

    if (/\b([a-z]{1,3})\b(?:[\.!?;,:]\s*\1\b){2,}/i.test(cleaned)) return true;

    const tokens = cleaned.split(' ');
    if (tokens.some((token) => token.length > 40)) return true;

    // NEW: Detect spaced-out characters like "G R I S T O M U G"
    const spacedCharPattern = /(?:[A-Za-z]\s){5,}/;
    if (spacedCharPattern.test(cleaned)) return true;

    // NEW: Detect very long concatenated words (no spaces) indicating gibberish
    const noSpaceSegments = cleaned.split(/\s+/);
    for (const segment of noSpaceSegments) {
        if (segment.length > 50) return true;
        // Check for repeating 2-4 char patterns within a word
        if (segment.length > 15) {
            for (let len = 2; len <= 4; len++) {
                for (let i = 0; i <= segment.length - len * 4; i++) {
                    const substr = segment.slice(i, i + len);
                    const rest = segment.slice(i);
                    const count = (rest.match(new RegExp(escapeRegExp(substr), 'gi')) || []).length;
                    if (count >= 6) return true;
                }
            }
        }
    }

    // NEW: Detect morpheme repetition (like "ord" appearing many times)
    const commonMorphemes = ['ord', 'ing', 'tion', 'ation', 'ment', 'ness', 'able', 'ible', 'ence', 'ance', 'ous', 'ive', 'ist', 'ism'];
    for (const morpheme of commonMorphemes) {
        const morphemeCount = (lowered.match(new RegExp(morpheme, 'gi')) || []).length;
        if (morphemeCount > 15) return true;
    }

    // NEW: Calculate text entropy - too low means repetitive/degenerate
    const charFreq = new Map<string, number>();
    const alphaOnly = lowered.replace(/[^a-z]/g, '');
    for (const char of alphaOnly) {
        charFreq.set(char, (charFreq.get(char) || 0) + 1);
    }
    if (alphaOnly.length > 50) {
        let entropy = 0;
        for (const count of charFreq.values()) {
            const p = count / alphaOnly.length;
            entropy -= p * Math.log2(p);
        }
        // English text typically has entropy around 4.0-4.5 bits per character
        // Very low entropy indicates repetitive text
        if (entropy < 2.5) return true;
    }

    // NEW: Check for operator/programming-like patterns
    if (/[=<>]{2,}/.test(cleaned)) return true;
    if (/\bparse\s*"/.test(lowered)) return true;
    if (/responsibility\s*[."']/.test(lowered)) return true;

    // NEW: Detect text that looks like concatenated words without proper spacing
    // Count transitions from lowercase to uppercase without space
    let badTransitions = 0;
    for (let i = 1; i < cleaned.length; i++) {
        if (/[a-z]/.test(cleaned[i - 1]) && /[A-Z]/.test(cleaned[i]) && cleaned[i - 1] !== ' ') {
            badTransitions++;
        }
    }
    if (badTransitions > 10) return true;

    const symbolsOnly = cleaned.replace(/[a-z0-9]/gi, '').replace(/\s+/g, '');
    const totalChars = cleaned.replace(/\s+/g, '').length;
    if (totalChars > 0 && symbolsOnly.length / totalChars > 0.45) return true;

    const letters = cleaned.replace(/[^a-z]/gi, '').length;
    if (cleaned.length > 0 && letters / cleaned.length < 0.55) return true;
    if (tokens.length >= 30) {
        const unique = new Set(tokens);
        if (unique.size / tokens.length < 0.35) return true;
    }

    const trigramCounts = new Map<string, number>();
    for (let i = 0; i < tokens.length - 2; i += 1) {
        const gram = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
        const count = (trigramCounts.get(gram) ?? 0) + 1;
        if (count >= 5) return true;
        trigramCounts.set(gram, count);
    }

    // Check for specific degenerate patterns from the error logs
    if (/\brespond to if not limited\b/.test(lowered)) return true;
    if (/\blimit.*limited.*lingsum\b/.test(lowered)) return true;
    if (/\bsumsumsumsum\b/.test(lowered)) return true;
    if (/\benseense\b/.test(lowered)) return true;
    if (/\buneder\b/.test(lowered)) return true;
    if (/\bsizelimitation\b/.test(lowered)) return true;
    if (/\bmentionin\b/.test(lowered)) return true;
    if (/\benterementuration\b/.test(lowered)) return true;
    if (/\bintermax\b/.test(lowered)) return true;
    if (/\bnumberoforderless\b/.test(lowered)) return true;
    if (/\bincremention\b/.test(lowered)) return true;
    if (/\bramingformating\b/.test(lowered)) return true;
    if (/\bsomernination\b/.test(lowered)) return true;
    if (/\boffonfrender\b/.test(lowered)) return true;

    // NEW: Additional degenerate patterns from recent logs
    if (/[a-z]{3,}organization[a-z]{3,}/i.test(cleaned)) return true;
    if (/distribution.*distribution.*distribution/i.test(cleaned)) return true;
    if (/storm.*storg.*sord/i.test(cleaned)) return true;
    if (/operator.*operator/i.test(cleaned)) return true;

    // Check for excessive repetition of common words
    const commonWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must', 'shall'];
    for (const word of commonWords) {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        const matches = cleaned.match(regex);
        if (matches && matches.length > 10) return true;
    }

    // NEW: Check if output contains mostly non-English looking sequences
    const words = cleaned.split(/\s+/).filter(w => w.length > 2);
    let nonsenseCount = 0;
    for (const word of words) {
        // Words with too many consonants in a row or unusual patterns
        if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(word)) nonsenseCount++;
        // Words that are just repeated characters
        if (/^(.)\1+$/.test(word)) nonsenseCount++;
    }
    if (words.length > 5 && nonsenseCount / words.length > 0.3) return true;

    return false;
}

function extractGeneratedText(output: any): string {
    if (output == null) return '';

    // Array responses
    if (Array.isArray(output)) {
        const first = output[0];
        if (typeof first === 'string') return first;
        if (first?.generated_text) {
            const gt = first.generated_text;
            // When using chat template, generated_text may be an array of messages
            if (Array.isArray(gt)) {
                const last = gt.at(-1);
                if (last?.content) return coerceToText(last.content);
                return coerceToText(gt);
            }
            if (gt?.content) {
                return coerceToText(gt.content);
            }
            if (typeof gt === 'string') return gt;
            return coerceToText(gt);
        }
        return coerceToText(first);
    }

    // Direct string
    if (typeof output === 'string') return output;

    // Object with generated_text
    if (output?.generated_text) {
        const gt = output.generated_text;
        if (Array.isArray(gt)) {
            const last = gt.at(-1);
            if (last?.content) return coerceToText(last.content);
            return coerceToText(gt);
        }
        if (gt?.content) {
            return coerceToText(gt.content);
        }
        if (typeof gt === 'string') return gt;
        return coerceToText(gt);
    }

    // Fallback
    return coerceToText(output);
}

function coerceToText(value: any): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value.map(coerceToText).join('');
    }
    if (typeof value === 'object') {
        if ('text' in value) return coerceToText(value.text);
        if ('content' in value) return coerceToText(value.content);
        if ('generated_text' in value) return coerceToText(value.generated_text);
    }
    return '';
}

function validatePayload(payload: any, targetWord: string): AiOutput {
    if (!payload || typeof payload !== 'object') {
        throw new Error('JSON structure missing.');
    }

    const examplesRaw: any[] = Array.isArray(payload.examples) ? payload.examples : [];
    if (examplesRaw.length < 3) {
        throw new Error('Examples missing.');
    }

    const remaining = [...examplesRaw];
    const getSentence = (item: any) => {
        const raw = item?.sentence ?? item?.text ?? item?.example;
        return typeof raw === 'string' ? raw.trim() : '';
    };

    const pickByLabel = (label: string) => {
        const idx = remaining.findIndex((ex) => ex?.difficulty?.toLowerCase?.() === label);
        if (idx === -1) return null;
        const [picked] = remaining.splice(idx, 1);
        const sentence = getSentence(picked);
        return sentence ? { difficulty: label, sentence } : null;
    };

    const pickNext = (label: string) => {
        while (remaining.length) {
            const candidate = remaining.shift();
            const sentence = getSentence(candidate);
            if (sentence) return { difficulty: label, sentence };
        }
        return null;
    };

    const examples: AiExample[] = [];
    for (const label of ['easy', 'normal', 'advanced']) {
        const labeled = pickByLabel(label);
        const entry = labeled ?? pickNext(label);
        if (!entry?.sentence) {
            throw new Error(`Missing ${label} sentence.`);
        }
        if (!entry.sentence.toLowerCase().includes(targetWord.toLowerCase())) {
            throw new Error(`The ${label} sentence must include the target word.`);
        }
        examples.push(entry);
    }

    const clozeRaw = payload.cloze || {};
    const clozeSentenceRaw = clozeRaw.sentence ?? clozeRaw.prompt ?? clozeRaw.question;
    const clozeSentence = typeof clozeSentenceRaw === 'string' ? clozeSentenceRaw.trim() : '';
    if (!clozeSentence || !clozeSentence.includes('____')) {
        throw new Error('Cloze sentence must include "____".');
    }

    const optionsRaw: string[] = Array.isArray(clozeRaw.options)
        ? clozeRaw.options
        : Array.isArray(clozeRaw.choices)
            ? clozeRaw.choices
            : Array.isArray(clozeRaw.answers)
                ? clozeRaw.answers
                : [];
    const options = optionsRaw
        .map((opt) => (typeof opt === 'string' ? opt.trim() : ''))
        .filter(Boolean);
    if (options.length !== 4) {
        throw new Error('Cloze options must have 4 items.');
    }

    const answerRawValue = clozeRaw.answer ?? clozeRaw.correct ?? clozeRaw.correctAnswer ?? clozeRaw.key;
    const answerRaw = typeof answerRawValue === 'string' ? answerRawValue.trim() : answerRawValue;
    const answerIndex = parseAnswerIndex(answerRaw, options);
    if (answerIndex === -1) {
        throw new Error('Cloze answer must match one option (A-D).');
    }
    const answer = ['A', 'B', 'C', 'D'][answerIndex];

    const explanationRawValue = clozeRaw.explanation ?? clozeRaw.reason ?? clozeRaw.rationale;
    const explanationRaw = typeof explanationRawValue === 'string' ? explanationRawValue.trim() : '';
    if (!explanationRaw) {
        throw new Error('Cloze explanation missing.');
    }
    const explanation = trimToWords(explanationRaw, 20);

    return {
        examples,
        cloze: {
            sentence: clozeSentence,
            options,
            answer,
            explanation,
        },
    };
}

function parseAnswerIndex(answer: string | number, options: string[]): number {
    if (answer === null || answer === undefined) return -1;
    if (typeof answer === 'number' && Number.isFinite(answer)) {
        if (answer >= 0 && answer <= 3) return answer;
        if (answer >= 1 && answer <= 4) return answer - 1;
        return -1;
    }
    const raw = String(answer).trim();
    if (!raw) return -1;
    const letter = raw[0].toUpperCase();
    const letterIndex = ['A', 'B', 'C', 'D'].indexOf(letter);
    if (letterIndex >= 0) return letterIndex;
    const num = Number(raw);
    if (Number.isFinite(num)) {
        if (num >= 0 && num <= 3) return num;
        if (num >= 1 && num <= 4) return num - 1;
    }

    // Try to match by option text
    const normalized = raw.toLowerCase();
    const idx = options.findIndex((opt) => opt.toLowerCase() === normalized);
    return idx;
}

function trimToWords(text: string, maxWords: number): string {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return words.join(' ');
    return words.slice(0, maxWords).join(' ');
}

// fallbacks removed: rely on model output + retries
