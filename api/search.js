import { searchNotes } from '../lib/search.js';

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

    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const notes = Array.isArray(body.notes) ? body.notes : null;

    if (!query) {
        return sendJson(res, 400, { error: 'Query is required.' });
    }

    if (!notes) {
        return sendJson(res, 400, { error: 'Notes must be an array.' });
    }

    try {
        const payload = await searchNotes(query, notes);
        return sendJson(res, 200, payload);
    } catch (error) {
        console.error('Failed to search notes.', error);
        return sendJson(res, error?.statusCode || 500, {
            error: error instanceof Error ? error.message : 'Failed to search notes.'
        });
    }
}
