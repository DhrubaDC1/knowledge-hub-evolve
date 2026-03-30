import OpenAI from 'openai';

const MAX_TEXT_LENGTH = 10_000;
const SYSTEM_PROMPT = 'You are a knowledge assistant. Summarize the following into 2-3 concise sentences that capture the key insight. Be specific, not vague.';

function sendJson(res, statusCode, payload) {
    return res.status(statusCode).json(payload);
}

function parseRequestBody(req) {
    if (!req.body) {
        return {};
    }

    if (typeof req.body === 'string') {
        try {
            return JSON.parse(req.body);
        } catch (error) {
            return null;
        }
    }

    if (typeof req.body === 'object') {
        return req.body;
    }

    return null;
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return sendJson(res, 200, { ok: true });
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
    }

    const body = parseRequestBody(req);

    if (!body) {
        return sendJson(res, 400, { error: 'Invalid JSON body.' });
    }

    const text = typeof body.text === 'string' ? body.text.trim() : '';

    if (!text) {
        return sendJson(res, 400, { error: 'Text is required.' });
    }

    if (text.length > MAX_TEXT_LENGTH) {
        return sendJson(res, 400, { error: `Text must be ${MAX_TEXT_LENGTH} characters or fewer.` });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        return sendJson(res, 500, { error: 'OPENAI_API_KEY is not configured.' });
    }

    try {
        const openai = new OpenAI({ apiKey });

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: text }
            ]
        });

        const summary = completion.choices[0]?.message?.content?.trim();

        if (!summary) {
            return sendJson(res, 502, { error: 'OpenAI returned an empty summary.' });
        }

        return sendJson(res, 200, { summary });
    } catch (error) {
        console.error('OpenAI request failed.', error);
        return sendJson(res, 502, {
            error: error instanceof Error ? error.message : 'Failed to generate summary.'
        });
    }
}
