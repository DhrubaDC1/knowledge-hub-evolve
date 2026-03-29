import OpenAI from 'openai';

const MAX_TEXT_LENGTH = 10_000;
const SYSTEM_PROMPT = 'You are a knowledge assistant. Summarize the following into 2-3 concise sentences that capture the key insight. Be specific, not vague.';

let openaiClient;

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

function getOpenAIClient() {
    if (!process.env.OPENAI_API_KEY) {
        return null;
    }

    if (!openaiClient) {
        openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }

    return openaiClient;
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

    const client = getOpenAIClient();

    if (!client) {
        return sendJson(res, 500, { error: 'OPENAI_API_KEY is not configured.' });
    }

    try {
        const completion = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: text }
            ]
        });

        const summary = completion.choices?.[0]?.message?.content?.trim();

        if (!summary) {
            return sendJson(res, 502, { error: 'OpenAI returned an empty summary.' });
        }

        return sendJson(res, 200, { summary });
    } catch (error) {
        console.error('Failed to generate summary.', error);
        return sendJson(res, 500, { error: 'Failed to generate summary.' });
    }
}
