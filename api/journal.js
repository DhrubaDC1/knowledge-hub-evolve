import { readJournalData } from '../lib/journal.js';

function sendJson(res, statusCode, payload) {
    return res.status(statusCode).json(payload);
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return sendJson(res, 200, { ok: true });
    }

    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET, OPTIONS');
        return sendJson(res, 405, { error: 'Method not allowed. Use GET.' });
    }

    try {
        const journal = await readJournalData();
        return sendJson(res, 200, journal);
    } catch (error) {
        console.error('Failed to read journal.', error);
        return sendJson(res, 500, {
            error: error instanceof Error ? error.message : 'Failed to read journal.'
        });
    }
}
