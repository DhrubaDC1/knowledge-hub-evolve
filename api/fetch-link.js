import { fetchLinkMetadata } from '../lib/fetch-link.js';

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

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
    setCorsHeaders(res);

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

    const url = typeof body.url === 'string' ? body.url.trim() : '';

    if (!url) {
        return sendJson(res, 400, { error: 'URL is required.' });
    }

    try {
        const metadata = await fetchLinkMetadata(url);
        return sendJson(res, 200, metadata);
    } catch (error) {
        return sendJson(res, error?.statusCode || 500, {
            error: error instanceof Error ? error.message : 'Failed to fetch URL metadata.'
        });
    }
}
