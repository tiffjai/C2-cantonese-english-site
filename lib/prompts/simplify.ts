// Prompt builder for passage simplification

export type TargetLevel = 'A2' | 'B1' | 'B2';
export type SimplifyStrength = 'light' | 'medium' | 'strong';

export interface SimplifyParams {
    targetLevel?: TargetLevel;
    strength?: SimplifyStrength;
}

const STRENGTH_DESCRIPTIONS: Record<SimplifyStrength, string> = {
    light: 'Replace only the most difficult C2 vocabulary. Keep most original phrasing.',
    medium: 'Replace difficult vocabulary and simplify complex sentence structures moderately.',
    strong: 'Simplify aggressively. Use basic vocabulary and short, clear sentences.',
};

const LEVEL_DESCRIPTIONS: Record<TargetLevel, string> = {
    A2: 'Elementary - Very simple vocabulary, short sentences, common everyday words only.',
    B1: 'Intermediate - Clear, standard vocabulary. Avoid idioms and complex academic terms.',
    B2: 'Upper-Intermediate - Most general vocabulary is fine. Only replace highly specialized or rare terms.',
};

export function buildSimplifyPrompt(passage: string, params: SimplifyParams = {}): string {
    const { targetLevel = 'B1', strength = 'medium' } = params;

    return `You are a language simplification expert. Simplify the following C2-level passage to ${targetLevel} level.

TARGET LEVEL: ${targetLevel} - ${LEVEL_DESCRIPTIONS[targetLevel]}
SIMPLIFICATION STRENGTH: ${strength} - ${STRENGTH_DESCRIPTIONS[strength]}

RULES:
1. Split the passage into 6-12 chunks (1-3 sentences each). Preserve paragraph breaks.
2. For each chunk, provide the original text and a simplified version.
3. In the simplified text, mark toggleable vocabulary with [[term_id|simple_surface]].
4. Create a vocab_map with entries for each term_id.
5. CRITICAL: "difficult_surface" MUST be an EXACT substring copied from the ORIGINAL passage (character-for-character).
6. Preserve numbers, dates, proper names, and direct quotes exactly.
7. Keep uncertainty markers (may, might, suggests, could) - do not make claims stronger.
8. Do NOT add new facts or information not in the original.
9. Aim for ~6-20 vocabulary terms per 400 words.
10. Use term IDs like t1, t2, t3, etc.

OUTPUT FORMAT (valid JSON only, no markdown, no commentary):
{
  "level": "${targetLevel}",
  "chunks": [
    {
      "id": 1,
      "original": "The exact original text for this chunk.",
      "simple": "The [[t1|easier]] version with marked [[t2|vocabulary]].",
      "vocab_ids": ["t1", "t2"]
    }
  ],
  "vocab_map": {
    "t1": {
      "simple_surface": "easier",
      "difficult_surface": "arduous",
      "meaning_plain": "Something that takes a lot of effort",
      "pos": "adjective"
    },
    "t2": {
      "simple_surface": "vocabulary",
      "difficult_surface": "lexicon",
      "meaning_plain": "The words used in a language",
      "pos": "noun"
    }
  },
  "overall_notes": ["Any general notes about the simplification"]
}

PASSAGE TO SIMPLIFY:
"""
${passage}
"""

Respond with valid JSON only. No explanations before or after.`;
}

export function buildRepairPrompt(brokenJson: string): string {
    return `The following JSON is malformed. Fix it and return ONLY valid JSON. Keep all content the same, just fix syntax errors.

BROKEN JSON:
${brokenJson}

Return ONLY the fixed JSON, no explanations.`;
}
