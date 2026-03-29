import { analyzePatterns } from '../lib/analyze-patterns.js';

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

    const notes = Array.isArray(body.notes) ? body.notes : null;

    if (!notes) {
        return sendJson(res, 400, { error: 'Notes must be an array.' });
    }

    try {
        return sendJson(res, 200, analyzePatterns(notes));
    } catch (error) {
        console.error('Failed to analyze note patterns.', error);
        return sendJson(res, 500, {
            error: error instanceof Error ? error.message : 'Failed to analyze note patterns.'
        });
    }
}
