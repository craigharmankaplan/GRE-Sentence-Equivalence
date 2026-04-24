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
                    temperature: 0.3,
                    maxOutputTokens: 250
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

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: 'Empty Gemini response' }, 502);

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return json({ error: 'Gemini returned non-JSON text', text: text.slice(0, 500) }, 502);
    }

    return json(parsed, 200);
};

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
            'Evaluate leniently — accept synonyms and paraphrases. Respond with JSON containing:\n' +
            '- pivotFound: did they identify the pivot (or equivalent)?\n' +
            '- clueFound: did they identify the key clue (or equivalent phrase)?\n' +
            '- nudge: ONE short coaching sentence (max 22 words) addressed to "you". Be specific about what they got and what to push for. Don\'t reveal the answer.';
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
        'Evaluate leniently — the student\'s prediction just needs to be semantically close to one of the target meanings. Respond with JSON:\n' +
        '- meaningMatch: does their prediction match the required meaning?\n' +
        '- nudge: ONE short coaching sentence (max 22 words) addressed to "you". If correct, affirm briefly. If off, hint at the direction without revealing the answer.';
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
