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

        const outputAny = output as any;
        const rawText = Array.isArray(outputAny)
            ? outputAny[0]?.generated_text ?? ''
            : outputAny?.generated_text ?? '';

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
    try {
        return JSON.parse(trimmed);
    } catch {
        // Try to extract the first JSON object
        const match = trimmed.match(/\{[\s\S]*\}/);
        if (!match) {
            throw new Error('Model did not return JSON.');
        }
        try {
            return JSON.parse(match[0]);
        } catch {
            throw new Error('Model returned invalid JSON.');
        }
    }
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
        const item = examplesRaw.find((ex) => ex?.difficulty?.toLowerCase() === difficulty) ?? examplesRaw[index] ?? {};
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
    const options = optionsRaw.slice(0, 4).map((opt) => (typeof opt === 'string' ? opt.trim() : '')).filter(Boolean);
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
    const explanation = trimToWords(explanationRaw || 'Short explanation.', 20);

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
