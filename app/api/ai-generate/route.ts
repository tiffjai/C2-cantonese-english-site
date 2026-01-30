import { NextRequest, NextResponse } from 'next/server';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function POST(request: NextRequest) {
    if (!GROQ_API_KEY) {
        return NextResponse.json(
            { error: 'Groq API key not configured' },
            { status: 500 }
        );
    }

    try {
        const { word, level, pos, meaning } = await request.json();

        if (!word) {
            return NextResponse.json(
                { error: 'Word is required' },
                { status: 400 }
            );
        }

        const prompt = buildPrompt(word, level, pos, meaning);

        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a vocabulary tutor. Generate example sentences and quizzes for English learners. Follow the exact format requested. Be concise.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 500,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Groq API] Error:', response.status, errorText);
            return NextResponse.json(
                { error: `Groq API error: ${response.status}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        // Parse the response
        const parsed = parseGroqResponse(content, word);

        return NextResponse.json({
            success: true,
            data: parsed,
            rawText: content,
        });
    } catch (error: any) {
        console.error('[Groq API] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to generate content' },
            { status: 500 }
        );
    }
}

function buildPrompt(word: string, level: string, pos?: string, meaning?: string): string {
    const posHint = pos ? ` (${pos})` : '';
    
    return `Generate 3 example sentences and a fill-in-the-blank quiz for the word "${word}"${posHint} at ${level} level.

Format your response EXACTLY like this:
EASY: [Simple sentence using "${word}"]
NORMAL: [Medium complexity sentence using "${word}"]
ADVANCED: [Complex sentence using "${word}"]
CLOZE: [The NORMAL sentence with "${word}" replaced by ____]
A) [wrong answer]
B) [wrong answer]  
C) ${word}
D) [wrong answer]
ANSWER: C
EXPLAIN: [Brief explanation why "${word}" is correct]

Rules:
- Use "${word}" exactly once in each sentence (EASY, NORMAL, ADVANCED)
- Sentences should be 6-14 words
- Options A, B, D should be similar but incorrect words
- Keep EXPLAIN under 20 words`;
}

function parseGroqResponse(content: string, targetWord: string): {
    examples: Array<{ difficulty: string; sentence: string }>;
    cloze: {
        sentence: string;
        options: string[];
        answer: string;
        explanation: string;
    };
} {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    
    const getValue = (prefix: string): string => {
        // Escape special regex characters in prefix
        const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const line = lines.find(l => l.toUpperCase().startsWith(prefix.toUpperCase()));
        if (!line) return '';
        return line.replace(new RegExp(`^${escapedPrefix}[:\\s]*`, 'i'), '').trim();
    };

    const easy = getValue('EASY');
    const normal = getValue('NORMAL');
    const advanced = getValue('ADVANCED');
    const cloze = getValue('CLOZE');
    
    // Parse options more flexibly
    const optionA = getValue('A)') || getValue('A.');
    const optionB = getValue('B)') || getValue('B.');
    const optionC = getValue('C)') || getValue('C.');
    const optionD = getValue('D)') || getValue('D.');
    
    const answer = getValue('ANSWER');
    const explanation = getValue('EXPLAIN');

    // Build cloze sentence - if not provided, create from normal
    let clozeSentence = cloze;
    if (!clozeSentence && normal) {
        const wordRegex = new RegExp(`\\b${escapeRegExp(targetWord)}\\b`, 'i');
        clozeSentence = normal.replace(wordRegex, '____');
    }

    return {
        examples: [
            { difficulty: 'easy', sentence: easy || `The ${targetWord} is important.` },
            { difficulty: 'normal', sentence: normal || `Many people consider ${targetWord} valuable.` },
            { difficulty: 'advanced', sentence: advanced || `The complexity of ${targetWord} requires careful analysis.` },
        ],
        cloze: {
            sentence: clozeSentence || `Many people consider ____ valuable.`,
            options: [
                optionA || 'option1',
                optionB || 'option2',
                optionC || targetWord,
                optionD || 'option4',
            ],
            answer: answer?.charAt(0)?.toUpperCase() || 'C',
            explanation: explanation || `"${targetWord}" fits the context.`,
        },
    };
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
