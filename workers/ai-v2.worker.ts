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
}) => `OUTPUT ONLY THESE 10 LINES (NO EXTRA TEXT):
EASY: ...
NORMAL: ...
ADVANCED: ...
CLOZE: ...
A: ...
B: ...
C: ...
D: ...
ANSWER: A|B|C|D
EXPLAIN: ...
WORD="${word}"
LEVEL="${level}"
POS="${pos || 'unknown'}"
MEANING="${meaning || ''}"
Rules:
- Use WORD as the POS specified (if POS is "unknown", use the most natural POS).
- Put WORD exactly in EASY/NORMAL/ADVANCED.
- Each sentence must be 6–14 words and sound natural.
- No meta language: word, sentence, example, noted, considered important.
- CLOZE replaces WORD with ____.
- A-D are 4 short single-word options, only one correct.
- EXPLAIN <= 12 words.
No other text.`;

self.onmessage = async (event: MessageEvent<GenerateMessage>) => {
    const data = event.data;
    if (!data || data.type !== 'generate') return;

    const { word, level, pos, meaning, distractors = [] } = data;

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

        let output: any;
        const prompt = promptTemplate({ word, level, pos, meaning });
        try {
            output = await generator(prompt, {
                max_new_tokens: 220,
                temperature: 0.7,
                top_p: 0.9,
                do_sample: true,
                repetition_penalty: 1.15,
                no_repeat_ngram_size: 3,
                return_full_text: false,
            });
        } catch (genError) {
            const fallback = buildPosFallbackOutput(word, distractors, pos);
            if (fallback) {
                send({ type: 'result', payload: fallback });
                return;
            }
            throw genError;
        }

        let rawText = extractGeneratedText(output as any);
        rawText = truncateAtEndTag(rawText);
        lastRawText = rawText;

        if (isDegenerateOutput(rawText)) {
            try {
                const retry = await generator(prompt, {
                    max_new_tokens: 160,
                    temperature: 0.6,
                    top_p: 0.85,
                    do_sample: true,
                    repetition_penalty: 1.25,
                    no_repeat_ngram_size: 4,
                    return_full_text: false,
                });
                const retryText = truncateAtEndTag(extractGeneratedText(retry as any));
                if (!isDegenerateOutput(retryText)) {
                    rawText = retryText;
                    lastRawText = retryText;
                }
            } catch {
                // keep original output if retry fails
            }
        }

        try {
            const parsed = parseLineOutput(rawText, word);
            const validated = validatePayload(parsed, word);

            send({ type: 'result', payload: validated, rawText: lastRawText });
            return;
        } catch (err) {
            const salvaged = salvageFromRawText(rawText, word, distractors, pos);
            if (salvaged) {
                send({ type: 'result', payload: salvaged, rawText: lastRawText });
                return;
            }
            const retryResult = await generateSentenceOnlyFallback(word, level, distractors, pos, meaning);
            if (retryResult) {
                lastRawText = retryResult.rawText;
                send({ type: 'result', payload: retryResult.payload, rawText: retryResult.rawText });
                return;
            }
            const fallback = buildPosFallbackOutput(word, distractors, pos);
            if (fallback) {
                send({ type: 'result', payload: fallback, rawText: lastRawText });
                return;
            }
            throw err;
        }
    } catch (error: any) {
        const rawText = lastRawText || error?.rawText;
        const message = normalizeErrorMessage(error?.message);
        send({ type: 'error', message, rawText });
    }
};

