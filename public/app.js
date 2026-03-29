const STORAGE_KEY = 'kh-notes';
const THEME_STORAGE_KEY = 'kh-theme';
const THEME_COLORS = {
    light: '#f3f7fb',
    dark: '#071018'
};
const SEARCH_DEBOUNCE_MS = 300;
const TAG_SUGGESTIONS_DEBOUNCE_MS = 1000;
const TAG_SUGGESTIONS_MIN_CONTENT_LENGTH = 20;
const app = document.querySelector('#app');
const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

const state = {
    notes: [],
    query: '',
    activeTagFilter: '',
    captureTags: [],
    captureSuggestedTags: [],
    feedback: '',
    captureAutoSummarize: false,
    isSavingNote: false,
    saveButtonLabel: 'Save',
    noteUi: {},
    isSearching: false,
    searchResults: [],
    searchResultScores: {},
    searchSource: '',
    searchStatusMessage: '',
    resolvedSearchQuery: '',
    searchRequestToken: 0,
    searchDebounceTimer: null,
    tagSuggestionsRequestToken: 0,
    tagSuggestionsDebounceTimer: null,
    themePreference: readThemePreference(),
    activeTheme: 'light'
};

class KnowledgeHubStorage {
    createId() {
        return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    }

    read() {
        try {
            const rawValue = localStorage.getItem(STORAGE_KEY);

            if (!rawValue) {
                return [];
            }

            const parsedValue = JSON.parse(rawValue);

            if (!Array.isArray(parsedValue)) {
                return [];
            }

            return parsedValue
                .map((note) => this.normalize(note))
                .filter(Boolean);
        } catch (error) {
            console.error('Failed to read notes from localStorage.', error);
            return [];
        }
    }

    write(notes) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
            return true;
        } catch (error) {
            console.error('Failed to save notes to localStorage.', error);
            return false;
        }
    }

    normalize(note = {}) {
        return createNoteModel(note, {
            id: note.id ? String(note.id) : this.createId(),
            createdAt: note.createdAt || new Date().toISOString(),
            updatedAt: note.updatedAt || note.createdAt || new Date().toISOString()
        });
    }

    save(note) {
        const timestamp = new Date().toISOString();
        const normalizedNote = this.normalize({
            ...note,
            id: this.createId(),
            createdAt: timestamp,
            updatedAt: timestamp
        });
        const notes = this.read();

        notes.unshift(normalizedNote);

        if (!this.write(notes)) {
            return null;
        }

        return normalizedNote;
    }

    getAll() {
        return this.sortByNewest(this.read());
    }

    getById(id) {
        return this.read().find((note) => note.id === String(id)) || null;
    }

    delete(id) {
        const noteId = String(id);
        const notes = this.read();
        const filteredNotes = notes.filter((note) => note.id !== noteId);

        if (filteredNotes.length === notes.length) {
            return false;
        }

        return this.write(filteredNotes);
    }

    update(id, data) {
        const noteId = String(id);
        const notes = this.read();
        let updatedNote = null;

        const nextNotes = notes.map((note) => {
            if (note.id !== noteId) {
                return note;
            }

            updatedNote = this.normalize({
                ...note,
                ...data,
                id: note.id,
                createdAt: note.createdAt,
                updatedAt: new Date().toISOString()
            });

            return updatedNote;
        });

        if (!updatedNote || !this.write(nextNotes)) {
            return null;
        }

        return updatedNote;
    }

    search(query) {
        const normalizedQuery = query.trim().toLowerCase();

        if (!normalizedQuery) {
            return this.getAll();
        }

        return this.getAll().filter((note) => {
            const haystack = [
                note.title,
                note.content,
                note.url,
                note.tags.join(' ')
            ]
                .join(' ')
                .toLowerCase();

            return haystack.includes(normalizedQuery);
        });
    }

    sortByNewest(notes) {
        return [...notes].sort((left, right) => {
            return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        });
    }
}

const Storage = new KnowledgeHubStorage();

function readThemePreference() {
    try {
        const storedValue = localStorage.getItem(THEME_STORAGE_KEY);

        if (storedValue === 'light' || storedValue === 'dark') {
            return storedValue;
        }
    } catch (error) {
        console.error('Failed to read theme preference.', error);
    }

    return 'system';
}

function getActiveTheme() {
    return state.themePreference === 'system'
        ? (themeMediaQuery.matches ? 'dark' : 'light')
        : state.themePreference;
}

function updateThemeMetaColor(theme) {
    const themeColorElement = document.querySelector('#theme-color');

    if (themeColorElement) {
        themeColorElement.setAttribute('content', THEME_COLORS[theme]);
    }
}

function updateThemeToggle() {
    const themeToggle = document.querySelector('#theme-toggle');
    const themeToggleValue = document.querySelector('#theme-toggle-value');

    if (!themeToggle || !themeToggleValue) {
        return;
    }

    const activeTheme = getActiveTheme();
    const nextTheme = activeTheme === 'dark' ? 'light' : 'dark';
    const themeLabel = activeTheme === 'dark' ? 'Dark mode' : 'Light mode';

    themeToggleValue.textContent = themeLabel;
    themeToggle.setAttribute('aria-label', `Switch to ${nextTheme} mode`);
    themeToggle.setAttribute('aria-pressed', String(activeTheme === 'dark'));
    themeToggle.title = `Switch to ${nextTheme} mode`;
}

function applyThemePreference() {
    const activeTheme = getActiveTheme();

    state.activeTheme = activeTheme;

    if (state.themePreference === 'system') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', state.themePreference);
    }

    updateThemeMetaColor(activeTheme);
    updateThemeToggle();
}

function toggleThemePreference() {
    const nextTheme = getActiveTheme() === 'dark' ? 'light' : 'dark';

    state.themePreference = nextTheme;

    try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (error) {
        console.error('Failed to save theme preference.', error);
    }

    applyThemePreference();
}

function createNoteModel(note = {}, overrides = {}) {
    if (!note || typeof note !== 'object') {
        return null;
    }

    const content = typeof note.content === 'string' ? note.content.trim() : '';
    const url = typeof note.url === 'string' ? note.url.trim() : '';
    const favicon = typeof note.favicon === 'string' ? note.favicon.trim() : '';
    const type = note.type === 'link' || url ? 'link' : 'note';
    const title = typeof note.title === 'string' && note.title.trim()
        ? note.title.trim()
        : deriveTitle({ content, url, type });
    const tags = normalizeTags(note.tags);
    const summary = typeof note.summary === 'string' ? note.summary.trim() : '';

    return {
        id: '',
        type,
        content,
        url,
        favicon,
        title,
        summary,
        tags,
        createdAt: '',
        updatedAt: '',
        ...overrides
    };
}

