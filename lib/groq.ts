// Server-only Groq API wrapper
// DO NOT import this file in client components

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface GroqMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface GroqOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

export interface GroqResponse {
    content: string;
    finishReason: string;
}

/**
 * Call Groq API with messages
 * Server-only - uses process.env.GROQ_API_KEY
 */
export async function callGroq(
    messages: GroqMessage[],
    options: GroqOptions = {}
): Promise<GroqResponse> {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
        throw new Error('GROQ_API_KEY is not configured');
    }

    const {
        model = 'llama-3.1-8b-instant',
        temperature = 0.3,
        maxTokens = 4000,
    } = options;

    const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[Groq API] Error:', response.status, errorText);
        throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const finishReason = data.choices?.[0]?.finish_reason || 'unknown';

    return { content, finishReason };
}

/**
 * Extract JSON from a response that might contain markdown code blocks
 */
export function extractJson(text: string): string {
    // Try to extract from markdown code blocks
    const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
        return jsonBlockMatch[1].trim();
    }

    // Try to find raw JSON object
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return jsonMatch[0];
    }

    return text.trim();
}
