const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const SYSTEM_PROMPT = 'Given the following content and existing tags, suggest 3-5 relevant tags. Return ONLY a JSON array of lowercase tag strings, no explanation. Prefer single-word tags.';

function createHttpError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function getOpenAiApiKey() {
    return process.env.OPENAI_API_KEY || '';
}

function getOpenAiModel() {
    return process.env.OPENAI_TAG_SUGGEST_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
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

function extractMessageText(payload) {
    const content = payload?.choices?.[0]?.message?.content;

    if (typeof content === 'string') {
        return content.trim();
    }

    if (!Array.isArray(content)) {
        return '';
    }

    return content
        .map((part) => {
            if (typeof part === 'string') {
                return part;
            }

            if (typeof part?.text === 'string') {
                return part.text;
            }

            return '';
        })
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

    const apiKey = getOpenAiApiKey();

    if (!apiKey) {
        throw createHttpError('OPENAI_API_KEY is not configured.', 500);
    }

    const response = await fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: getOpenAiModel(),
            temperature: 0.2,
            messages: [
                {
                    role: 'system',
                    content: SYSTEM_PROMPT
                },
                {
                    role: 'user',
                    content: formatUserPrompt(normalizedContent, existingTags)
                }
            ]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI tag suggestion request failed.', response.status, errorText);
        throw createHttpError('OpenAI tag suggestion request failed.', 502);
    }

    const payload = await response.json();
    const responseText = extractMessageText(payload);
    const parsedTags = parseJsonArray(responseText);
    const normalizedTags = normalizeSuggestedTags(parsedTags);

    if (!normalizedTags) {
        throw createHttpError('OpenAI returned invalid tags.', 502);
    }

    return normalizedTags;
}
