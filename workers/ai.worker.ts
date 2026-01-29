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

const MODEL_ID = 'HuggingFaceTB/SmolLM2-135M-Instruct';
let generator: TextGenerationPipelineType | null = null;

// Configure transformers.js for browser usage
env.allowRemoteModels = true;
env.allowLocalModels = false;

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
}) => `You are an English teaching assistant. Return ONLY valid JSON (no markdown, no explanations) following this schema:
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
- The target CEFR level is ${level}. Keep difficulty labels exactly "easy", "normal", "advanced".
- Cloze sentence must replace the target word with "____".
- Provide 4 short options (A-D). Exactly one is correct. Answer should be the correct option letter (A, B, C, or D).
- Explanation must be <= 20 words. English only.
${meaning ? `- Word meaning/context: ${meaning}` : ''}
Return ONLY the JSON object.`;

self.onmessage = async (event: MessageEvent<GenerateMessage>) => {
    const data = event.data;
    if (!data || data.type !== 'generate') return;

    const { word, level, meaning } = data;

    try {
        if (!generator) {
            send({ type: 'status', status: 'loading-model' });
            const loaded = await pipeline('text-generation', MODEL_ID);
            generator = loaded as TextGenerationPipelineType;
            send({ type: 'status', status: 'model-ready' });
        } else {
            send({ type: 'status', status: 'model-ready' });
        }

        send({ type: 'status', status: 'generating' });

        const prompt = promptTemplate({ word, level, meaning });
        const output = await generator(prompt, {
            max_new_tokens: 220,
            temperature: 0.7,
            do_sample: true,
            return_full_text: false,
        });

        const rawText = extractGeneratedText(output as any);

        const parsed = parseJsonOutput(rawText);
        const validated = validatePayload(parsed, word);

        send({ type: 'result', payload: validated });
    } catch (error: any) {
        const message = error?.message || 'Failed to generate content.';
        send({ type: 'error', message });
    }
};

function parseJsonOutput(text: string): AiOutput {
    const trimmed = text.trim();

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
        const parsed = tryParse(extracted);
        if (parsed) return parsed;
    }

    // 3) attempt lenient fixes (quote keys/single quotes)
    if (extracted) {
        const fixed = normalizeJsonish(extracted);
        const parsed = tryParse(fixed);
        if (parsed) return parsed;
    }

    // 4) fallback: slice from first { to last }
    const sliced = sliceOuterBraces(trimmed);
    if (sliced) {
        const parsed = tryParse(sliced) || tryParse(normalizeJsonish(sliced));
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

function extractGeneratedText(output: any): string {
    if (output == null) return '';

    // Array responses
    if (Array.isArray(output)) {
        const first = output[0];
        if (typeof first === 'string') return first;
        if (first?.generated_text) {
            if (typeof first.generated_text === 'string') return first.generated_text;
            return JSON.stringify(first.generated_text);
        }
    }

    // Direct string
    if (typeof output === 'string') return output;

    // Object with generated_text
    if (output?.generated_text) {
        if (typeof output.generated_text === 'string') return output.generated_text;
        return JSON.stringify(output.generated_text);
    }

    // Fallback
    return '';
}

function validatePayload(payload: any, targetWord: string): AiOutput {
    if (!payload || typeof payload !== 'object') {
        throw new Error('JSON structure missing.');
    }

    const examplesRaw: any[] = Array.isArray(payload.examples) ? payload.examples : [];

    const examples: AiExample[] = ['easy', 'normal', 'advanced'].map((difficulty, index) => {
        const item = examplesRaw.find((ex) => ex?.difficulty?.toLowerCase?.() === difficulty) ?? examplesRaw[index] ?? {};
        let sentence = typeof item.sentence === 'string' ? item.sentence.trim() : '';

        if (!sentence) {
            sentence = fallbackExample(targetWord, difficulty);
        }

        if (!sentence.toLowerCase().includes(targetWord.toLowerCase())) {
            sentence = ensureContainsWord(sentence, targetWord);
        }
        return { difficulty, sentence };
    });

    const clozeRaw = payload.cloze || {};
    const cloze = normalizeCloze(clozeRaw, targetWord);

    return {
        examples,
        cloze,
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

function normalizeCloze(raw: any, targetWord: string): AiCloze {
    let sentence = typeof raw?.sentence === 'string' ? raw.sentence.trim() : '';
    if (!sentence && typeof raw?.prompt === 'string') {
        sentence = raw.prompt.trim();
    }

    if (!sentence) {
        sentence = `The ${targetWord} drifted silently across the frozen bay.`;
    }

    if (!sentence.includes('____')) {
        // replace first occurrence of target word (case-insensitive) with blank
        const regex = new RegExp(targetWord, 'i');
        if (regex.test(sentence)) {
            sentence = sentence.replace(regex, '____');
        } else {
            sentence = sentence + ' ____';
        }
    }

    const optionsRaw: string[] = Array.isArray(raw?.options) ? raw.options : [];
    const cleanedOpts = optionsRaw
        .map((opt) => (typeof opt === 'string' ? opt.trim() : ''))
        .filter(Boolean);

    while (cleanedOpts.length < 4) {
        cleanedOpts.push(generateOption(cleanedOpts.length, targetWord));
    }
    const options = cleanedOpts.slice(0, 4);

    const answerRaw = typeof raw?.answer === 'string' ? raw.answer.trim() : '';
    let answerIndex = parseAnswerIndex(answerRaw, options);
    if (answerIndex === -1) {
        answerIndex = 0;
    }
    const answer = ['A', 'B', 'C', 'D'][answerIndex];

    const explanationRaw = typeof raw?.explanation === 'string' ? raw.explanation.trim() : '';
    const explanation = trimToWords(explanationRaw || 'The correct option fits the blank.', 20);

    return {
        sentence,
        options,
        answer,
        explanation,
    };
}

function generateOption(index: number, word: string): string {
    const suffixes = ['', 's', 'ing', 'ed', 'ly'];
    const variant = word + (suffixes[index % suffixes.length] || '');
    return variant || `Option ${index + 1}`;
}

function fallbackExample(word: string, difficulty: string): string {
    const base = word;
    switch (difficulty) {
        case 'easy':
            return `I hired a ${base} to help with a simple task.`;
        case 'normal':
            return `The ${base} finished the mission quickly because payment came first.`;
        case 'advanced':
            return `Her ${base} mindset overshadowed any notion of loyalty or principle.`;
        default:
            return `Here is a sentence using ${base} in context.`;
    }
}

function ensureContainsWord(sentence: string, word: string): string {
    if (sentence.toLowerCase().includes(word.toLowerCase())) return sentence;
    return `${sentence.trim().replace(/\.*$/, '')}. ${word}`;
}
