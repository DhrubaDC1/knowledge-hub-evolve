const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const SYSTEM_PROMPT = 'Given the following content and existing tags, suggest 3-5 relevant tags. Return ONLY a JSON array of lowercase tag strings, no explanation. Prefer single-word tags.';

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

function normalizeExistingTags(existingTags) {
    if (!Array.isArray(existingTags)) {
        return [];
    }

    return existingTags
        .map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
        .filter(Boolean);
}

function formatUserPrompt(content, existingTags) {
    const normalizedTags = normalizeExistingTags(existingTags);
    const serializedTags = normalizedTags.length ? normalizedTags.join(', ') : 'none';

    return [
        `Content:\n${content}`,
        `Existing tags:\n${serializedTags}`
    ].join('\n\n');
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

function parseJsonArray(text) {
    if (typeof text !== 'string') {
        return null;
    }

    const trimmedText = text.trim();

    if (!trimmedText) {
        return null;
    }

    try {
        return JSON.parse(trimmedText);
    } catch (error) {
        const fencedMatch = trimmedText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

        if (fencedMatch) {
            try {
                return JSON.parse(fencedMatch[1]);
            } catch (nestedError) {
                return null;
            }
        }

        const startIndex = trimmedText.indexOf('[');
        const endIndex = trimmedText.lastIndexOf(']');

        if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
            return null;
        }

        try {
            return JSON.parse(trimmedText.slice(startIndex, endIndex + 1));
        } catch (nestedError) {
            return null;
        }
    }
}

function normalizeSuggestedTags(value) {
    if (!Array.isArray(value)) {
        return null;
    }

    const uniqueTags = [];
    const seenTags = new Set();

    for (const entry of value) {
        if (typeof entry !== 'string') {
            return null;
        }

        const normalizedTag = entry.trim().toLowerCase();

        if (!normalizedTag || seenTags.has(normalizedTag)) {
            continue;
        }

        seenTags.add(normalizedTag);
        uniqueTags.push(normalizedTag);
    }

    if (uniqueTags.length < 3 || uniqueTags.length > 5) {
        return null;
    }

    return uniqueTags;
}

export async function suggestTags(content, existingTags = [], fetchImpl = fetch) {
    const normalizedContent = typeof content === 'string' ? content.trim() : '';

    if (!normalizedContent) {
        throw createHttpError('Content is required.', 400);
    }

    if (!Array.isArray(existingTags)) {
        throw createHttpError('Existing tags must be an array.', 400);
    }

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
            systemInstruction: {
                parts: [
                    { text: SYSTEM_PROMPT }
                ]
            },
            generationConfig: {
                temperature: 0.2,
                responseMimeType: 'application/json'
            },
            contents: [
                {
                    parts: [
                        { text: formatUserPrompt(normalizedContent, existingTags) }
                    ]
                }
            ]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini tag suggestion request failed.', response.status, errorText);
        throw createHttpError('Gemini tag suggestion request failed.', 502);
    }

    const payload = await response.json();
    const responseText = getGeminiTextFromResponse(payload);
    const parsedTags = parseJsonArray(responseText);
    const normalizedTags = normalizeSuggestedTags(parsedTags);

    if (!normalizedTags) {
        throw createHttpError('Gemini returned invalid tags.', 502);
    }

    return normalizedTags;
}
