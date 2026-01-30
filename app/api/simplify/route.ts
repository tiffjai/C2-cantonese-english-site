import { NextRequest, NextResponse } from 'next/server';
import { callGroq, extractJson } from '@/lib/groq';
import { buildSimplifyPrompt, buildRepairPrompt, type TargetLevel, type SimplifyStrength } from '@/lib/prompts/simplify';
import type { SimplifyResponse, SimplifyChunk, VocabTerm } from '@/lib/types';

interface RequestBody {
    passage: string;
    target_level?: TargetLevel;
    strength?: SimplifyStrength;
}

function validateResponse(data: unknown): data is SimplifyResponse {
    if (!data || typeof data !== 'object') return false;

    const obj = data as Record<string, unknown>;

    if (typeof obj.level !== 'string') return false;
    if (!Array.isArray(obj.chunks)) return false;
    if (!obj.vocab_map || typeof obj.vocab_map !== 'object') return false;

    // Validate chunks
    for (const chunk of obj.chunks) {
        if (typeof chunk !== 'object' || chunk === null) return false;
        const c = chunk as Record<string, unknown>;
        if (typeof c.id !== 'number') return false;
        if (typeof c.original !== 'string') return false;
        if (typeof c.simple !== 'string') return false;
        if (!Array.isArray(c.vocab_ids)) return false;
    }

    // Validate vocab_map entries
    const vocabMap = obj.vocab_map as Record<string, unknown>;
    for (const [key, value] of Object.entries(vocabMap)) {
        if (typeof value !== 'object' || value === null) return false;
        const v = value as Record<string, unknown>;
        if (typeof v.simple_surface !== 'string') return false;
        if (typeof v.difficult_surface !== 'string') return false;
        if (typeof v.meaning_plain !== 'string') return false;
    }

    return true;
}

export async function POST(request: NextRequest) {
    try {
        const body: RequestBody = await request.json();

        if (!body.passage || typeof body.passage !== 'string') {
            return NextResponse.json(
                { error: 'passage is required and must be a string' },
                { status: 400 }
            );
        }

        if (body.passage.trim().length < 50) {
            return NextResponse.json(
                { error: 'Passage must be at least 50 characters long' },
                { status: 400 }
            );
        }

        if (body.passage.length > 10000) {
            return NextResponse.json(
                { error: 'Passage must be less than 10,000 characters' },
                { status: 400 }
            );
        }

        // Validate target_level if provided
        if (body.target_level && !['A2', 'B1', 'B2'].includes(body.target_level)) {
            return NextResponse.json(
                { error: 'target_level must be A2, B1, or B2' },
                { status: 400 }
            );
        }

        // Validate strength if provided
        if (body.strength && !['light', 'medium', 'strong'].includes(body.strength)) {
            return NextResponse.json(
                { error: 'strength must be light, medium, or strong' },
                { status: 400 }
            );
        }

        const prompt = buildSimplifyPrompt(body.passage, {
            targetLevel: body.target_level,
            strength: body.strength,
        });

        // First attempt
        let response = await callGroq([
            {
                role: 'system',
                content: 'You are a language simplification expert. Return ONLY valid JSON, no markdown formatting, no explanations.',
            },
            {
                role: 'user',
                content: prompt,
            },
        ], {
            temperature: 0.3,
            maxTokens: 4000,
        });

        let jsonString = extractJson(response.content);
        let parsed: unknown;

        try {
            parsed = JSON.parse(jsonString);
        } catch {
            // JSON parsing failed, try repair
            console.log('[Simplify API] JSON parse failed, attempting repair...');

            const repairResponse = await callGroq([
                {
                    role: 'system',
                    content: 'Return valid JSON only. No markdown. Keep content the same, fix syntax only.',
                },
                {
                    role: 'user',
                    content: buildRepairPrompt(jsonString),
                },
            ], {
                temperature: 0.1,
                maxTokens: 4000,
            });

            jsonString = extractJson(repairResponse.content);
            try {
                parsed = JSON.parse(jsonString);
            } catch (e) {
                console.error('[Simplify API] Repair failed:', e);
                return NextResponse.json(
                    { error: 'Failed to parse LLM response as JSON after repair attempt' },
                    { status: 500 }
                );
            }
        }

        // Validate the response structure
        if (!validateResponse(parsed)) {
            console.error('[Simplify API] Invalid response structure:', parsed);
            return NextResponse.json(
                { error: 'LLM response is missing required fields' },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            data: parsed,
        });

    } catch (error: unknown) {
        console.error('[Simplify API] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to simplify passage';
        return NextResponse.json(
            { error: message },
            { status: 500 }
        );
    }
}