function parseLineOutput(text: string, targetWord: string): AiOutput {
    const lines = stripPreamble(text, ['easy', 'normal', 'advanced', 'cloze', 'a', 'b', 'c', 'd', 'answer', 'explain']);

    const getLine = (label: string) => {
        const match = lines.find((line) => new RegExp(`^${label}\\s*:\\s+`, 'i').test(line));
        if (!match) return '';
        return match.replace(new RegExp(`^${label}\\s*:\\s+`, 'i'), '').trim();
    };

    const easy = getLine('easy');
    const normal = getLine('normal');
    const advanced = getLine('advanced');
    const cloze = getLine('cloze');
    const optionA = getLine('a');
    const optionB = getLine('b');
    const optionC = getLine('c');
    const optionD = getLine('d');
    const answer = getLine('answer').toUpperCase();
    const explanation = getLine('explain');

    if (!easy || !normal || !advanced || !cloze || !optionA || !optionB || !optionC || !optionD || !answer || !explanation) {
        throw new Error('Line output incomplete.');
    }

    if (!containsWord(easy, targetWord) || !containsWord(normal, targetWord) || !containsWord(advanced, targetWord)) {
        throw new Error('Example sentences must include the target word.');
    }

    if (!cloze.includes('____')) {
        throw new Error('Cloze sentence must include "____".');
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
            explanation: trimToWords(explanation, 12),
        },
    };
}

function truncateAtEndTag(text: string): string {
    const match = text.match(/<\/END_JSON>|<END_JSON>/i);
    if (!match || match.index === undefined) return text;
    return text.slice(0, match.index + match[0].length);
}

