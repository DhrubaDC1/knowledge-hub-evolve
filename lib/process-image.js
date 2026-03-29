export const MAX_IMAGE_FILE_SIZE_BYTES = 3 * 1024 * 1024;
export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp'
]);

const OPENAI_RESPONSES_API_URL = 'https://api.openai.com/v1/responses';
const OCR_PROMPT = [
    'Extract all readable text from this image.',
    'Return only the plain transcription.',
    'Preserve useful line breaks.',
    'If there is no readable text, respond exactly with NO_TEXT.'
].join(' ');

function createHttpError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function getOpenAiApiKey() {
    return process.env.OPENAI_API_KEY || '';
}

function getOpenAiVisionModel() {
    return process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini';
}

function normalizeMimeType(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeBase64Image(value) {
    return String(value || '')
        .replace(/^data:[^;]+;base64,/i, '')
        .replace(/\s+/g, '')
        .trim();
}

function estimateBase64Bytes(base64Value) {
    const normalizedValue = normalizeBase64Image(base64Value);
    const paddingLength = normalizedValue.endsWith('==')
        ? 2
        : normalizedValue.endsWith('=')
            ? 1
            : 0;

    return Math.floor((normalizedValue.length * 3) / 4) - paddingLength;
}

function getResponseText(payload) {
    if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
        return payload.output_text.trim();
    }

    const outputs = Array.isArray(payload?.output) ? payload.output : [];

    return outputs
        .flatMap((entry) => (Array.isArray(entry?.content) ? entry.content : []))
        .map((entry) => (typeof entry?.text === 'string' ? entry.text : ''))
        .join('\n')
        .trim();
}

function normalizeExtractedText(value) {
    const text = String(value || '').trim();

    if (!text || /^no[_\s-]?text[.!]?$/i.test(text)) {
        return '';
    }

    return text;
}

export async function extractTextFromImage({ imageBase64 = '', mimeType = '' } = {}, fetchImpl = fetch) {
    const normalizedMimeType = normalizeMimeType(mimeType);
    const normalizedBase64 = normalizeBase64Image(imageBase64);
    const apiKey = getOpenAiApiKey();
    const model = getOpenAiVisionModel();

    if (!normalizedBase64) {
        throw createHttpError('Image data is required.', 400);
    }

    if (!SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
        throw createHttpError('Use a PNG, JPG, or WebP image.', 400);
    }

    if (estimateBase64Bytes(normalizedBase64) > MAX_IMAGE_FILE_SIZE_BYTES) {
        throw createHttpError('Image must be 3 MB or smaller.', 400);
    }

    if (!apiKey) {
        throw createHttpError('OPENAI_API_KEY is not configured.', 500);
    }

    const response = await fetchImpl(OPENAI_RESPONSES_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            input: [
                {
                    role: 'user',
                    content: [
                        { type: 'input_text', text: OCR_PROMPT },
                        {
                            type: 'input_image',
                            image_url: `data:${normalizedMimeType};base64,${normalizedBase64}`
                        }
                    ]
                }
            ]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI vision request failed.', response.status, errorText);
        throw createHttpError('OpenAI vision request failed.', 502);
    }

    const payload = await response.json();

    return normalizeExtractedText(getResponseText(payload));
}
