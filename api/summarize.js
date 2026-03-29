import { MAX_TEXT_LENGTH, summarizeText } from '../lib/summarize.js';

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

    try {
        const summary = await summarizeText(text);
        return sendJson(res, 200, { summary });
    } catch (error) {
        console.error('Failed to generate summary.', error);
        return sendJson(res, error?.statusCode || 500, {
            error: error instanceof Error ? error.message : 'Failed to generate summary.'
        });
    }
}
