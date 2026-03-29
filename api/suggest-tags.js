import { suggestTags } from '../lib/suggest-tags.js';

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

    const content = typeof body.content === 'string' ? body.content.trim() : '';
    const existingTags = Array.isArray(body.existingTags) ? body.existingTags : null;

    if (!content) {
        return sendJson(res, 400, { error: 'Content is required.' });
    }

    if (!existingTags) {
        return sendJson(res, 400, { error: 'Existing tags must be an array.' });
    }

    try {
        const tags = await suggestTags(content, existingTags);
        return sendJson(res, 200, { tags });
    } catch (error) {
        console.error('Failed to suggest tags.', error);
        return sendJson(res, error?.statusCode || 500, {
            error: error instanceof Error ? error.message : 'Failed to suggest tags.'
        });
    }
}
