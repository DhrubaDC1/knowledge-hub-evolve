import { extractTextFromPdf } from '../lib/process-pdf.js';

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

    const pdfBase64 = typeof body.pdfBase64 === 'string' ? body.pdfBase64.trim() : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim() : '';

    if (!pdfBase64) {
        return sendJson(res, 400, { error: 'PDF data is required.' });
    }

    try {
        const payload = await extractTextFromPdf({ pdfBase64, mimeType });
        return sendJson(res, 200, payload);
    } catch (error) {
        console.error('Failed to process PDF.', error);
        return sendJson(res, error?.statusCode || 500, {
            error: error instanceof Error ? error.message : 'Failed to process PDF.'
        });
    }
}