async function loadGeneratorWithFallback(): Promise<TextGenerationPipelineType> {
    const hasWebGPU = typeof (self as any).navigator?.gpu !== 'undefined';
    const attempts: Array<{ device: 'webgpu' | 'wasm'; dtype: 'q4f16' | 'q4' }> = hasWebGPU
        ? [
            { device: 'webgpu', dtype: 'q4f16' },
            { device: 'wasm', dtype: 'q4' },
        ]
        : [{ device: 'wasm', dtype: 'q4' }];

    let lastError: unknown = null;

    for (const attempt of attempts) {
        try {
            console.info(`[AI Worker] Loading ${MODEL_ID} (device=${attempt.device}, dtype=${attempt.dtype})`);
            const loaded = await pipeline('text-generation', MODEL_ID, {
                device: attempt.device,
                dtype: attempt.dtype,
                progress_callback: (data: any) => {
                    const loaded = Number(data?.loaded ?? 0);
                    const total = Number(data?.total ?? 0);
                    if (total > 0) {
                        send({ type: 'progress', loaded, total });
                    }
                },
            });
            return loaded as TextGenerationPipelineType;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError ?? new Error('Failed to load AI model.');
}

type SentenceFallbackResult = { payload: AiOutput; rawText: string };

async function generateSentenceOnlyFallback(
    targetWord: string,
    level: string,
    distractors: string[],
    pos?: string,
    meaning?: string
): Promise<SentenceFallbackResult | null> {
    if (!generator) return null;
    const prompt = `Write 3 English example sentences using the exact word "${targetWord}".
Think silently before responding.
Target CEFR: ${level}.
POS: ${pos || 'unknown'} (use WORD as that POS if provided).
MEANING: ${meaning || ''}
Constraints: 6-14 words, natural context, no meta language.
Return EXACTLY 3 lines (no extra text):
easy: ...
normal: ...
advanced: ...`;

    try {
        const output = await generator(prompt, {
            max_new_tokens: 160,
            temperature: 0.7,
            top_p: 0.9,
            do_sample: true,
            repetition_penalty: 1.15,
            no_repeat_ngram_size: 3,
            return_full_text: false,
        });

        const rawText = extractGeneratedText(output as any);
        const examples = parseLabeledLines(rawText, targetWord);
        if (!examples) return null;

        const clozeCandidate = buildClozeFromExamples(examples, targetWord);
        if (!clozeCandidate) return null;

        const { sentence: clozeSentence } = clozeCandidate;
        const options = buildOptions(targetWord, distractors, pos);
        if (!options) return null;
        const answerIndex = options.findIndex((opt) => opt.toLowerCase() === targetWord.toLowerCase());
        if (answerIndex === -1) return null;

        return {
            payload: {
                examples: [
                    { difficulty: 'easy', sentence: examples[0] },
                    { difficulty: 'normal', sentence: examples[1] },
                    { difficulty: 'advanced', sentence: examples[2] },
                ],
                cloze: {
                    sentence: clozeSentence,
                    options,
                    answer: ['A', 'B', 'C', 'D'][answerIndex],
                    explanation: 'Best fit for the blank is the target word.',
                },
            },
            rawText,
        };
    } catch {
        return null;
    }
}

function salvageFromRawText(rawText: string, targetWord: string, distractors: string[], pos?: string): AiOutput | null {
    try {
        const labeled = extractLabeledExamples(rawText, targetWord);
        const examples = labeled ?? extractSentencesWithWord(rawText, targetWord);
        if (examples.length < 3) return null;

        const clozeCandidate = buildClozeFromExamples(examples, targetWord);
        if (!clozeCandidate) return null;
        const { sentence: clozeSentence } = clozeCandidate;

        const options = buildOptions(targetWord, distractors, pos);
        if (!options) return null;
        const answerIndex = options.findIndex((opt) => opt.toLowerCase() === targetWord.toLowerCase());
        if (answerIndex === -1) return null;

        return {
            examples: [
                { difficulty: 'easy', sentence: examples[0] },
                { difficulty: 'normal', sentence: examples[1] },
                { difficulty: 'advanced', sentence: examples[2] },
            ],
            cloze: {
                sentence: clozeSentence,
                options,
                answer: ['A', 'B', 'C', 'D'][answerIndex],
                explanation: 'Best fit for the blank is the target word.',
            },
        };
    } catch {
        return null;
    }
}

function extractLabeledExamples(text: string, targetWord: string): string[] | null {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const pick = (label: string) => {
        const match = lines.find((line) => new RegExp(`^${label}\\s*:\\s+`, 'i').test(line));
        if (!match) return null;
        const sentence = match.replace(new RegExp(`^${label}\\s*:\\s+`, 'i'), '').trim();
        return containsWord(sentence, targetWord) ? sentence : null;
    };

    const easy = pick('easy');
    const normal = pick('normal');
    const advanced = pick('advanced');
    if (easy && normal && advanced) return [easy, normal, advanced];
    return null;
}

function buildPosFallbackOutput(targetWord: string, distractors: string[], pos?: string): AiOutput | null {
    const bucket = getPosBucket(targetWord, pos);
    const examples = buildPosSentences(targetWord, bucket);
    if (examples.length < 3) return null;

    const clozeCandidate = buildClozeFromExamples(examples, targetWord);
    if (!clozeCandidate) return null;

    const options = buildOptions(targetWord, distractors, pos);
    if (!options) return null;
    const answerIndex = options.findIndex((opt) => opt.toLowerCase() === targetWord.toLowerCase());
    if (answerIndex === -1) return null;

    return {
        examples: [
            { difficulty: 'easy', sentence: examples[0] },
            { difficulty: 'normal', sentence: examples[1] },
            { difficulty: 'advanced', sentence: examples[2] },
        ],
        cloze: {
            sentence: clozeCandidate.sentence,
            options,
            answer: ['A', 'B', 'C', 'D'][answerIndex],
            explanation: 'Best fit for the blank is the target word.',
        },
    };
}

function buildPosSentences(targetWord: string, bucket: ReturnType<typeof getPosBucket>): string[] {
    switch (bucket) {
        case 'adv':
            return [
                `She answered ${targetWord} and stayed calm.`,
                `They worked ${targetWord} to meet the deadline.`,
                `He reacted ${targetWord} when the plan changed.`,
            ];
        case 'adj':
            return [
                `The solution was ${targetWord} and easy to apply.`,
                `She gave a ${targetWord} response to the feedback.`,
                `It was a ${targetWord} choice for the team.`,
            ];
        case 'noun':
            return [
                `The ${targetWord} affected their final decision.`,
                `We discussed the ${targetWord} for several minutes.`,
                `Her ${targetWord} influenced the entire project.`,
            ];
        case 'verb':
            return [
                `They ${targetWord} the proposal before voting.`,
                `We must ${targetWord} the details before noon.`,
                `She will ${targetWord} the results tomorrow.`,
            ];
        default:
            return [
                `The ${targetWord} changed how we planned the trip.`,
                `They explored the ${targetWord} in the afternoon.`,
                `We returned to the ${targetWord} after lunch.`,
            ];
    }
}
function extractSentencesWithWord(text: string, targetWord: string): string[] {
    const cleaned = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];
    const parts = cleaned.split(/[.!?]\s+/);
    const matches: string[] = [];
    for (const part of parts) {
        const sentence = part.trim();
        if (!sentence) continue;
        if (containsWord(sentence, targetWord) && isValidSentence(sentence) && !hasMetaLanguage(sentence)) {
            matches.push(sentence.endsWith('.') ? sentence : `${sentence}.`);
        }
        if (matches.length >= 3) break;
    }
    return matches;
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

function buildOptions(targetWord: string, distractors: string[], pos?: string): string[] | null {
    const bucket = getPosBucket(targetWord, pos);
    const candidates = filterByBucket(distractors, bucket, targetWord);
    const picked = pickUnique(candidates, targetWord, 3);
    if (!picked) return null;
    const options = shuffle([targetWord, ...picked]);
    return options;
}

function getPosBucket(word: string, pos?: string): 'noun' | 'verb' | 'adj' | 'adv' | 'unknown' {
    const posBucket = normalizePosBucket(pos);
    if (posBucket !== 'unknown') return posBucket;
    const lower = word.toLowerCase();
    if (/(ly)$/.test(lower)) return 'adv';
    if (/(tion|ment|ness|ity|ship|ism)$/.test(lower)) return 'noun';
    if (/(able|ible|ous|ive|al|ic|ful|less)$/.test(lower)) return 'adj';
    if (/(ing|ed|ify|ise|ize|en)$/.test(lower)) return 'verb';
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

function filterByBucket(values: string[], bucket: string, targetWord: string): string[] {
    const normalizedTarget = targetWord.toLowerCase();
    const unique = Array.from(new Set(values.map((val) => val.trim()).filter(Boolean)));
    const filtered = unique
        .filter((val) => val.toLowerCase() !== normalizedTarget)
        .filter((val) => isSingleWord(val));
    if (bucket === 'unknown') return filtered;
    const bucketed = filtered.filter((val) => getPosBucket(val) === bucket);
    return bucketed.length >= 3 ? bucketed : filtered;
}

function pickUnique(values: string[], targetWord: string, count: number): string[] | null {
    const normalizedTarget = targetWord.toLowerCase();
    const pool = values.filter((val) => val.toLowerCase() !== normalizedTarget);
    if (pool.length < count) return null;
    shuffle(pool);
    return pool.slice(0, count);
}

function parseLabeledLines(text: string, targetWord: string): string[] | null {
    const lines = stripPreamble(text, ['easy', 'normal', 'advanced']);
    const pick = (label: string) => {
        const match = lines.find((line) => new RegExp(`^${label}\\s*:\\s+`, 'i').test(line));
        if (!match) return null;
        const sentence = match.replace(new RegExp(`^${label}\\s*:\\s+`, 'i'), '').trim();
        if (!containsWord(sentence, targetWord)) return null;
        if (!isValidSentence(sentence) || hasMetaLanguage(sentence)) return null;
        return sentence;
    };

    const easy = pick('easy');
    const normal = pick('normal');
    const advanced = pick('advanced');
    if (easy && normal && advanced) return [easy, normal, advanced];
    return null;
}

function buildClozeFromExamples(examples: string[], targetWord: string): { sentence: string; sourceIndex: number } | null {
    const order = [1, 0, 2];
    for (const idx of order) {
        const sentence = examples[idx];
        if (!sentence || isMetaSentence(sentence)) continue;
        const replaced = replaceWord(sentence, targetWord, '____');
        if (replaced.includes('____')) {
            return { sentence: replaced, sourceIndex: idx };
        }
    }
    return null;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isMetaSentence(sentence: string): boolean {
    return /use(?:s|d)? the word/i.test(sentence) || hasMetaLanguage(sentence);
}

function shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
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
    const labelRegex = new RegExp(`^(${labels.join('|')})\\s*:`, 'i');
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
    return !/\s/.test(value.trim());
}

function isDegenerateOutput(text: string): boolean {
    const cleaned = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!cleaned) return true;
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
