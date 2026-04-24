// netlify/functions/grade.js
// Server-side proxy for Gemini grading. Keeps GEMINI_API_KEY off the client.
// Runs on Netlify Functions 2.0 (Node 20, Web standard Request/Response).

const ALLOWED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-pro']);
const GEMINI_TIMEOUT_MS = 12000;

export default async (req) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const { step, sentence, rubric, studentInput, model } = body || {};

    if (![1, 2].includes(step)) return json({ error: 'step must be 1 or 2' }, 400);
    if (typeof sentence !== 'string' || !sentence.trim()) return json({ error: 'Missing sentence' }, 400);
    if (typeof studentInput !== 'string' || !studentInput.trim()) return json({ error: 'Missing studentInput' }, 400);
    if (!rubric || typeof rubric !== 'object') return json({ error: 'Missing rubric' }, 400);

    // Cap student input length to discourage prompt stuffing
    const trimmedInput = studentInput.trim().slice(0, 1000);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return json({ error: 'Server misconfigured: GEMINI_API_KEY not set' }, 500);

    const useModel = ALLOWED_MODELS.has(model) ? model : 'gemini-2.5-flash';
    const { prompt, schema } = buildPromptAndSchema(step, sentence, rubric, trimmedInput);

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(useModel)}:generateContent`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    let geminiResp;
    try {
        geminiResp = await fetch(geminiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: schema,
                    temperature: 0.2,
                    maxOutputTokens: 1000
                }
            }),
            signal: controller.signal
        });
    } catch (err) {
        clearTimeout(timeoutId);
        const aborted = err && err.name === 'AbortError';
        return json({ error: aborted ? 'Gemini request timed out' : 'Gemini request failed', detail: String(err) }, 504);
    }
    clearTimeout(timeoutId);

    if (!geminiResp.ok) {
        const errText = await geminiResp.text().catch(() => '');
        return json({
            error: 'Gemini API error',
            upstreamStatus: geminiResp.status,
            detail: errText.slice(0, 500)
        }, 502);
    }

    let data;
    try {
        data = await geminiResp.json();
    } catch {
        return json({ error: 'Invalid Gemini response (not JSON)' }, 502);
    }

    const candidate = data?.candidates?.[0];
    const finishReason = candidate?.finishReason || 'UNKNOWN';
    const text = candidate?.content?.parts?.[0]?.text;

    if (!text) {
        console.error('[grade] Empty Gemini response. finishReason=' + finishReason, JSON.stringify(data).slice(0, 500));
        return json({ error: 'Empty Gemini response', finishReason }, 502);
    }

    const parsed = tryParseJson(text);
    if (!parsed) {
        console.error('[grade] Non-JSON Gemini text. finishReason=' + finishReason + ' text=' + text.slice(0, 500));
        return json({
            error: 'Gemini returned non-JSON text',
            finishReason,
            text: text.slice(0, 500)
        }, 502);
    }

    return json(parsed, 200);
};

// Defensive JSON parser: handles Gemini's occasional markdown-fenced or
// preamble-wrapped responses even when responseMimeType is set to application/json.
function tryParseJson(raw) {
    // 1. Straight parse
    try { return JSON.parse(raw); } catch {}

    let s = String(raw).trim();

    // 2. Strip markdown code fences (```json ... ``` or ``` ... ```)
    s = s.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?\s*```\s*$/, '').trim();
    try { return JSON.parse(s); } catch {}

    // 3. Extract substring from first { to last } (handles preamble/postamble)
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) {
        const candidate = s.substring(first, last + 1);
        try { return JSON.parse(candidate); } catch {}
    }

    return null;
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
}

function buildPromptAndSchema(step, sentence, rubric, studentInput) {
    if (step === 1) {
        const prompt =
            'You are a GRE verbal coach evaluating a student\'s clue analysis for a Sentence Equivalence question.\n\n' +
            `SENTENCE: "${sentence}"\n` +
            `EXPECTED PIVOT (structural signal word): "${rubric.pivot || ''}"\n` +
            `EXPECTED KEY CLUE (descriptive phrase that defines the blank): "${rubric.keyClue || ''}"\n\n` +
            `STUDENT ANALYSIS: "${studentInput}"\n\n` +
            'Evaluate leniently — accept synonyms and paraphrases.\n\n' +
            'Output ONLY a JSON object with these fields. No preamble, no explanation outside the object, no markdown fences.\n' +
            '- pivotFound (boolean): did the student identify the pivot (or equivalent)?\n' +
            '- clueFound (boolean): did the student identify the key clue (or equivalent phrase)?\n' +
            '- nudge (string, 22 words max): one coaching sentence addressed to "you". Be specific about what they got and what to push for. Do not reveal the answer.';
        const schema = {
            type: 'object',
            properties: {
                pivotFound: { type: 'boolean' },
                clueFound: { type: 'boolean' },
                nudge: { type: 'string' }
            },
            required: ['pivotFound', 'clueFound', 'nudge']
        };
        return { prompt, schema };
    }

    // step === 2
    const targetMeanings = Array.isArray(rubric.targetMeanings) ? rubric.targetMeanings : [];
    const prompt =
        'You are a GRE verbal coach evaluating a student\'s predicted word for a Sentence Equivalence blank.\n\n' +
        `SENTENCE: "${sentence}"\n` +
        `TARGET MEANINGS (any word with a similar meaning is correct): ${JSON.stringify(targetMeanings)}\n\n` +
        `STUDENT PREDICTION: "${studentInput}"\n\n` +
        'Evaluate leniently — the prediction just needs to be semantically close to one of the target meanings.\n\n' +
        'Output ONLY a JSON object with these fields. No preamble, no explanation outside the object, no markdown fences.\n' +
        '- meaningMatch (boolean): does the prediction match the required meaning?\n' +
        '- nudge (string, 22 words max): one coaching sentence addressed to "you". If correct, affirm briefly. If off, hint at the direction without revealing the answer.';
    const schema = {
        type: 'object',
        properties: {
            meaningMatch: { type: 'boolean' },
            nudge: { type: 'string' }
        },
        required: ['meaningMatch', 'nudge']
    };
    return { prompt, schema };
}
