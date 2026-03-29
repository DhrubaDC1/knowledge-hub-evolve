const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_RESULTS = 10;
const noteEmbeddingCache = new Map();

function createHttpError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function getOpenAiApiKey() {
    return process.env.OPENAI_API_KEY || '';
}

function normalizeTag(tag) {
    return typeof tag === 'string' ? tag.trim() : '';
}

function buildNoteSearchText(note = {}) {
    const title = typeof note.title === 'string' ? note.title.trim() : '';
    const content = typeof note.content === 'string' ? note.content.trim() : '';
    const tags = Array.isArray(note.tags)
        ? note.tags.map(normalizeTag).filter(Boolean).join(' ')
        : '';

    const searchText = [title, content, tags].filter(Boolean).join('\n\n').trim();
    return searchText || 'Empty note';
}

function createNoteFingerprint(note, searchText) {
    const updatedAt = typeof note?.updatedAt === 'string' ? note.updatedAt.trim() : '';
    return `${updatedAt}::${searchText}`;
}

async function createEmbeddings(inputs, fetchImpl = fetch) {
    const apiKey = getOpenAiApiKey();

    if (!apiKey) {
        throw createHttpError('OPENAI_API_KEY is not configured.', 500);
    }

    const response = await fetchImpl(OPENAI_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: EMBEDDING_MODEL,
            input: inputs
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI embeddings request failed.', response.status, errorText);
        throw createHttpError('OpenAI embeddings request failed.', 502);
    }

    const payload = await response.json();
    const embeddings = Array.isArray(payload?.data)
        ? payload.data
            .slice()
            .sort((left, right) => Number(left?.index || 0) - Number(right?.index || 0))
            .map((item) => item?.embedding)
        : [];

    if (embeddings.length !== inputs.length || embeddings.some((embedding) => !Array.isArray(embedding))) {
        throw createHttpError('OpenAI returned invalid embeddings.', 502);
    }

    return embeddings;
}

function cosineSimilarity(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) {
        return 0;
    }

    let dotProduct = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;

    for (let index = 0; index < left.length; index += 1) {
        const leftValue = Number(left[index]) || 0;
        const rightValue = Number(right[index]) || 0;

        dotProduct += leftValue * rightValue;
        leftMagnitude += leftValue * leftValue;
        rightMagnitude += rightValue * rightValue;
    }

    if (!leftMagnitude || !rightMagnitude) {
        return 0;
    }

    return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function pruneStaleCacheEntries(notes) {
    const activeNoteIds = new Set(
        notes
            .map((note) => (note?.id == null ? '' : String(note.id)))
            .filter(Boolean)
    );

    for (const noteId of noteEmbeddingCache.keys()) {
        if (!activeNoteIds.has(noteId)) {
            noteEmbeddingCache.delete(noteId);
        }
    }
}

export async function searchNotes(query, notes, fetchImpl = fetch) {
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';

    if (!normalizedQuery) {
        throw createHttpError('Query is required.', 400);
    }

    if (!Array.isArray(notes)) {
        throw createHttpError('Notes must be an array.', 400);
    }

    pruneStaleCacheEntries(notes);

    const [queryEmbedding] = await createEmbeddings([normalizedQuery], fetchImpl);
    const notesToEmbed = [];
    const noteEmbeddings = new Map();

    notes.forEach((note) => {
        if (!note || typeof note !== 'object') {
            return;
        }

        const noteId = note.id == null ? '' : String(note.id);

        if (!noteId) {
            return;
        }

        const searchText = buildNoteSearchText(note);
        const fingerprint = createNoteFingerprint(note, searchText);
        const cachedEntry = noteEmbeddingCache.get(noteId);

        if (cachedEntry && cachedEntry.fingerprint === fingerprint) {
            noteEmbeddings.set(noteId, cachedEntry.embedding);
            return;
        }

        notesToEmbed.push({ note, noteId, fingerprint, searchText });
    });

    if (notesToEmbed.length) {
        const newEmbeddings = await createEmbeddings(
            notesToEmbed.map((entry) => entry.searchText),
            fetchImpl
        );

        notesToEmbed.forEach((entry, index) => {
            const embedding = newEmbeddings[index];
            noteEmbeddings.set(entry.noteId, embedding);
            noteEmbeddingCache.set(entry.noteId, {
                fingerprint: entry.fingerprint,
                embedding
            });
        });
    }

    const results = notes
        .filter((note) => note && typeof note === 'object')
        .map((note) => {
            const noteId = note.id == null ? '' : String(note.id);
            const embedding = noteEmbeddings.get(noteId) || noteEmbeddingCache.get(noteId)?.embedding;

            return {
                note,
                score: cosineSimilarity(queryEmbedding, embedding)
            };
        })
        .sort((left, right) => right.score - left.score)
        .slice(0, MAX_RESULTS);

    return { results };
}
