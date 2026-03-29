import { extractInsights } from '../lib/extract-insights.js';

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
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';

    if (!text && !summary) {
        return sendJson(res, 400, { error: 'Text or summary is required.' });
    }

    try {
        const insights = await extractInsights({ text, summary });
        return sendJson(res, 200, { insights });
    } catch (error) {
        console.error('Failed to extract insights.', error);
        return sendJson(res, error?.statusCode || 500, {
            error: error instanceof Error ? error.message : 'Failed to extract insights.'
        });
    }
}
