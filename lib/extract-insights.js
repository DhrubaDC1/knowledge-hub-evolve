import { MAX_TEXT_LENGTH } from './summarize.js';

const SYSTEM_PROMPT = 'You are a knowledge assistant. Return 1-3 concise bullet-point insights based on the provided note and summary. Each bullet should highlight a distinct takeaway. Be specific, concrete, and avoid repeating the summary verbatim.';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function createHttpError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function getGeminiApiKey() {
    return process.env.GEMINI_API_KEY || '';
}

function getGeminiModel() {
    return process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
}

function getGeminiTextFromResponse(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;

    if (!Array.isArray(parts)) {
        return '';
    }

    return parts
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('')
        .trim();
}

function normalizeInsights(value) {
    if (typeof value !== 'string') {
        return [];
    }

    const insights = [];
    const seen = new Set();

    value
        .split(/\n+/)
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim())
        .filter(Boolean)
        .forEach((line) => {
            const normalizedLine = line.toLowerCase();

            if (seen.has(normalizedLine) || insights.length >= 3) {
                return;
            }

            seen.add(normalizedLine);
            insights.push(line);
        });

    return insights;
}

function createPrompt(text, summary) {
    const sections = [];

    if (summary) {
        sections.push(`Summary:\n${summary}`);
    }

    if (text) {
        sections.push(`Original note:\n${text}`);
    }

    return sections.join('\n\n');
}

export async function extractInsights({ text = '', summary = '' } = {}, fetchImpl = fetch) {
    const normalizedText = typeof text === 'string' ? text.trim() : '';
    const normalizedSummary = typeof summary === 'string' ? summary.trim() : '';
    const apiKey = getGeminiApiKey();
    const model = getGeminiModel();

    if (!normalizedText && !normalizedSummary) {
        throw createHttpError('Text or summary is required.', 400);
    }

    if (normalizedText.length > MAX_TEXT_LENGTH) {
        throw createHttpError(`Text must be ${MAX_TEXT_LENGTH} characters or fewer.`, 400);
    }

    if (!apiKey) {
        throw createHttpError('GEMINI_API_KEY is not configured.', 500);
    }

    const response = await fetchImpl(`${GEMINI_API_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
            system_instruction: {
                parts: [
                    { text: SYSTEM_PROMPT }
                ]
            },
            contents: [
                {
                    parts: [
                        { text: createPrompt(normalizedText, normalizedSummary) }
                    ]
                }
            ]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini insight request failed.', response.status, errorText);
        throw createHttpError('Gemini insight request failed.', 502);
    }

    const payload = await response.json();
    const responseText = getGeminiTextFromResponse(payload);
    const insights = normalizeInsights(responseText);

    if (!insights.length) {
        throw createHttpError('Gemini returned empty insights.', 502);
    }

    return insights;
}
