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
};

type WorkerResponse =
    | { type: 'status'; status: 'loading-model' | 'model-ready' | 'generating' }
    | { type: 'progress'; loaded: number; total: number }
    | { type: 'result'; payload: AiOutput }
    | { type: 'error'; message: string };

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

const MODEL_ID = 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA';
let generator: TextGenerationPipelineType | null = null;

const send = (message: WorkerResponse) => {
    self.postMessage(message);
};

const promptTemplate = ({
    word,
    level,
    meaning,
}: {
    word: string;
    level: string;
    meaning?: string;
}) => `You are an English teaching assistant. Respond with JSON only, wrapped in <BEGIN_JSON> ... </END_JSON>. No other text.
Schema:
{
  "examples":[
    {"difficulty":"easy","sentence":""},
    {"difficulty":"normal","sentence":""},
    {"difficulty":"advanced","sentence":""}
  ],
  "cloze":{
    "sentence":"",
    "options":["","","",""],
    "answer":"",
    "explanation":""
  }
}
Rules:
- Use the exact target word "${word}" in all example sentences.
- Target CEFR level: ${level}; difficulty labels must be "easy","normal","advanced".
- Cloze sentence must contain "____" in place of the target word.
- Provide 4 short options (A-D). Exactly one is correct. Answer is the letter (A-D).
- Explanation <= 20 words. English only.
${meaning ? `- Word meaning/context: ${meaning}` : ''}
Return format (no prose): <BEGIN_JSON>{...}</END_JSON>`;

self.onmessage = async (event: MessageEvent<GenerateMessage>) => {
    const data = event.data;
    if (!data || data.type !== 'generate') return;

    const { word, level, meaning } = data;

    try {
        if (!generator) {
            send({ type: 'status', status: 'loading-model' });
            const loaded = await pipeline('text-generation', MODEL_ID, {
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

        const attempts = [
            { temperature: 0.3, do_sample: true, extra: '' },
            {
                temperature: 0.2,
                do_sample: false,
                extra: '\nIMPORTANT: Output ONLY <BEGIN_JSON>{...}</END_JSON> with no other text.',
            },
        ];

        let lastError: Error | null = null;

        for (const attempt of attempts) {
            try {
                const prompt = promptTemplate({ word, level, meaning }) + attempt.extra;
                const messages = [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: prompt },
                ];
                const output = await generator(messages, {
                    max_new_tokens: 280,
                    temperature: attempt.temperature,
                    do_sample: attempt.do_sample,
                    return_full_text: false,
                });

                const rawText = extractGeneratedText(output as any);
                const parsed = parseJsonOutput(rawText);
                const validated = validatePayload(parsed, word);

                send({ type: 'result', payload: validated });
                return;
            } catch (err: any) {
                lastError = err instanceof Error ? err : new Error(String(err));
            }
        }

        throw lastError ?? new Error('Failed to generate content.');
    } catch (error: any) {
        const message = error?.message || 'Failed to generate content.';
        send({ type: 'error', message });
    }
};

function parseJsonOutput(text: string): AiOutput {
    const trimmed = text.trim();

    // Prefer explicit BEGIN/END tags
    const tagged = extractBetweenTags(trimmed, 'BEGIN_JSON', 'END_JSON');
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

function extractBetweenTags(text: string, startTag: string, endTag: string): string | null {
    const start = text.indexOf(`<${startTag}>`);
    const end = text.indexOf(`</${endTag}>`);
    if (start === -1 || end === -1 || end <= start) return null;
    const content = text.slice(start + startTag.length + 2, end);
    return content.trim();
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

    const examples: AiExample[] = ['easy', 'normal', 'advanced'].map((difficulty, index) => {
        const item = examplesRaw.find((ex) => ex?.difficulty?.toLowerCase?.() === difficulty) ?? examplesRaw[index] ?? {};
        const sentence = typeof item.sentence === 'string' ? item.sentence.trim() : '';

        if (!sentence) {
            throw new Error(`Missing ${difficulty} sentence.`);
        }
        if (!sentence.toLowerCase().includes(targetWord.toLowerCase())) {
            throw new Error(`The ${difficulty} sentence must include the target word.`);
        }
        return { difficulty, sentence };
    });

    const clozeRaw = payload.cloze || {};
    const clozeSentence = typeof clozeRaw.sentence === 'string' ? clozeRaw.sentence.trim() : '';
    if (!clozeSentence || !clozeSentence.includes('____')) {
        throw new Error('Cloze sentence must include "____".');
    }

    const optionsRaw: string[] = Array.isArray(clozeRaw.options) ? clozeRaw.options : [];
    const options = optionsRaw
        .map((opt) => (typeof opt === 'string' ? opt.trim() : ''))
        .filter(Boolean);
    if (options.length !== 4) {
        throw new Error('Cloze options must have 4 items.');
    }

    const answerRaw = typeof clozeRaw.answer === 'string' ? clozeRaw.answer.trim() : '';
    const answerIndex = parseAnswerIndex(answerRaw, options);
    if (answerIndex === -1) {
        throw new Error('Cloze answer must match one option (A-D).');
    }
    const answer = ['A', 'B', 'C', 'D'][answerIndex];

    const explanationRaw = typeof clozeRaw.explanation === 'string' ? clozeRaw.explanation.trim() : '';
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

function parseAnswerIndex(answer: string, options: string[]): number {
    if (!answer) return -1;
    const letter = answer[0].toUpperCase();
    const letterIndex = ['A', 'B', 'C', 'D'].indexOf(letter);
    if (letterIndex >= 0) return letterIndex;

    // Try to match by option text
    const normalized = answer.toLowerCase();
    const idx = options.findIndex((opt) => opt.toLowerCase() === normalized);
    return idx;
}

function trimToWords(text: string, maxWords: number): string {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return words.join(' ');
    return words.slice(0, maxWords).join(' ');
}

// fallbacks removed: rely on model output + retries
