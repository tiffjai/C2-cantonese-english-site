/// <reference lib="webworker" />
// AI generation worker for browser-only inference

import { pipeline, env, type TextGenerationPipelineType } from '@huggingface/transformers';

declare const self: DedicatedWorkerGlobalScope;
export {};

type GenerateMessage = {
    type: 'generate';
    word: string;
    level: string;
    meaning?: string;
    distractors?: string[];
};

type WorkerResponse =
    | { type: 'status'; status: 'loading-model' | 'model-ready' | 'generating' }
    | { type: 'progress'; loaded: number; total: number }
    | { type: 'result'; payload: AiOutput }
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

const MODEL_ID = 'onnx-community/granite-4.0-350m-ONNX-web';
let generator: TextGenerationPipelineType | null = null;

const send = (message: WorkerResponse) => {
    self.postMessage(message);
};

const promptTemplate = ({
    word,
    level,
}: {
    word: string;
    level: string;
    meaning?: string;
}) => `OUTPUT ONLY JSON BETWEEN TAGS.
<BEGIN_JSON>{"examples":[{"difficulty":"easy","sentence":""},{"difficulty":"normal","sentence":""},{"difficulty":"advanced","sentence":""}],"cloze":{"sentence":"","options":["","","",""],"answer":"","explanation":""}}</END_JSON>
WORD="${word}"
LEVEL="${level}"
Rules:
- Put WORD exactly in all 3 sentences.
- Cloze replaces WORD with ____.
- options must be 4 strings; answer must be "A"|"B"|"C"|"D".
- explanation <= 20 words.
No other text.`;

