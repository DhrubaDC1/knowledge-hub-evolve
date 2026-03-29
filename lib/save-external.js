function createHttpError(statusCode, message) {
    const error = new Error(message);

    error.statusCode = statusCode;

    return error;
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function createExternalId() {
    return `external-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function createExternalNote(payload = {}) {
    const rawUrl = normalizeString(payload.url);

    if (!rawUrl) {
        throw createHttpError(400, 'URL is required.');
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(rawUrl);
    } catch (error) {
        throw createHttpError(400, 'URL must be a valid absolute URL.');
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw createHttpError(400, 'URL must use http or https.');
    }

    const normalizedUrl = parsedUrl.toString();
    const title = normalizeString(payload.title) || parsedUrl.hostname.replace(/^www\./, '');
    const annotation = normalizeString(payload.annotation);
    const timestamp = new Date().toISOString();

    return {
        id: createExternalId(),
        type: 'link',
        title,
        content: annotation,
        url: normalizedUrl,
        favicon: '',
        summary: '',
        insights: [],
        tags: [],
        autoTags: [],
        createdAt: timestamp,
        updatedAt: timestamp
    };
}