function deriveTitle({ content, url, type }) {
    if (content) {
        return truncateText(content.split('\n').find(Boolean) || content, 80);
    }

    if (type === 'link' && url) {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch (error) {
            return truncateText(url, 80);
        }
    }

    return 'Untitled note';
}

function truncateText(value, maxLength) {
    const text = String(value || '').trim();

    if (!text || text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, maxLength).trimEnd()}...`;
}

function formatRelativeTime(dateValue) {
    const timestamp = new Date(dateValue).getTime();

    if (Number.isNaN(timestamp)) {
        return 'Just now';
    }

    const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000);
    const divisions = [
        { amount: 60, unit: 'second' },
        { amount: 60, unit: 'minute' },
        { amount: 24, unit: 'hour' },
        { amount: 7, unit: 'day' },
        { amount: 4.34524, unit: 'week' },
        { amount: 12, unit: 'month' },
        { amount: Number.POSITIVE_INFINITY, unit: 'year' }
    ];

    let duration = elapsedSeconds;

    for (const division of divisions) {
        if (Math.abs(duration) < division.amount) {
            return relativeTimeFormatter.format(Math.round(duration), division.unit);
        }

        duration /= division.amount;
    }

    return 'Just now';
}

function formatCountLabel(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

function normalizeTag(tag) {
    return String(tag || '').trim().toLowerCase();
}

function normalizeTags(value) {
    const sourceValues = Array.isArray(value)
        ? value
        : String(value || '').split(',');
    const uniqueTags = new Set();

    sourceValues.forEach((tag) => {
        const normalizedTag = normalizeTag(tag);

        if (normalizedTag) {
            uniqueTags.add(normalizedTag);
        }
    });

    return [...uniqueTags];
}

function serializeTags(tags) {
    return normalizeTags(tags).join(', ');
}

function getUniqueTags(notes) {
    const uniqueTags = new Set();

    notes.forEach((note) => {
        note.tags.forEach((tag) => uniqueTags.add(tag));
    });

    return [...uniqueTags].sort((left, right) => left.localeCompare(right));
}

function getTagHue(tag) {
    return Array.from(String(tag || '')).reduce((hash, character) => {
        return (hash * 31 + character.charCodeAt(0)) % 360;
    }, 0);
}

function setTagTone(tag, element) {
    element.style.setProperty('--tag-hue', String(getTagHue(tag)));
}

function collectKnowledgeMetrics(notes) {
    const uniqueTags = new Set();
    let linkCount = 0;
    let summaryCount = 0;

    notes.forEach((note) => {
        if (note.type === 'link') {
            linkCount += 1;
        }

        if (note.summary) {
            summaryCount += 1;
        }

        note.tags.forEach((tag) => uniqueTags.add(tag.toLowerCase()));
    });

    return {
        totalCount: notes.length,
        linkCount,
        summaryCount,
        tagCount: uniqueTags.size
    };
}

function parseTags(value) {
    return normalizeTags(value);
}

function prependDescriptionToContent(description, content) {
    const trimmedDescription = typeof description === 'string' ? description.trim() : '';
    const trimmedContent = typeof content === 'string' ? content.trim() : '';

    if (!trimmedDescription) {
        return trimmedContent;
    }

    if (!trimmedContent) {
        return trimmedDescription;
    }

    if (trimmedContent.startsWith(trimmedDescription)) {
        return trimmedContent;
    }

    return `${trimmedDescription}\n\n${trimmedContent}`;
}

function mergeLinkMetadata(note, metadata) {
    const nextUrl = typeof metadata?.url === 'string' && metadata.url.trim()
        ? metadata.url.trim()
        : note.url;
    const nextTitle = typeof metadata?.title === 'string' && metadata.title.trim()
        ? metadata.title.trim()
        : note.title;
    const nextFavicon = typeof metadata?.favicon === 'string' ? metadata.favicon.trim() : '';

    return createNoteModel({
        ...note,
        type: 'link',
        url: nextUrl,
        title: nextTitle,
        favicon: nextFavicon,
        content: prependDescriptionToContent(metadata?.description, note.content)
    });
}

function createNoteFromInputs({ content, url, tags }) {
    const trimmedContent = content.trim();
    const trimmedUrl = url.trim();
    const parsedTags = parseTags(tags);

    if (!trimmedContent && !trimmedUrl) {
        return null;
    }

    const type = trimmedUrl ? 'link' : 'note';

    return createNoteModel({
        type,
        content: trimmedContent,
        url: trimmedUrl,
        title: deriveTitle({ content: trimmedContent, url: trimmedUrl, type }),
        tags: parsedTags
    });
}

function buildNoteSearchText(note = {}) {
    return [
        note.title,
        note.content,
        note.url,
        Array.isArray(note.tags) ? note.tags.join(' ') : ''
    ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join('\n');
}

function calculateLocalSearchScore(note, normalizedQuery, queryTerms) {
    const title = String(note.title || '').trim().toLowerCase();
    const content = String(note.content || '').trim().toLowerCase();
    const url = String(note.url || '').trim().toLowerCase();
    const tags = Array.isArray(note.tags)
        ? note.tags.map((tag) => String(tag).trim().toLowerCase()).join(' ')
        : '';
    let score = 0;

    if (title.includes(normalizedQuery)) {
        score += 0.45;
    }

    if (content.includes(normalizedQuery)) {
        score += 0.28;
    }

    if (tags.includes(normalizedQuery)) {
        score += 0.2;
    }

    if (url.includes(normalizedQuery)) {
        score += 0.12;
    }

    let matchedTerms = 0;

    queryTerms.forEach((term) => {
        let termMatched = false;

        if (title.includes(term)) {
            score += 0.18;
            termMatched = true;
        }

        if (content.includes(term)) {
            score += 0.08;
            termMatched = true;
        }

        if (tags.includes(term)) {
            score += 0.08;
            termMatched = true;
        }

        if (url.includes(term)) {
            score += 0.04;
            termMatched = true;
        }

        if (termMatched) {
            matchedTerms += 1;
        }
    });

    if (queryTerms.length > 1 && matchedTerms === queryTerms.length) {
        score += 0.12;
    }

    return Math.max(0, Math.min(score, 0.99));
}

function createLocalSearchResults(query, notes) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);

    if (!normalizedQuery) {
        return [];
    }

    return notes
        .filter((note) => note && typeof note === 'object')
        .map((note) => ({
            note,
            score: calculateLocalSearchScore(note, normalizedQuery, queryTerms),
            searchText: buildNoteSearchText(note)
        }))
        .filter((entry) => entry.score > 0 || entry.searchText.includes(normalizedQuery))
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }

            return new Date(right.note.createdAt).getTime() - new Date(left.note.createdAt).getTime();
        })
        .map(({ note, score }) => ({ note, score }));
}

function normalizeSearchScore(score, source = 'api') {
    const numericScore = Number(score);

    if (!Number.isFinite(numericScore)) {
        return null;
    }

    const normalizedScore = source === 'api'
        ? (numericScore + 1) / 2
        : numericScore;

    return Math.max(0, Math.min(normalizedScore, 1));
}

function formatSearchScore(score) {
    const normalizedScore = normalizeSearchScore(score, 'local');

    if (normalizedScore == null) {
        return '';
    }

    return `${Math.round(normalizedScore * 100)}% match`;
}

function clearScheduledSearch() {
    if (state.searchDebounceTimer) {
        window.clearTimeout(state.searchDebounceTimer);
        state.searchDebounceTimer = null;
    }
}

function clearScheduledTagSuggestions() {
    if (state.tagSuggestionsDebounceTimer) {
        window.clearTimeout(state.tagSuggestionsDebounceTimer);
        state.tagSuggestionsDebounceTimer = null;
    }
}

function hasMeaningfulContentForTagSuggestions(content) {
    return String(content || '').trim().length > TAG_SUGGESTIONS_MIN_CONTENT_LENGTH;
}

async function requestTagSuggestions(content, existingTags) {
    const response = await fetch('/api/suggest-tags', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content, existingTags })
    });

    let payload = null;

    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Tag suggestion API not found. Run the app with `npm run dev` so Vercel serves `/api/suggest-tags`.');
        }

        throw new Error(payload?.error || 'Could not suggest tags right now.');
    }

    return Array.isArray(payload?.tags) ? normalizeTags(payload.tags) : [];
}

function resetSearchState() {
    clearScheduledSearch();
    state.isSearching = false;
    state.searchResults = [];
    state.searchResultScores = {};
    state.searchSource = '';
    state.searchStatusMessage = '';
    state.resolvedSearchQuery = '';
}

async function requestSearchResults(query, notes) {
    const response = await fetch('/api/search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query, notes })
    });

    let payload = null;

    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Search API not found. Run the app with `npm run dev` so Vercel serves `/api/search`.');
        }

        throw new Error(payload?.error || 'Could not search notes right now.');
    }

    return Array.isArray(payload?.results)
        ? payload.results
            .map((entry) => {
                const note = createNoteModel(entry?.note, {
                    id: entry?.note?.id ? String(entry.note.id) : '',
                    createdAt: entry?.note?.createdAt || new Date().toISOString(),
                    updatedAt: entry?.note?.updatedAt || entry?.note?.createdAt || new Date().toISOString()
                });

                if (!note) {
                    return null;
                }

                return {
                    note,
                    score: normalizeSearchScore(entry?.score, 'api')
                };
            })
            .filter(Boolean)
        : [];
}

function applySearchResults(query, results, source, statusMessage = '') {
    const trimmedQuery = String(query || '').trim();

    if (!trimmedQuery || trimmedQuery !== state.query.trim()) {
        return;
    }

    const normalizedResults = Array.isArray(results)
        ? results
            .map((entry) => {
                const note = createNoteModel(entry?.note, {
                    id: entry?.note?.id ? String(entry.note.id) : '',
                    createdAt: entry?.note?.createdAt || new Date().toISOString(),
                    updatedAt: entry?.note?.updatedAt || entry?.note?.createdAt || new Date().toISOString()
                });

                if (!note) {
                    return null;
                }

                return {
                    note,
                    score: normalizeSearchScore(entry?.score, source)
                };
            })
            .filter(Boolean)
        : [];

    state.isSearching = false;
    state.searchResults = normalizedResults;
    state.searchResultScores = Object.fromEntries(
        normalizedResults
            .filter(({ note, score }) => note?.id && score != null)
            .map(({ note, score }) => [note.id, score])
    );
    state.searchSource = source;
    state.searchStatusMessage = statusMessage;
    state.resolvedSearchQuery = trimmedQuery;
    renderNotesList();
}

async function performSearch(query, requestToken) {
    const trimmedQuery = String(query || '').trim();

    if (!trimmedQuery || requestToken !== state.searchRequestToken) {
        return;
    }

    const notes = Storage.getAll();

    try {
        const results = await requestSearchResults(trimmedQuery, notes);

        if (requestToken !== state.searchRequestToken) {
            return;
        }

        applySearchResults(trimmedQuery, results, 'api');
    } catch (error) {
        if (requestToken !== state.searchRequestToken) {
            return;
        }

        console.error('Failed to search notes via API.', error);
        applySearchResults(
            trimmedQuery,
            createLocalSearchResults(trimmedQuery, notes),
            'local',
            'API unavailable. Showing local matches.'
        );
    }
}

function scheduleSearch(query, options = {}) {
    const trimmedQuery = String(query || '').trim();

    state.searchRequestToken += 1;
    clearScheduledSearch();

    if (!trimmedQuery) {
        resetSearchState();
        renderNotesList();
        return;
    }

    state.isSearching = true;
    state.searchStatusMessage = '';
    renderNotesList();

    const delay = options.immediate ? 0 : SEARCH_DEBOUNCE_MS;
    const requestToken = state.searchRequestToken;

    state.searchDebounceTimer = window.setTimeout(() => {
        state.searchDebounceTimer = null;
        void performSearch(trimmedQuery, requestToken);
    }, delay);
}

function filterNotesByActiveTag(notes) {
    if (!state.activeTagFilter) {
        return notes;
    }

    return notes.filter((note) => note.tags.includes(state.activeTagFilter));
}

function getDisplayedNotes(allNotes) {
    const trimmedQuery = state.query.trim();
    const filteredNotes = filterNotesByActiveTag(allNotes);

    if (!trimmedQuery) {
        return filteredNotes;
    }

    const allNotesById = new Map(filteredNotes.map((note) => [note.id, note]));

    if (state.resolvedSearchQuery === trimmedQuery) {
        return state.searchResults
            .map(({ note }) => allNotesById.get(note.id))
            .filter(Boolean);
    }

    const retainedNotes = state.notes
        .map((note) => allNotesById.get(note.id))
        .filter(Boolean);

    return retainedNotes.length ? retainedNotes : filteredNotes;
}

function getNoteUiState(noteId) {
    return state.noteUi[noteId] || {
        isSummarizing: false,
        error: ''
    };
}

function setNoteUiState(noteId, nextState) {
    state.noteUi[noteId] = {
        ...getNoteUiState(noteId),
        ...nextState
    };
}

function clearNoteUiState(noteId) {
    delete state.noteUi[noteId];
}

async function requestSummary(text) {
    const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text })
    });

    let payload = null;

    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Summary API not found. Run the app with `npm run dev` so Vercel serves `/api/summarize`.');
        }

        throw new Error(payload?.error || 'Could not summarize this note right now.');
    }

    const summary = typeof payload?.summary === 'string' ? payload.summary.trim() : '';

    if (!summary) {
        throw new Error('Could not summarize this note right now.');
    }

    return summary;
}

async function requestLinkMetadata(url) {
    const response = await fetch('/api/fetch-link', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url })
    });

    let payload = null;

    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Link metadata API not found. Run the app with `npm run dev` so Vercel serves `/api/fetch-link`.');
        }

        throw new Error(payload?.error || 'Could not fetch link info right now.');
    }

    return {
        title: typeof payload?.title === 'string' ? payload.title.trim() : '',
        description: typeof payload?.description === 'string' ? payload.description.trim() : '',
        favicon: typeof payload?.favicon === 'string' ? payload.favicon.trim() : '',
        url: typeof payload?.url === 'string' ? payload.url.trim() : url.trim()
    };
}

function setFeedback(message) {
    state.feedback = message;
    const feedbackElement = document.querySelector('#capture-feedback');

    if (feedbackElement) {
        feedbackElement.textContent = message;
    }
}

function createTagPill(tag) {
    const pill = document.createElement('span');
    pill.className = 'note-tag';
    pill.textContent = tag;
    setTagTone(tag, pill);
    return pill;
}

function createCaptureTagPill(tag) {
    const pill = document.createElement('span');
    const label = document.createElement('span');
    const removeButton = document.createElement('button');

    pill.className = 'capture-tag';
    setTagTone(tag, pill);

    label.className = 'capture-tag-label';
    label.textContent = tag;

    removeButton.className = 'capture-tag-remove';
    removeButton.type = 'button';
    removeButton.dataset.tag = tag;
    removeButton.setAttribute('aria-label', `Remove tag ${tag}`);
    removeButton.textContent = '×';

    pill.append(label, removeButton);

    return pill;
}

function createTagFilterPill(tag) {
    const pill = document.createElement('button');

    pill.className = 'tag-filter-pill';
    pill.type = 'button';
    pill.dataset.tag = tag;
    pill.textContent = tag;
    pill.setAttribute('aria-pressed', String(state.activeTagFilter === tag));
    setTagTone(tag, pill);

    if (state.activeTagFilter === tag) {
        pill.classList.add('is-active');
    }

    return pill;
}

function createSuggestedTagPill(tag) {
    const pill = document.createElement('button');

    pill.className = 'suggested-tag-pill';
    pill.type = 'button';
    pill.dataset.tag = tag;
    pill.textContent = tag;
    pill.setAttribute('aria-label', `Add suggested tag ${tag}`);
    setTagTone(tag, pill);

    return pill;
}

function renderCaptureTagsInput({ tagsInput, tagsTextInput, tagsList }) {
    const fragment = document.createDocumentFragment();

    state.captureTags.forEach((tag) => {
        fragment.append(createCaptureTagPill(tag));
    });

    tagsList.replaceChildren(fragment);
    tagsInput.value = serializeTags(state.captureTags);
    tagsTextInput.closest('.tag-input')?.classList.toggle('has-tags', state.captureTags.length > 0);
}

function renderCaptureTagSuggestions({ suggestionsWrap, suggestionsList }) {
    if (!suggestionsWrap || !suggestionsList) {
        return;
    }

    const availableSuggestions = state.captureSuggestedTags.filter((tag) => !state.captureTags.includes(tag));

    if (!availableSuggestions.length) {
        suggestionsWrap.hidden = true;
        suggestionsList.replaceChildren();
        return;
    }

    const fragment = document.createDocumentFragment();

    availableSuggestions.forEach((tag) => {
        fragment.append(createSuggestedTagPill(tag));
    });

    suggestionsWrap.hidden = false;
    suggestionsList.replaceChildren(fragment);
}

function resetCaptureTagSuggestions(controls) {
    state.tagSuggestionsRequestToken += 1;
    clearScheduledTagSuggestions();
    state.captureSuggestedTags = [];
    renderCaptureTagSuggestions(controls);
}

async function performTagSuggestions(content, requestToken, controls) {
    const trimmedContent = String(content || '').trim();

    if (!hasMeaningfulContentForTagSuggestions(trimmedContent) || requestToken !== state.tagSuggestionsRequestToken) {
        return;
    }

    try {
        const suggestedTags = await requestTagSuggestions(trimmedContent, state.captureTags);

        if (requestToken !== state.tagSuggestionsRequestToken) {
            return;
        }

        state.captureSuggestedTags = suggestedTags.filter((tag) => !state.captureTags.includes(tag));
        renderCaptureTagSuggestions(controls);
    } catch (error) {
        if (requestToken !== state.tagSuggestionsRequestToken) {
            return;
        }

        console.error('Failed to suggest capture tags.', error);
        state.captureSuggestedTags = [];
        renderCaptureTagSuggestions(controls);
    }
}

function scheduleTagSuggestions(content, controls) {
    const trimmedContent = String(content || '').trim();

    state.tagSuggestionsRequestToken += 1;
    clearScheduledTagSuggestions();

    if (!hasMeaningfulContentForTagSuggestions(trimmedContent)) {
        state.captureSuggestedTags = [];
        renderCaptureTagSuggestions(controls);
        return;
    }

    const requestToken = state.tagSuggestionsRequestToken;

    state.tagSuggestionsDebounceTimer = window.setTimeout(() => {
        state.tagSuggestionsDebounceTimer = null;
        void performTagSuggestions(trimmedContent, requestToken, controls);
    }, TAG_SUGGESTIONS_DEBOUNCE_MS);
}

function addCaptureTags(tags, controls) {
    state.captureTags = normalizeTags([...state.captureTags, ...normalizeTags(tags)]);
    renderCaptureTagsInput(controls);
    renderCaptureTagSuggestions(controls);
}

function removeCaptureTag(tag, controls) {
    state.captureTags = state.captureTags.filter((entry) => entry !== tag);
    renderCaptureTagsInput(controls);
    renderCaptureTagSuggestions(controls);
}

function commitCaptureTagInput(controls, options = {}) {
    const rawValue = controls.tagsTextInput.value;
    const segments = String(rawValue || '').split(',');
    const pendingTags = options.keepLastFragment
        ? segments.slice(0, -1)
        : segments;

    if (pendingTags.length) {
        addCaptureTags(pendingTags, controls);
    } else {
        renderCaptureTagsInput(controls);
    }

    controls.tagsTextInput.value = options.keepLastFragment
        ? segments.at(-1)?.trimStart() || ''
        : '';
}

function renderTagFilters(notes) {
    const tagFilters = document.querySelector('#notes-tag-filters');

    if (!tagFilters) {
        return;
    }

    const uniqueTags = getUniqueTags(notes);

    if (state.activeTagFilter && !uniqueTags.includes(state.activeTagFilter)) {
        state.activeTagFilter = '';
    }

    if (!uniqueTags.length) {
        tagFilters.replaceChildren();
        tagFilters.hidden = true;
        return;
    }

    const fragment = document.createDocumentFragment();

    uniqueTags.forEach((tag) => {
        fragment.append(createTagFilterPill(tag));
    });

    tagFilters.hidden = false;
    tagFilters.replaceChildren(fragment);
}

function createEmptyState(query) {
    const emptyState = document.createElement('div');
    const title = document.createElement('p');
    const copy = document.createElement('p');
    const trimmedQuery = query.trim();
    const activeTagFilter = state.activeTagFilter;

    emptyState.className = 'empty-state';
    title.className = 'empty-state-title';
    copy.className = 'empty-state-copy';

    if (trimmedQuery || activeTagFilter) {
        title.textContent = 'No matching notes';
        if (trimmedQuery && activeTagFilter) {
            copy.textContent = `Try a different keyword or clear the "${activeTagFilter}" filter to return more notes.`;
        } else if (trimmedQuery) {
            copy.textContent = 'Try a different keyword or clear the search to return to your full library.';
        } else {
            copy.textContent = `There are no saved notes tagged "${activeTagFilter}" yet.`;
        }
    } else {
        title.textContent = 'Start building your hub';
        copy.textContent = 'Capture a thought, paste a link, or save an idea to create your first card.';
    }

    emptyState.append(title, copy);

    return emptyState;
}

function syncOverview(allNotes) {
    const metrics = collectKnowledgeMetrics(allNotes);
    const totalMetric = document.querySelector('#metric-total');
    const linkMetric = document.querySelector('#metric-links');
    const summaryMetric = document.querySelector('#metric-summaries');
    const tagMetric = document.querySelector('#metric-tags');
    const notesTitle = document.querySelector('#notes-panel-title');
    const summaryElement = document.querySelector('#notes-summary');
    const searchStatusElement = document.querySelector('#notes-search-status');
    const resultsPill = document.querySelector('#notes-results-pill');
    const trimmedQuery = state.query.trim();
    const activeTagFilter = state.activeTagFilter;
    const tagLabel = activeTagFilter ? ` tagged "${activeTagFilter}"` : '';

    if (totalMetric) {
        totalMetric.textContent = String(metrics.totalCount);
    }

    if (linkMetric) {
        linkMetric.textContent = String(metrics.linkCount);
    }

    if (summaryMetric) {
        summaryMetric.textContent = String(metrics.summaryCount);
    }

    if (tagMetric) {
        tagMetric.textContent = String(metrics.tagCount);
    }

    if (notesTitle) {
        notesTitle.textContent = trimmedQuery
            ? 'Search results'
            : (activeTagFilter ? 'Tagged notes' : 'Your saved knowledge');
    }

    if (resultsPill) {
        if (trimmedQuery && state.isSearching) {
            resultsPill.textContent = 'Searching...';
        } else if (trimmedQuery || activeTagFilter) {
            resultsPill.textContent = `${formatCountLabel(state.notes.length, 'result')}`;
        } else {
            resultsPill.textContent = `${formatCountLabel(metrics.summaryCount, 'AI summary', 'AI summaries')}`;
        }
    }

    if (summaryElement) {
        if (trimmedQuery && state.isSearching) {
            summaryElement.textContent = `Searching notes for "${trimmedQuery}"${tagLabel}...`;
        } else if (trimmedQuery && state.searchSource === 'local') {
            summaryElement.textContent = `Showing ${formatCountLabel(state.notes.length, 'local result')} for "${trimmedQuery}"${tagLabel}.`;
        } else if (trimmedQuery) {
            summaryElement.textContent = `Showing ${formatCountLabel(state.notes.length, 'result')} for "${trimmedQuery}"${tagLabel}.`;
        } else if (activeTagFilter) {
            summaryElement.textContent = `Showing ${formatCountLabel(state.notes.length, 'saved item')} tagged "${activeTagFilter}".`;
        } else {
            summaryElement.textContent = `${formatCountLabel(metrics.totalCount, 'saved item')} including ${formatCountLabel(metrics.linkCount, 'link')}, ${formatCountLabel(metrics.summaryCount, 'AI summary', 'AI summaries')}, and ${formatCountLabel(metrics.tagCount, 'active tag')}.`;
        }
    }

    if (searchStatusElement) {
        searchStatusElement.textContent = trimmedQuery
            ? (state.isSearching ? 'Searching...' : state.searchStatusMessage)
            : (activeTagFilter ? `Filter active: ${activeTagFilter}` : '');
    }
}

function createNoteCard(note) {
    const article = document.createElement('article');
    const topRow = document.createElement('div');
    const headingGroup = document.createElement('div');
    const title = document.createElement('h2');
    const meta = document.createElement('div');
    const typeLabel = document.createElement('span');
    const timeLabel = document.createElement('time');
    const actions = document.createElement('div');
    const summarizeButton = document.createElement('button');
    const deleteButton = document.createElement('button');
    const linkPreview = document.createElement('div');
    const bodyText = document.createElement('p');
    const summaryText = document.createElement('p');
    const errorText = document.createElement('p');
    const tags = document.createElement('div');
    const uiState = getNoteUiState(note.id);
    const canSummarize = Boolean(note.content && !note.summary);
    const isSearchResult = state.query.trim() && state.resolvedSearchQuery === state.query.trim();
    const relevanceScore = state.searchResultScores[note.id];

    article.className = 'note-card';
    if (note.type === 'link') {
        article.classList.add('note-card-link');
    }
    article.dataset.noteId = note.id;

    topRow.className = 'note-top';
    headingGroup.className = 'note-heading';
    title.className = 'note-title';
    title.textContent = note.title || (note.type === 'link' ? 'Saved link' : 'Untitled note');

    meta.className = 'note-meta';
    typeLabel.className = 'note-type';
    timeLabel.className = 'note-time';
    typeLabel.textContent = note.type === 'link' ? 'Link' : 'Note';
    timeLabel.textContent = formatRelativeTime(note.createdAt);
    timeLabel.dateTime = note.createdAt;
    meta.append(typeLabel, timeLabel);

    if (isSearchResult && relevanceScore != null) {
        const relevance = document.createElement('span');

        relevance.className = 'note-relevance';
        relevance.textContent = formatSearchScore(relevanceScore);
        relevance.title = state.searchSource === 'local'
            ? 'Local text match score'
            : 'Semantic relevance score';
        meta.append(relevance);
    }

    actions.className = 'note-actions';

    if (canSummarize) {
        summarizeButton.className = 'note-summarize';
        summarizeButton.type = 'button';
        summarizeButton.dataset.noteId = note.id;
        summarizeButton.disabled = uiState.isSummarizing;
        summarizeButton.setAttribute('aria-label', `Summarize ${note.title || 'note'}`);
        summarizeButton.setAttribute('aria-busy', String(uiState.isSummarizing));

        if (uiState.isSummarizing) {
            const spinner = document.createElement('span');
            const label = document.createElement('span');

            spinner.className = 'button-spinner';
            spinner.setAttribute('aria-hidden', 'true');
            label.textContent = 'Summarizing...';
            summarizeButton.append(spinner, label);
        } else {
            const icon = document.createElement('span');
            const label = document.createElement('span');

            icon.className = 'note-summarize-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = 'AI';
            label.textContent = 'Summarize';
            summarizeButton.append(icon, label);
        }

        actions.append(summarizeButton);
    }

    deleteButton.className = 'note-delete';
    deleteButton.type = 'button';
    deleteButton.dataset.noteId = note.id;
    deleteButton.setAttribute('aria-label', `Delete ${note.title || 'note'}`);
    deleteButton.textContent = 'Delete';

    actions.append(deleteButton);
    headingGroup.append(title, meta);
    topRow.append(headingGroup, actions);
    article.append(topRow);

    if (note.type === 'link' && note.url) {
        linkPreview.className = 'note-link-row';

        if (note.favicon) {
            const favicon = document.createElement('img');

            favicon.className = 'note-favicon';
            favicon.src = note.favicon;
            favicon.alt = '';
            favicon.loading = 'lazy';
            favicon.decoding = 'async';
            favicon.referrerPolicy = 'no-referrer';
            favicon.addEventListener('error', () => {
                favicon.remove();
            }, { once: true });
            linkPreview.append(favicon);
        }

        const link = document.createElement('a');
        link.className = 'note-link';
        link.href = note.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = note.url;
        linkPreview.append(link);
        article.append(linkPreview);
    }

    if (note.content) {
        bodyText.className = 'note-content';
        bodyText.textContent = truncateText(note.content, 200);
        article.append(bodyText);
    }

    if (note.summary) {
        summaryText.className = 'note-summary';
        summaryText.textContent = note.summary;
        article.append(summaryText);
    }

    if (uiState.error) {
        errorText.className = 'note-error';
        errorText.textContent = uiState.error;
        errorText.setAttribute('role', 'alert');
        article.append(errorText);
    }

    tags.className = 'note-tags';

    if (note.tags.length) {
        note.tags.forEach((tag) => tags.append(createTagPill(tag)));
    } else {
        const emptyTag = document.createElement('span');
        emptyTag.className = 'note-tag note-tag-muted';
        emptyTag.textContent = 'untagged';
        tags.append(emptyTag);
    }

    article.append(tags);

    return article;
}

function clearCaptureInputs({
    contentInput,
    urlInput,
    tagsInput,
    tagsTextInput,
    tagsList,
    suggestionsWrap,
    suggestionsList
}) {
    contentInput.value = '';
    urlInput.value = '';
    state.captureTags = [];
    tagsInput.value = '';
    tagsTextInput.value = '';
    renderCaptureTagsInput({ tagsInput, tagsTextInput, tagsList });
    resetCaptureTagSuggestions({ suggestionsWrap, suggestionsList });
}

function setSaveButtonLabel(label, saveButton) {
    state.saveButtonLabel = label;
    updateSaveButton(saveButton);
}

function updateSaveButton(saveButton) {
    if (!saveButton) {
        return;
    }

    saveButton.disabled = state.isSavingNote;
    saveButton.textContent = state.isSavingNote ? state.saveButtonLabel : 'Save';
}

async function summarizeNote(noteId) {
    const note = Storage.getById(noteId);

    if (!note || !note.content || note.summary) {
        return false;
    }

    setNoteUiState(noteId, { isSummarizing: true, error: '' });
    renderNotesList();

    try {
        const summary = await requestSummary(note.content);
        const updatedNote = Storage.update(noteId, { summary });

        if (!updatedNote) {
            throw new Error('Could not save the summary.');
        }

        clearNoteUiState(noteId);
        setFeedback('Summary added.');
        renderNotesList();
        return true;
    } catch (error) {
        console.error('Failed to summarize note.', error);
        setNoteUiState(noteId, {
            isSummarizing: false,
            error: error instanceof Error ? error.message : 'Could not summarize this note right now.'
        });
        renderNotesList();
        return false;
    }
}

async function saveNote({
    contentInput,
    urlInput,
    tagsInput,
    tagsTextInput,
    tagsList,
    suggestionsWrap,
    suggestionsList,
    saveButton
}) {
    if (state.isSavingNote) {
        return false;
    }

    commitCaptureTagInput({ tagsInput, tagsTextInput, tagsList });

    const nextNote = createNoteFromInputs({
        content: contentInput.value,
        url: urlInput.value,
        tags: tagsInput.value
    });

    if (!nextNote) {
        setFeedback('Add a note or a link before saving.');
        return false;
    }

    state.isSavingNote = true;
    state.saveButtonLabel = 'Saving...';
    updateSaveButton(saveButton);

    let noteToSave = nextNote;
    let successMessage = 'Saved.';
    let linkMetadataErrorMessage = '';
    let summaryErrorMessage = '';

    try {
        if (nextNote.type === 'link' && nextNote.url) {
            setFeedback('Fetching link info...');
            setSaveButtonLabel('Fetching link info...', saveButton);

            try {
                const metadata = await requestLinkMetadata(nextNote.url);
                noteToSave = mergeLinkMetadata(noteToSave, metadata);
            } catch (error) {
                console.error('Failed to fetch link metadata before saving note.', error);
                linkMetadataErrorMessage = error instanceof Error
                    ? error.message
                    : 'Could not fetch link info right now.';
            }
        }

        if (state.captureAutoSummarize && noteToSave.content) {
            setFeedback('Saving and summarizing...');
            setSaveButtonLabel('Saving...', saveButton);
            noteToSave = {
                ...nextNote,
                ...noteToSave,
                summary: await requestSummary(noteToSave.content)
            };
            successMessage = linkMetadataErrorMessage
                ? `Saved and summarized. Link info unavailable, so the raw URL was saved.`
                : 'Saved and summarized.';
        } else {
            setFeedback(linkMetadataErrorMessage ? 'Saving with raw URL...' : 'Saving...');
            setSaveButtonLabel('Saving...', saveButton);
            successMessage = linkMetadataErrorMessage
                ? 'Saved with raw URL.'
                : 'Saved.';
        }
    } catch (error) {
        console.error('Failed to summarize before saving note.', error);
        summaryErrorMessage = error instanceof Error
            ? error.message
            : 'Could not summarize this note right now.';
        successMessage = linkMetadataErrorMessage
            ? `Saved with raw URL and without summary. ${summaryErrorMessage}`
            : `Saved without summary. ${summaryErrorMessage}`;
    }

    try {
        const savedNote = Storage.save(noteToSave);

        if (!savedNote) {
            setFeedback('Could not save this note. Please try again.');
            return false;
        }

        if (summaryErrorMessage) {
            setNoteUiState(savedNote.id, {
                isSummarizing: false,
                error: summaryErrorMessage
            });
        } else {
            clearNoteUiState(savedNote.id);
        }

        clearCaptureInputs({
            contentInput,
            urlInput,
            tagsInput,
            tagsTextInput,
            tagsList,
            suggestionsWrap,
            suggestionsList
        });
        contentInput.focus();
        setFeedback(successMessage);

        if (state.query.trim()) {
            scheduleSearch(state.query, { immediate: true });
        } else {
            renderNotesList();
        }

        return true;
    } finally {
        state.isSavingNote = false;
        state.saveButtonLabel = 'Save';
        updateSaveButton(saveButton);
    }
}

function renderNotesList() {
    const notesList = document.querySelector('#notes-list');

    if (!notesList) {
        return;
    }

    const allNotes = Storage.getAll();
    renderTagFilters(allNotes);
    state.notes = getDisplayedNotes(allNotes);

    syncOverview(allNotes);

    if (!state.notes.length) {
        notesList.replaceChildren(createEmptyState(state.query));
        return;
    }

    const fragment = document.createDocumentFragment();

    state.notes.forEach((note) => {
        fragment.append(createNoteCard(note));
    });

    notesList.replaceChildren(fragment);
}

function renderApp() {
    app.innerHTML = `
        <main class="shell">
            <div class="app-grid">
                <section class="hero-grid">
                    <header class="panel hero-panel">
                        <div class="hero-topbar">
                            <p class="eyebrow">Knowledge Hub</p>
                            <button id="theme-toggle" class="theme-toggle" type="button">
                                <span class="theme-toggle-label">Theme</span>
                                <span id="theme-toggle-value" class="theme-toggle-value">Light mode</span>
                            </button>
                        </div>
                        <h1>Capture what matters. Revisit it with clarity.</h1>
                        <p class="hero-copy">A calm, modern workspace for notes, links, and AI summaries that stays readable in light and dark themes.</p>

                        <div class="hero-metrics" aria-label="Knowledge Hub overview">
                            <article class="metric-card">
                                <span class="metric-label">Saved items</span>
                                <strong id="metric-total" class="metric-value">0</strong>
                            </article>

                            <article class="metric-card">
                                <span class="metric-label">Saved links</span>
                                <strong id="metric-links" class="metric-value">0</strong>
                            </article>

                            <article class="metric-card">
                                <span class="metric-label">AI summaries</span>
                                <strong id="metric-summaries" class="metric-value">0</strong>
                            </article>

                            <article class="metric-card">
                                <span class="metric-label">Active tags</span>
                                <strong id="metric-tags" class="metric-value">0</strong>
                            </article>
                        </div>
                    </header>

                    <section class="panel capture-panel">
                        <div class="panel-header">
                            <p class="panel-kicker">New entry</p>
                            <div>
                                <h2 class="panel-title">Save a note or link</h2>
                                <p class="panel-copy">Drop in a thought, source, or quick reference. AI summaries stay optional and existing note behavior remains unchanged.</p>
                            </div>
                        </div>

                        <div class="capture-grid">
                            <label class="field field-note">
                                <span>Note</span>
                                <textarea id="note-content" rows="6" placeholder="What did you just learn?"></textarea>
                            </label>

                            <div class="field-row">
                                <label class="field">
                                    <span>Link</span>
                                    <input id="note-url" type="url" placeholder="Paste a link (optional)">
                                </label>

                                <label class="field">
                                    <span>Tags</span>
                                    <div class="tag-input" id="note-tags-control">
                                        <div id="capture-tags-list" class="capture-tags-list" aria-live="polite"></div>
                                        <input id="note-tags-input" type="text" placeholder="Type a tag and press comma or Enter">
                                    </div>
                                    <div id="capture-tag-suggestions" class="capture-suggestions" hidden>
                                        <span class="capture-suggestions-label">Suggested:</span>
                                        <div id="capture-tag-suggestions-list" class="capture-tag-suggestions-list" aria-live="polite"></div>
                                    </div>
                                    <input id="note-tags" type="hidden" value="">
                                </label>
                            </div>

                            <label class="field field-toggle">
                                <span>Summarize on save</span>
                                <span class="toggle-control">
                                    <input id="note-auto-summarize" type="checkbox">
                                    <span class="toggle-copy">Create an AI summary when this note has content.</span>
                                </span>
                            </label>

                            <div class="capture-actions">
                                <button id="save-note" class="primary-button" type="button">Save</button>
                                <p id="capture-feedback" class="capture-feedback" aria-live="polite"></p>
                            </div>
                        </div>
                    </section>
                </section>

                <section class="panel notes-panel">
                    <div class="notes-heading">
                        <div class="notes-title-group">
                            <p class="panel-kicker">Library</p>
                            <h2 id="notes-panel-title" class="panel-title">Your saved knowledge</h2>
                            <p id="notes-summary" class="notes-summary">Browse notes, links, and AI summaries from one place.</p>
                        </div>

                        <span id="notes-results-pill" class="results-pill">0 AI summaries</span>
                    </div>

                    <label class="field search-field">
                        <span>Search</span>
                        <input id="notes-search" type="search" placeholder="Search notes, links, and tags...">
                    </label>
                    <div id="notes-tag-filters" class="tag-filter-bar" aria-label="Filter notes by tag" hidden></div>
                    <p id="notes-search-status" class="notes-search-status" aria-live="polite"></p>

                    <div id="notes-list" class="notes-list" aria-live="polite"></div>
                </section>
            </div>
        </main>
    `;

    const contentInput = document.querySelector('#note-content');
    const urlInput = document.querySelector('#note-url');
    const tagsInput = document.querySelector('#note-tags');
    const tagsTextInput = document.querySelector('#note-tags-input');
    const tagsList = document.querySelector('#capture-tags-list');
    const tagsControl = document.querySelector('#note-tags-control');
    const tagSuggestions = document.querySelector('#capture-tag-suggestions');
    const tagSuggestionsList = document.querySelector('#capture-tag-suggestions-list');
    const autoSummarizeInput = document.querySelector('#note-auto-summarize');
    const searchInput = document.querySelector('#notes-search');
    const tagFilters = document.querySelector('#notes-tag-filters');
    const saveButton = document.querySelector('#save-note');
    const notesList = document.querySelector('#notes-list');
    const themeToggle = document.querySelector('#theme-toggle');
    const captureTagControls = {
        tagsInput,
        tagsTextInput,
        tagsList,
        suggestionsWrap: tagSuggestions,
        suggestionsList: tagSuggestionsList
    };

    autoSummarizeInput.checked = state.captureAutoSummarize;
    searchInput.value = state.query;
    renderCaptureTagsInput(captureTagControls);
    renderCaptureTagSuggestions(captureTagControls);
    applyThemePreference();

    themeToggle.addEventListener('click', () => {
        toggleThemePreference();
    });

    saveButton.addEventListener('click', async () => {
        try {
            await saveNote({
                contentInput,
                urlInput,
                tagsInput,
                tagsTextInput,
                tagsList,
                suggestionsWrap: tagSuggestions,
                suggestionsList: tagSuggestionsList,
                saveButton
            });
        } catch (error) {
            console.error('Failed to save note.', error);
            setFeedback('Could not save this note. Please try again.');
        } finally {
            updateSaveButton(saveButton);
        }
    });

    autoSummarizeInput.addEventListener('change', (event) => {
        state.captureAutoSummarize = Boolean(event.target.checked);
    });

    searchInput.addEventListener('input', (event) => {
        state.query = event.target.value;
        scheduleSearch(state.query);
    });

    contentInput.addEventListener('input', (event) => {
        scheduleTagSuggestions(event.target.value, captureTagControls);
    });

    tagsControl.addEventListener('click', (event) => {
        if (event.target instanceof HTMLButtonElement) {
            return;
        }

        tagsTextInput.focus();
    });

    tagsTextInput.addEventListener('input', () => {
        if (!tagsTextInput.value.includes(',')) {
            return;
        }

        commitCaptureTagInput(captureTagControls, { keepLastFragment: true });
    });

    tagsTextInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitCaptureTagInput(captureTagControls);
            return;
        }

        if (event.key === 'Backspace' && !tagsTextInput.value && state.captureTags.length) {
            removeCaptureTag(state.captureTags.at(-1), captureTagControls);
        }
    });

    tagsTextInput.addEventListener('blur', () => {
        commitCaptureTagInput(captureTagControls);
    });

    tagsList.addEventListener('click', (event) => {
        const target = event.target instanceof HTMLElement
            ? event.target.closest('.capture-tag-remove')
            : null;

        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        removeCaptureTag(target.dataset.tag, captureTagControls);
        tagsTextInput.focus();
    });

    tagSuggestionsList.addEventListener('click', (event) => {
        const target = event.target instanceof HTMLElement
            ? event.target.closest('.suggested-tag-pill')
            : null;

        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        addCaptureTags([target.dataset.tag], captureTagControls);
        tagsTextInput.focus();
    });

    tagFilters.addEventListener('click', (event) => {
        const target = event.target instanceof HTMLElement
            ? event.target.closest('.tag-filter-pill')
            : null;

        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        state.activeTagFilter = state.activeTagFilter === target.dataset.tag
            ? ''
            : String(target.dataset.tag || '');
        renderNotesList();
    });

    document.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || event.altKey || event.shiftKey) {
            return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            searchInput.focus();
            searchInput.select();
        }
    });

    notesList.addEventListener('click', async (event) => {
        const target = event.target instanceof HTMLElement
            ? event.target.closest('button')
            : null;

        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        if (target.matches('.note-summarize')) {
            await summarizeNote(target.dataset.noteId);
            return;
        }

        if (!target.matches('.note-delete')) {
            return;
        }

        try {
            const deleted = Storage.delete(target.dataset.noteId);

            if (!deleted) {
                setFeedback('That note could not be deleted.');
                return;
            }

            setFeedback('Deleted.');
            clearNoteUiState(target.dataset.noteId);

            if (state.query.trim()) {
                scheduleSearch(state.query, { immediate: true });
            } else {
                renderNotesList();
            }
        } catch (error) {
            console.error('Failed to delete note.', error);
            setFeedback('That note could not be deleted.');
        }
    });

    renderNotesList();
}

themeMediaQuery.addEventListener('change', () => {
    if (state.themePreference === 'system') {
        applyThemePreference();
    }
});

renderApp();
