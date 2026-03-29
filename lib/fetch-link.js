const REQUEST_TIMEOUT_MS = 5_000;
const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];

function createHttpError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function normalizeUrl(rawUrl) {
    const value = typeof rawUrl === 'string' ? rawUrl.trim() : '';

    if (!value) {
        throw createHttpError('URL is required.', 400);
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(value);
    } catch (error) {
        throw createHttpError('URL must be a valid absolute HTTP or HTTPS URL.', 400);
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw createHttpError('URL must use HTTP or HTTPS.', 400);
    }

    return parsedUrl.toString();
}

function decodeHtmlEntities(value) {
    if (!value || typeof value !== 'string') {
        return '';
    }

    const namedEntities = {
        amp: '&',
        apos: '\'',
        gt: '>',
        lt: '<',
        nbsp: ' ',
        quot: '"'
    };

    return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
        const normalizedEntity = entity.toLowerCase();

        if (normalizedEntity.startsWith('#x')) {
            const codePoint = Number.parseInt(normalizedEntity.slice(2), 16);
            return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
        }

        if (normalizedEntity.startsWith('#')) {
            const codePoint = Number.parseInt(normalizedEntity.slice(1), 10);
            return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
        }

        return namedEntities[normalizedEntity] || match;
    });
}

function sanitizeText(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return decodeHtmlEntities(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/[\u0000-\u001F\u007F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getTagAttributes(tag) {
    const attributes = {};
    const attributeSource = tag
        .replace(/^<\s*\/?\s*[^\s>]+\s*/i, '')
        .replace(/\s*\/?>\s*$/i, '');
    const attributePattern = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

    let match = attributePattern.exec(attributeSource);

    while (match) {
        const attributeName = match[1].toLowerCase();
        const attributeValue = match[2] ?? match[3] ?? match[4] ?? '';

        attributes[attributeName] = attributeValue;
        match = attributePattern.exec(attributeSource);
    }

    return attributes;
}

function getMetaContent(html, key) {
    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
    const normalizedKey = key.toLowerCase();

    for (const tag of metaTags) {
        const attributes = getTagAttributes(tag);
        const property = attributes.property?.toLowerCase();
        const name = attributes.name?.toLowerCase();

        if (property === normalizedKey || name === normalizedKey) {
            return sanitizeText(attributes.content || '');
        }
    }

    return '';
}

function getTitleContent(html) {
    const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return sanitizeText(titleMatch?.[1] || '');
}

function getIconHref(html, baseUrl) {
    const openGraphImage = getMetaContent(html, 'og:image');

    if (openGraphImage) {
        return resolveUrl(openGraphImage, baseUrl);
    }

    const linkTags = html.match(/<link\b[^>]*>/gi) || [];

    for (const tag of linkTags) {
        const attributes = getTagAttributes(tag);
        const rel = attributes.rel?.toLowerCase() || '';
        const relTokens = rel.split(/\s+/).filter(Boolean);

        if (relTokens.includes('icon')) {
            return resolveUrl(attributes.href || '', baseUrl);
        }
    }

    return '';
}

function resolveUrl(candidate, baseUrl) {
    const value = typeof candidate === 'string' ? candidate.trim() : '';

    if (!value) {
        return '';
    }

    try {
        const resolvedUrl = new URL(value, baseUrl);

        if (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:') {
            return '';
        }

        return resolvedUrl.toString();
    } catch (error) {
        return '';
    }
}

function isHtmlResponse(contentTypeHeader) {
    const contentType = contentTypeHeader.toLowerCase();
    return HTML_CONTENT_TYPES.some((type) => contentType.includes(type));
}

export async function fetchLinkMetadata(rawUrl, fetchImpl = fetch) {
    const normalizedUrl = normalizeUrl(rawUrl);
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetchImpl(normalizedUrl, {
            method: 'GET',
            headers: {
                Accept: 'text/html,application/xhtml+xml'
            },
            redirect: 'follow',
            signal: abortController.signal
        });

        if (!response.ok) {
            throw createHttpError(`Failed to fetch URL. Upstream responded with ${response.status}.`, 502);
        }

        const contentType = response.headers.get('content-type') || '';

        if (!isHtmlResponse(contentType)) {
            throw createHttpError('URL did not return an HTML document.', 415);
        }

        const html = await response.text();
        const title = getMetaContent(html, 'og:title') || getTitleContent(html);
        const description = getMetaContent(html, 'og:description') || getMetaContent(html, 'description');
        const favicon = getIconHref(html, normalizedUrl);

        return {
            title,
            description,
            favicon,
            url: normalizedUrl
        };
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw createHttpError('Request timed out while fetching the URL.', 504);
        }

        if (error?.statusCode) {
            throw error;
        }

        console.error('Failed to fetch link metadata.', error);
        throw createHttpError('Failed to fetch URL metadata.', 502);
    } finally {
        clearTimeout(timeoutId);
    }
}
