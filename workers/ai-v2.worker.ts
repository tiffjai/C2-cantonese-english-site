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
    const posRule =
        posBucket === 'adj'
            ? `Use the target word ONLY as an adjective; do not write "the ${word}".`
            : posBucket === 'noun'
                ? 'Use the target word ONLY as a noun.'
                : posBucket === 'verb'
                    ? 'Use the target word ONLY as a verb.'
                    : posBucket === 'adv'
                        ? 'Use the target word ONLY as an adverb.'
                        : 'Use the target word in its most natural part of speech.';

    return `Target word: "${word}"
Level: ${level}
Meaning (if provided): ${meaning || 'N/A'}

Output ONLY these 10 lines, in this exact order, with no extra text:
EASY: ...
NORMAL: ...
ADVANCED: ...
CLOZE: ...
A) ...
B) ...
C) ...
D) ...
ANSWER: A|B|C|D
EXPLAIN: ...

Rules:
- Use the target word exactly once in EASY/NORMAL/ADVANCED.
- ${posRule}
- Each sentence must be 6–14 words of natural English.
- No meta language (word, sentence, example, noted, considered important).
- CLOZE must equal NORMAL with the target word replaced by ____.
- A-D are single-word options, same POS as the target word, only one correct.
- EXPLAIN is 20 words or fewer.
No other text.`;
};

self.onmessage = async (event: MessageEvent<GenerateMessage>) => {
    const data = event.data;
    if (!data || data.type !== 'generate') return;

    const { word, level, pos, meaning } = data;

    let lastRawText = '';

    try {
        if (!generator) {
            send({ type: 'status', status: 'loading-model' });
            generator = await loadGeneratorWithFallback();
            send({ type: 'status', status: 'model-ready' });
        } else {
            send({ type: 'status', status: 'model-ready' });
        }

        send({ type: 'status', status: 'generating' });

        const prompt = promptTemplate({ word, level, pos, meaning });
        const baseParams = {
            max_new_tokens: 180,
            temperature: 0.8,
            top_p: 0.9,
            do_sample: true,
            repetition_penalty: 1.22,
            return_full_text: false,
        };
        const retryParams = {
            max_new_tokens: 160,
            temperature: 0.9,
            top_p: 0.9,
            do_sample: true,
            repetition_penalty: 1.3,
            return_full_text: false,
        };

        const attempts = [baseParams, retryParams];
        let lastError: Error | null = null;

        for (const params of attempts) {
            const rawText = await runGeneration(prompt, params);
            lastRawText = rawText;

            if (isDegenerateOutput(rawText)) {
                lastError = new Error('Degenerate output detected.');
                continue;
            }

            try {
                const parsed = parseLineOutput(rawText, word, pos);
                const validated = validatePayload(parsed, word);
                send({ type: 'result', payload: validated, rawText });
                return;
            } catch (err: any) {
                lastError = err;
                continue;
            }
        }

        const fallbackMessage = 'AI response incomplete. Please retry.';
        send({ type: 'error', message: fallbackMessage, rawText: lastRawText });
        return;
    } catch (error: any) {
        const rawText = lastRawText || error?.rawText;
        const message = normalizeErrorMessage(error?.message);
        send({ type: 'error', message, rawText });
    }
};

function parseLineOutput(text: string, targetWord: string, pos?: string): AiOutput {
    const lines = stripPreamble(text, [
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

    for (const sentence of [easy, normal, advanced]) {
        if (countWordOccurrences(sentence, targetWord) !== 1) {
            throw new Error('WORD must appear exactly once in each sentence.');
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

type GenerationParams = {
    max_new_tokens: number;
    temperature: number;
    top_p: number;
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
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const labelRegex = new RegExp(`^(${labelPattern})\\s*(?:[:\\)\\.]|\\-)?`, 'i');
    const startIndex = lines.findIndex((line) => labelRegex.test(line));
    if (startIndex === -1) return lines;
    return lines.slice(startIndex);
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

    if (/\b(usage|tag|schema|rules)\b/.test(lowered)) return true;
    if (/\b(word=|level=|pos=|meaning=)\b/.test(lowered)) return true;

    if (/([a-z0-9])\1{7,}/i.test(cleaned)) return true;
    if (/([^\s])\1{9,}/.test(cleaned)) return true;

    if (/\b([a-z]{1,3})\b(?:[\.!?;,:]\s*\1\b){2,}/i.test(cleaned)) return true;

    const symbolsOnly = cleaned.replace(/[a-z0-9]/gi, '').replace(/\s+/g, '');
    const totalChars = cleaned.replace(/\s+/g, '').length;
    if (totalChars > 0 && symbolsOnly.length / totalChars > 0.45) return true;

    const letters = cleaned.replace(/[^a-z]/gi, '').length;
    if (cleaned.length > 0 && letters / cleaned.length < 0.55) return true;

    const tokens = cleaned.split(' ');
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
