export const MAX_TEXT_LENGTH = 10_000;

const SYSTEM_PROMPT = 'You are a knowledge assistant. Summarize the following into 2-3 concise sentences that capture the key insight. Be specific, not vague.';
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

function getGeminiSummaryFromResponse(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;

    if (!Array.isArray(parts)) {
        return '';
    }

    return parts
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('')
        .trim();
}

export async function summarizeText(text, fetchImpl = fetch) {
    const apiKey = getGeminiApiKey();
    const model = getGeminiModel();

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
                        { text }
                    ]
                }
            ]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini request failed.', response.status, errorText);
        throw createHttpError('Gemini request failed.', 502);
    }

    const payload = await response.json();
    const summary = getGeminiSummaryFromResponse(payload);

    if (!summary) {
        throw createHttpError('Gemini returned an empty summary.', 502);
    }

    return summary;
}