self.onmessage = async (event: MessageEvent<GenerateMessage>) => {
    const data = event.data;
    if (!data || data.type !== 'generate') return;

    const { word, level, meaning, distractors = [] } = data;

    let lastRawText = '';

    try {
        if (!generator) {
            send({ type: 'status', status: 'loading-model' });
            const hasWebGPU = typeof (self as any).navigator?.gpu !== 'undefined';
            const device = hasWebGPU ? 'webgpu' : 'wasm';
            const dtype = hasWebGPU ? 'q4f16' : 'q4';
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
            generator = loaded as TextGenerationPipelineType;
            send({ type: 'status', status: 'model-ready' });
        } else {
            send({ type: 'status', status: 'model-ready' });
        }

        send({ type: 'status', status: 'generating' });

        const prompt = promptTemplate({ word, level, meaning });
        const output = await generator(prompt, {
            max_new_tokens: 420,
            temperature: 0,
            do_sample: false,
            return_full_text: false,
        });

        const rawText = truncateAtEndTag(extractGeneratedText(output as any));
        lastRawText = rawText;
        try {
            const parsed = parseJsonOutput(rawText);
            const validated = validatePayload(parsed, word);

            send({ type: 'result', payload: validated });
            return;
        } catch (err) {
            const salvaged = salvageFromRawText(rawText, word, distractors);
            if (salvaged) {
                send({ type: 'result', payload: salvaged });
                return;
            }
            const retryPayload = await generateSentenceOnlyFallback(word, level, distractors);
            if (retryPayload) {
                send({ type: 'result', payload: retryPayload });
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

function parseJsonOutput(text: string): AiOutput {
    const trimmed = text.trim();

    // Prefer explicit BEGIN/END tags
    const tagged = extractBetweenTags(trimmed);
    if (tagged) {
        const parsedTag = tryParse(tagged) ?? tryParse(simpleRepair(tagged));
        if (parsedTag) return parsedTag;
    }

    // 1) direct parse
    const direct = tryParse(trimmed);
    if (direct) return direct;

    // 1b) fenced ```json blocks
    const fenced = extractCodeFence(trimmed);
    if (fenced) {
        const parsedFence = tryParse(fenced);
        if (parsedFence) return parsedFence;
        const fixedFence = normalizeJsonish(fenced);
        const parsedFixedFence = tryParse(fixedFence);
        if (parsedFixedFence) return parsedFixedFence;
    }

    // 2) attempt to extract first balanced JSON object
    const extracted = extractFirstJsonObject(trimmed);
    if (extracted) {
        const parsed = tryParse(extracted) ?? tryParse(simpleRepair(extracted));
        if (parsed) return parsed;
    }

    // 3) fallback: slice from first { to last }
    const sliced = sliceOuterBraces(trimmed);
    if (sliced) {
        const parsed = tryParse(sliced) || tryParse(simpleRepair(sliced));
        if (parsed) return parsed;
    }

    throw new Error('Model did not return JSON.');
}

function tryParse<T = any>(text: string): T | null {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function extractFirstJsonObject(text: string): string | null {
    let depth = 0;
    let start = -1;
    let inString: '"' | "'" | null = null;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (inString) {
            if (ch === inString) inString = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            inString = ch;
            continue;
        }
        if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0 && start !== -1) {
                return text.slice(start, i + 1);
            }
        }
    }
    return null;
}

function sliceOuterBraces(text: string): string | null {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return text.slice(start, end + 1);
}

function extractCodeFence(text: string): string | null {
    const match = text.match(/```(?:json)?\\s*([\\s\\S]*?)```/i);
    return match?.[1]?.trim() || null;
}

function extractBetweenTags(text: string): string | null {
    const match = text.match(/<BEGIN_JSON>\s*([\s\S]*?)\s*(?:<\/END_JSON>|<END_JSON>)/i);
    return match?.[1]?.trim() || null;
}

function truncateAtEndTag(text: string): string {
    const match = text.match(/<\/END_JSON>|<END_JSON>/i);
    if (!match || match.index === undefined) return text;
    return text.slice(0, match.index + match[0].length);
}

async function generateSentenceOnlyFallback(
    targetWord: string,
    level: string,
    distractors: string[]
): Promise<AiOutput | null> {
    if (!generator) return null;
    const prompt = `Generate ONLY 3 lines. Each line must contain the exact word "${targetWord}".
easy: ...
normal: ...
advanced: ...
No JSON. No extra text.`;

    try {
        const output = await generator(prompt, {
            max_new_tokens: 180,
            temperature: 0,
            do_sample: false,
            return_full_text: false,
        });

        const rawText = extractGeneratedText(output as any);
        const examples = parseLabeledLines(rawText, targetWord);
        if (!examples) return null;

        const clozeCandidate = buildClozeFromExamples(examples, targetWord);
        if (!clozeCandidate) return null;

        const { sentence: clozeSentence, sourceIndex } = clozeCandidate;
        const options = buildOptions(targetWord, distractors);
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

function salvageFromRawText(rawText: string, targetWord: string, distractors: string[]): AiOutput | null {
    try {
        const labeled = extractLabeledExamples(rawText, targetWord);
        const examples = labeled ?? extractSentencesWithWord(rawText, targetWord);
        if (examples.length < 3) return null;

        const clozeCandidate = buildClozeFromExamples(examples, targetWord);
        if (!clozeCandidate) return null;
        const { sentence: clozeSentence } = clozeCandidate;

        const options = buildOptions(targetWord, distractors);
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

function extractSentencesWithWord(text: string, targetWord: string): string[] {
    const cleaned = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];
    const parts = cleaned.split(/[.!?]\s+/);
    const matches: string[] = [];
    for (const part of parts) {
        const sentence = part.trim();
        if (!sentence) continue;
        if (containsWord(sentence, targetWord)) {
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

function buildOptions(targetWord: string, distractors: string[]): string[] | null {
    const bucket = getPosBucket(targetWord);
    const candidates = filterByBucket(distractors, bucket, targetWord);
    const picked = pickUnique(candidates, targetWord, 3);
    if (!picked) return null;
    const options = shuffle([targetWord, ...picked]);
    return options;
}

function getPosBucket(word: string): 'noun' | 'verb' | 'adj' | 'adv' | 'unknown' {
    const lower = word.toLowerCase();
    if (/(ly)$/.test(lower)) return 'adv';
    if (/(ing|ed|ify|ise|ize|en)$/.test(lower)) return 'verb';
    if (/(ous|able|ible|al|ive|ic|ish|ful|less|ary|ory|y)$/.test(lower)) return 'adj';
    if (/(tion|sion|ment|ness|ity|ance|ence|ship|ism|ist|age|ery|ry|hood|dom)$/.test(lower)) return 'noun';
    return 'unknown';
}

function filterByBucket(values: string[], bucket: string, targetWord: string): string[] {
    const normalizedTarget = targetWord.toLowerCase();
    const unique = Array.from(new Set(values.map((val) => val.trim()).filter(Boolean)));
    const filtered = unique.filter((val) => val.toLowerCase() !== normalizedTarget);
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

function buildClozeFromExamples(examples: string[], targetWord: string): { sentence: string; sourceIndex: number } | null {
    for (let idx = 0; idx < examples.length; idx += 1) {
        const sentence = examples[idx];
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

function normalizeJsonish(text: string): string {
    let fixed = text;
    // Quote bare keys: {foo: "bar"} -> {"foo": "bar"}
    fixed = fixed.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
    // Convert single-quoted strings to double
    fixed = fixed.replace(/'([^']*)'/g, (_m, p1) => `"${p1.replace(/"/g, '\\"')}"`);
    // Remove trailing commas
    fixed = fixed.replace(/,\s*([}\]])/g, '$1');
    return fixed;
}

function simpleRepair(text: string): string {
    // lighter repair: single quotes to double, remove trailing commas
    let fixed = text.replace(/'([^']*)'/g, (_m, p1) => `"${p1.replace(/"/g, '\\"')}"`);
    fixed = fixed.replace(/,\s*([}\]])/g, '$1');
    return fixed;
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
