import 'dotenv/config';

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchLinkMetadata } from './lib/fetch-link.js';
import { readJournalData } from './lib/journal.js';
import { createExternalNote } from './lib/save-external.js';
import { searchNotes } from './lib/search.js';
import { suggestTags } from './lib/suggest-tags.js';
import { MAX_TEXT_LENGTH, summarizeText } from './lib/summarize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(payload));
}

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function readJsonBody(req) {
    const chunks = [];

    for await (const chunk of req) {
        chunks.push(chunk);
    }

    if (!chunks.length) {
        return {};
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
        return null;
    }
}

async function handleSummarize(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        return sendJson(res, 200, { ok: true });
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
    }

    const body = await readJsonBody(req);

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

async function handleFetchLink(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        return sendJson(res, 200, { ok: true });
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
    }

    const body = await readJsonBody(req);

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

async function handleSearch(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        return sendJson(res, 200, { ok: true });
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
    }

    const body = await readJsonBody(req);

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

async function handleSuggestTags(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        return sendJson(res, 200, { ok: true });
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
    }

    const body = await readJsonBody(req);

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

async function handleJournal(req, res) {
    setCorsHeaders(res);

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

async function handleSaveExternal(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        return sendJson(res, 200, { ok: true });
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
    }

    const body = await readJsonBody(req);

    if (!body) {
        return sendJson(res, 400, { error: 'Invalid JSON body.' });
    }

    try {
        const note = createExternalNote(body);

        return sendJson(res, 200, {
            ok: true,
            note
        });
    } catch (error) {
        console.error('Failed to process external capture.', error);

        return sendJson(res, error?.statusCode || 500, {
            error: error instanceof Error ? error.message : 'Failed to process external capture.'
        });
    }
}

async function handleStaticAsset(req, res, pathname) {
    const isAppRoute = pathname === '/' || pathname === '/journal' || pathname === '/journal/';
    const relativePath = isAppRoute ? 'index.html' : pathname.replace(/^\/+/, '');
    const assetPath = path.resolve(PUBLIC_DIR, relativePath);

    if (!assetPath.startsWith(PUBLIC_DIR)) {
        sendJson(res, 403, { error: 'Forbidden.' });
        return;
    }

    try {
        const fileContents = await readFile(assetPath);
        const extension = path.extname(assetPath).toLowerCase();

        res.writeHead(200, {
            'Content-Type': MIME_TYPES[extension] || 'application/octet-stream'
        });
        res.end(fileContents);
    } catch (error) {
        if (pathname !== '/') {
            sendJson(res, 404, { error: 'Not found.' });
            return;
        }

        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Failed to load the app.');
    }
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (url.pathname === '/api/summarize') {
        await handleSummarize(req, res);
        return;
    }

    if (url.pathname === '/api/fetch-link') {
        await handleFetchLink(req, res);
        return;
    }

    if (url.pathname === '/api/search') {
        await handleSearch(req, res);
        return;
    }

    if (url.pathname === '/api/suggest-tags') {
        await handleSuggestTags(req, res);
        return;
    }

    if (url.pathname === '/api/journal') {
        await handleJournal(req, res);
        return;
    }

    if (url.pathname === '/api/save-external') {
        await handleSaveExternal(req, res);
        return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed.' });
        return;
    }

    await handleStaticAsset(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
    console.log(`Knowledge Hub dev server listening on http://${HOST}:${PORT}`);
});
