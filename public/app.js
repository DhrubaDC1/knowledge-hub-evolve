const STORAGE_KEY = 'kh-notes';
const THEME_STORAGE_KEY = 'kh-theme';
const THEME_COLORS = {
    light: '#f7f4ee',
    dark: '#141412'
};
const SEARCH_DEBOUNCE_MS = 300;
const TAG_SUGGESTIONS_DEBOUNCE_MS = 1000;
const TAG_SUGGESTIONS_MIN_CONTENT_LENGTH = 20;
const TAG_FILTER_TRANSITION_MS = 320;
const SUMMARY_REVEAL_RESET_MS = 700;
const UNTAGGED_FILTER_VALUE = '__untagged__';
const UNTAGGED_FILTER_LABEL = 'untagged';
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
    isFilteringByTag: false,
    filterTransitionTimer: null,
    tagSuggestionsRequestToken: 0,
    tagSuggestionsDebounceTimer: null,
    journal: null,
    isJournalLoading: false,
    journalError: '',
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
                getSearchableTagText(note)
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
    const autoTags = normalizeTags(note.autoTags).filter((tag) => tags.includes(tag));
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
        autoTags,
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

function formatJournalDate(dateValue) {
    const normalizedValue = /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || ''))
        ? `${dateValue}T12:00:00Z`
        : dateValue;
    const date = new Date(normalizedValue);

    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(date);
}

function formatJournalTime(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return new Intl.DateTimeFormat('en', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(date);
}

function formatCountLabel(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

function isUntaggedNote(note = {}) {
    return !Array.isArray(note.tags) || note.tags.length === 0;
}

function isUntaggedFilterValue(value) {
    return String(value || '') === UNTAGGED_FILTER_VALUE;
}

function getTagFilterLabel(value) {
    return isUntaggedFilterValue(value)
        ? UNTAGGED_FILTER_LABEL
        : String(value || '');
}

function getActiveTagFilterLabel() {
    return getTagFilterLabel(state.activeTagFilter);
}

function getSearchableTagText(note = {}) {
    return isUntaggedNote(note)
        ? UNTAGGED_FILTER_LABEL
        : note.tags.join(' ');
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
        getSearchableTagText(note)
    ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join('\n');
}

function calculateLocalSearchScore(note, normalizedQuery, queryTerms) {
    const title = String(note.title || '').trim().toLowerCase();
    const content = String(note.content || '').trim().toLowerCase();
    const url = String(note.url || '').trim().toLowerCase();
    const tags = getSearchableTagText(note).toLowerCase();
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

function clearTagFilterTransition() {
    if (state.filterTransitionTimer) {
        window.clearTimeout(state.filterTransitionTimer);
        state.filterTransitionTimer = null;
    }
}

function syncNotesPresentation(allNotes = state.notes) {
    const notesPanel = document.querySelector('.notes-panel');
    const notesList = document.querySelector('#notes-list');
    const tagFilters = document.querySelector('#notes-tag-filters');
    const searchInput = document.querySelector('#notes-search');
    const isSearching = state.isSearching;
    const isFiltering = state.isFilteringByTag;
    const isEmpty = state.notes.length === 0;
    const trimmedQuery = state.query.trim();
    const hasSavedNotes = Array.isArray(allNotes) && allNotes.length > 0;
    const emptyVariant = !hasSavedNotes && !trimmedQuery && !state.activeTagFilter
        ? 'library'
        : 'results';

    if (notesPanel) {
        notesPanel.classList.toggle('is-searching', isSearching);
        notesPanel.classList.toggle('is-filtering', isFiltering);
        notesPanel.classList.toggle('is-empty', isEmpty);
        notesPanel.dataset.surfaceState = isSearching
            ? 'searching'
            : (isFiltering ? 'filtering' : (isEmpty ? emptyVariant : 'default'));
    }

    if (notesList) {
        notesList.classList.toggle('is-searching', isSearching);
        notesList.classList.toggle('is-empty', isEmpty);
        notesList.classList.toggle('has-query', Boolean(trimmedQuery));
        notesList.classList.toggle('has-active-filter', Boolean(state.activeTagFilter));
        notesList.setAttribute('aria-busy', String(isSearching || isFiltering));

        if (isEmpty) {
            notesList.dataset.emptyVariant = emptyVariant;
        } else {
            delete notesList.dataset.emptyVariant;
        }
    }

    if (tagFilters) {
        tagFilters.classList.toggle('is-transitioning', isFiltering);
        tagFilters.setAttribute('aria-busy', String(isFiltering));
    }

    if (searchInput) {
        searchInput.setAttribute('aria-busy', String(isSearching));
    }
}

function beginTagFilterTransition() {
    clearTagFilterTransition();
    state.isFilteringByTag = true;
    syncNotesPresentation();

    state.filterTransitionTimer = window.setTimeout(() => {
        state.filterTransitionTimer = null;
        state.isFilteringByTag = false;
        syncNotesPresentation();
    }, TAG_FILTER_TRANSITION_MS);
}

function scheduleSummaryRevealReset(noteId) {
    window.setTimeout(() => {
        const uiState = getNoteUiState(noteId);

        if (!uiState.animateSummary) {
            return;
        }

        setNoteUiState(noteId, { animateSummary: false });

        if (!getNoteUiState(noteId).isSummarizing && !getNoteUiState(noteId).error) {
            clearNoteUiState(noteId);
        }
    }, SUMMARY_REVEAL_RESET_MS);
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

function refreshVisibleNotes() {
    if (state.query.trim()) {
        scheduleSearch(state.query, { immediate: true });
        return;
    }

    renderNotesList();
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

    if (isUntaggedFilterValue(state.activeTagFilter)) {
        return notes.filter((note) => isUntaggedNote(note));
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

async function requestJournal() {
    const response = await fetch('/api/journal');

    let payload = null;

    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Journal API not found. Run the app with `npm run dev` so Vercel serves `/api/journal`.');
        }

        throw new Error(payload?.error || 'Could not load the journal right now.');
    }

    return payload && typeof payload === 'object' ? payload : null;
}

function setFeedback(message) {
    state.feedback = message;
    const feedbackElement = document.querySelector('#capture-feedback');

    if (feedbackElement) {
        feedbackElement.textContent = message;
    }
}

function createTagPill(tag, options = {}) {
    const pill = document.createElement('span');
    const label = document.createElement('span');

    pill.className = 'note-tag';
    label.className = 'note-tag-label';
    label.textContent = tag;
    pill.append(label);
    setTagTone(tag, pill);

    if (options.isAuto && options.noteId) {
        const badge = document.createElement('span');
        const removeButton = document.createElement('button');

        pill.classList.add('note-tag-auto');

        badge.className = 'note-tag-badge';
        badge.textContent = 'Auto';
        badge.setAttribute('aria-hidden', 'true');

        removeButton.className = 'note-tag-remove';
        removeButton.type = 'button';
        removeButton.dataset.noteId = options.noteId;
        removeButton.dataset.tag = tag;
        removeButton.setAttribute('aria-label', `Remove auto-tag ${tag}`);
        removeButton.textContent = '×';

        pill.append(badge, removeButton);
    }

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

function createTagFilterPill({ value, label, count, isMuted = false }) {
    const pill = document.createElement('button');
    const labelElement = document.createElement('span');
    const countBadge = document.createElement('span');
    const filterLabel = String(label || '');

    pill.className = 'tag-filter-pill';
    pill.type = 'button';
    pill.dataset.tag = value;
    pill.setAttribute('aria-pressed', String(state.activeTagFilter === value));
    pill.setAttribute('aria-label', `Filter notes by ${filterLabel} (${formatCountLabel(count, 'note')})`);
    pill.title = `${filterLabel} • ${formatCountLabel(count, 'note')}`;

    if (isMuted) {
        pill.classList.add('is-muted');
    } else {
        setTagTone(filterLabel, pill);
    }

    labelElement.className = 'tag-filter-pill-label';
    labelElement.textContent = filterLabel;

    countBadge.className = 'tag-filter-pill-count';
    countBadge.textContent = String(count);
    countBadge.setAttribute('aria-hidden', 'true');

    pill.append(labelElement, countBadge);

    if (state.activeTagFilter === value) {
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

    const tagCounts = notes.reduce((counts, note) => {
        note.tags.forEach((tag) => {
            counts.set(tag, (counts.get(tag) || 0) + 1);
        });

        return counts;
    }, new Map());
    const tagFilterOptions = getUniqueTags(notes).map((tag) => ({
        value: tag,
        label: tag,
        count: tagCounts.get(tag) || 0
    }));
    const untaggedCount = notes.reduce((count, note) => {
        return count + (isUntaggedNote(note) ? 1 : 0);
    }, 0);

    if (untaggedCount > 0) {
        tagFilterOptions.push({
            value: UNTAGGED_FILTER_VALUE,
            label: UNTAGGED_FILTER_LABEL,
            count: untaggedCount,
            isMuted: true
        });
    }

    if (state.activeTagFilter && !tagFilterOptions.some(({ value }) => value === state.activeTagFilter)) {
        state.activeTagFilter = '';
    }

    if (!tagFilterOptions.length) {
        tagFilters.replaceChildren();
        tagFilters.hidden = true;
        return;
    }

    const fragment = document.createDocumentFragment();

    tagFilterOptions.forEach((option) => {
        fragment.append(createTagFilterPill(option));
    });

    tagFilters.hidden = false;
    tagFilters.replaceChildren(fragment);
}

function createEmptyState(allNotes) {
    const emptyState = document.createElement('div');
    const title = document.createElement('p');
    const copy = document.createElement('p');
    const trimmedQuery = state.query.trim();
    const activeTagFilter = state.activeTagFilter;
    const activeTagLabel = getActiveTagFilterLabel();
    const hasSavedNotes = Array.isArray(allNotes) && allNotes.length > 0;

    emptyState.className = 'empty-state';
    title.className = 'empty-state-title';
    copy.className = 'empty-state-copy';

    if (!hasSavedNotes && !trimmedQuery && !activeTagFilter) {
        emptyState.dataset.variant = 'library';
        title.textContent = 'No notes yet. Capture your first idea above.';
        copy.textContent = 'Save a note or link to start a calm, searchable library.';
    } else {
        emptyState.dataset.variant = 'results';
        title.textContent = 'No results found.';

        if (trimmedQuery && activeTagFilter) {
            copy.textContent = `Try a different keyword or clear the "${activeTagLabel}" filter to return more notes.`;
        } else if (trimmedQuery) {
            copy.textContent = 'Try a different keyword or clear the search to return to your full library.';
        } else if (activeTagFilter) {
            copy.textContent = isUntaggedFilterValue(activeTagFilter)
                ? 'There are no saved untagged notes yet.'
                : `There are no saved notes tagged "${activeTagLabel}" yet.`;
        } else {
            copy.textContent = 'Capture a note or link to start filling your library.';
        }
    }

    emptyState.append(title, copy);

    return emptyState;
}

function createJournalStat(label, value) {
    const stat = document.createElement('article');
    const statLabel = document.createElement('span');
    const statValue = document.createElement('strong');

    stat.className = 'journal-stat';
    statLabel.className = 'journal-stat-label';
    statLabel.textContent = label;
    statValue.className = 'journal-stat-value';
    statValue.textContent = value || '—';
    stat.append(statLabel, statValue);

    return stat;
}

function createJournalEntry(entry = {}) {
    const article = document.createElement('article');
    const time = document.createElement('p');
    const body = document.createElement('div');
    const title = document.createElement('h3');
    const details = document.createElement('p');
    const meta = document.createElement('div');
    const typePill = document.createElement('span');

    article.className = 'journal-entry';
    time.className = 'journal-entry-time';
    time.textContent = formatJournalTime(entry.timestamp);

    body.className = 'journal-entry-body';

    title.className = 'journal-entry-title';
    title.textContent = entry.title || 'Timeline event';
    body.append(title);

    if (entry.details) {
        details.className = 'journal-entry-copy';
        details.textContent = entry.details;
        body.append(details);
    }

    meta.className = 'journal-entry-meta';

    typePill.className = 'journal-entry-pill';
    typePill.textContent = entry.label || 'journal';
    meta.append(typePill);

    if (entry.item && entry.item !== entry.branch) {
        const itemPill = document.createElement('span');

        itemPill.className = 'journal-entry-pill journal-entry-pill-muted';
        itemPill.textContent = entry.item;
        meta.append(itemPill);
    }

    if (entry.branch) {
        const branchPill = document.createElement('span');

        branchPill.className = 'journal-entry-pill journal-entry-pill-muted';
        branchPill.textContent = entry.branch;
        meta.append(branchPill);
    }

    body.append(meta);
    article.append(time, body);

    return article;
}

function createJournalDayGroup(group = {}) {
    const section = document.createElement('section');
    const labelRow = document.createElement('div');
    const dayLabel = document.createElement('p');
    const dateLabel = document.createElement('p');
    const entries = document.createElement('div');

    section.className = 'journal-day';

    labelRow.className = 'journal-day-heading';
    dayLabel.className = 'journal-day-label';
    dayLabel.textContent = `Day ${group.dayNumber || 1}`;
    dateLabel.className = 'journal-day-date';
    dateLabel.textContent = formatJournalDate(group.dateKey);
    labelRow.append(dayLabel, dateLabel);

    entries.className = 'journal-day-list';
    (group.entries || []).forEach((entry) => {
        entries.append(createJournalEntry(entry));
    });

    section.append(labelRow, entries);

    return section;
}

function renderJournalSection() {
    const status = document.querySelector('#journal-status');
    const stats = document.querySelector('#journal-stats');
    const timeline = document.querySelector('#journal-timeline');
    const gitHistory = document.querySelector('#journal-git-history');
    const title = document.querySelector('#journal-panel-title');
    const copy = document.querySelector('#journal-panel-copy');

    if (!status || !stats || !timeline || !gitHistory || !title || !copy) {
        return;
    }

    const journal = state.journal;
    const snapshot = journal?.snapshot || {};
    const completedCount = Array.isArray(snapshot.completedTasks) ? snapshot.completedTasks.length : 0;

    title.textContent = journal?.title || 'Evolution journal';
    copy.textContent = journal?.bootstrappedAt
        ? `Structured from JOURNAL.md. Latest activity is grouped like a running development log, similar to the reference journal layout.`
        : 'Structured from JOURNAL.md as a running development log.';

    stats.replaceChildren(
        createJournalStat('Phase', snapshot.phase || 'Unknown'),
        createJournalStat('Tasks done', String(completedCount)),
        createJournalStat('Iterations', snapshot.iterations || '0'),
        createJournalStat('Commits', snapshot.commits || '0')
    );

    gitHistory.replaceChildren();

    if (Array.isArray(journal?.recentGitHistory) && journal.recentGitHistory.length) {
        const fragment = document.createDocumentFragment();

        journal.recentGitHistory.slice(0, 4).forEach((entry) => {
            const item = document.createElement('li');

            item.className = 'journal-git-item';
            item.textContent = entry;
            fragment.append(item);
        });

        gitHistory.append(fragment);
    } else {
        const item = document.createElement('li');

        item.className = 'journal-git-item journal-git-item-muted';
        item.textContent = 'No recent git history found.';
        gitHistory.append(item);
    }

    timeline.replaceChildren();

    if (state.isJournalLoading) {
        status.textContent = 'Loading journal...';
        status.hidden = false;
        return;
    }

    if (state.journalError) {
        status.textContent = state.journalError;
        status.hidden = false;
        return;
    }

    const groups = Array.isArray(journal?.groupedEntries) ? journal.groupedEntries : [];

    if (!groups.length) {
        status.textContent = 'No journal timeline entries yet.';
        status.hidden = false;
        return;
    }

    status.hidden = true;

    const fragment = document.createDocumentFragment();

    groups.forEach((group) => {
        fragment.append(createJournalDayGroup(group));
    });

    timeline.append(fragment);
}

async function loadJournal() {
    state.isJournalLoading = true;
    state.journalError = '';
    renderJournalSection();

    try {
        state.journal = await requestJournal();
    } catch (error) {
        console.error('Failed to load journal.', error);
        state.journalError = error instanceof Error ? error.message : 'Could not load the journal right now.';
    } finally {
        state.isJournalLoading = false;
        renderJournalSection();
    }
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
    const notesCountElement = document.querySelector('#notes-count-indicator');
    const trimmedQuery = state.query.trim();
    const activeTagFilter = state.activeTagFilter;
    const activeTagLabel = getActiveTagFilterLabel();
    const tagLabel = activeTagFilter
        ? (isUntaggedFilterValue(activeTagFilter) ? ` in ${activeTagLabel} notes` : ` tagged "${activeTagLabel}"`)
        : '';
    const shownCountLabel = formatCountLabel(state.notes.length, 'note');
    const totalCountLabel = formatCountLabel(metrics.totalCount, 'note');
    const hasScopedResults = Boolean(trimmedQuery || activeTagFilter);

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
            : (activeTagFilter
                ? (isUntaggedFilterValue(activeTagFilter) ? 'Untagged notes' : 'Tagged notes')
                : 'Your saved knowledge');
    }

    if (notesCountElement) {
        if (trimmedQuery && state.isSearching) {
            notesCountElement.textContent = `Searching ${totalCountLabel}...`;
        } else if (hasScopedResults) {
            notesCountElement.textContent = `${shownCountLabel} of ${totalCountLabel}`;
        } else {
            notesCountElement.textContent = `${totalCountLabel} saved`;
        }

        notesCountElement.title = hasScopedResults
            ? `${shownCountLabel} currently visible from ${totalCountLabel}.`
            : `${totalCountLabel} currently saved in your library.`;
        notesCountElement.classList.toggle('is-busy', trimmedQuery && state.isSearching);
        notesCountElement.classList.toggle('has-context', hasScopedResults && !state.isSearching);
    }

    if (resultsPill) {
        if (trimmedQuery && state.isSearching) {
            resultsPill.textContent = 'Searching...';
        } else if (trimmedQuery || activeTagFilter) {
            resultsPill.textContent = `${formatCountLabel(state.notes.length, 'result')}`;
        } else {
            resultsPill.textContent = `${formatCountLabel(metrics.summaryCount, 'AI summary', 'AI summaries')}`;
        }

        resultsPill.classList.toggle('is-busy', trimmedQuery && state.isSearching);
    }

    if (summaryElement) {
        if (trimmedQuery && state.isSearching) {
            summaryElement.textContent = `Searching notes for "${trimmedQuery}"${tagLabel}...`;
        } else if (trimmedQuery && state.searchSource === 'local') {
            summaryElement.textContent = `Showing ${formatCountLabel(state.notes.length, 'local result')} for "${trimmedQuery}"${tagLabel}.`;
        } else if (trimmedQuery) {
            summaryElement.textContent = `Showing ${formatCountLabel(state.notes.length, 'result')} for "${trimmedQuery}"${tagLabel}.`;
        } else if (activeTagFilter) {
            summaryElement.textContent = isUntaggedFilterValue(activeTagFilter)
                ? `Showing ${formatCountLabel(state.notes.length, 'untagged note')}.`
                : `Showing ${formatCountLabel(state.notes.length, 'saved item')} tagged "${activeTagLabel}".`;
        } else {
            summaryElement.textContent = `${formatCountLabel(metrics.totalCount, 'saved item')} including ${formatCountLabel(metrics.linkCount, 'link')}, ${formatCountLabel(metrics.summaryCount, 'AI summary', 'AI summaries')}, and ${formatCountLabel(metrics.tagCount, 'active tag')}.`;
        }

        summaryElement.classList.toggle('is-busy', trimmedQuery && state.isSearching);
    }

    if (searchStatusElement) {
        searchStatusElement.textContent = trimmedQuery
            ? (state.isSearching ? 'Searching...' : state.searchStatusMessage)
            : (activeTagFilter ? `Filter active: ${activeTagLabel}` : '');
        searchStatusElement.classList.toggle('is-busy', trimmedQuery && state.isSearching);
    }
}

function createNoteCard(note, index = 0) {
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
    article.style.setProperty('--note-index', String(Math.min(index, 7)));

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

    if (note.autoTags.length) {
        const autoTagIndicator = document.createElement('span');

        autoTagIndicator.className = 'note-auto-tag-indicator';
        autoTagIndicator.textContent = note.autoTags.length === 1
            ? '1 auto-tag'
            : `${note.autoTags.length} auto-tags`;
        autoTagIndicator.title = 'AI-suggested tags can be removed.';
        meta.append(autoTagIndicator);
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
        if (uiState.animateSummary) {
            summaryText.classList.add('is-revealed');
        }
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
        note.tags.forEach((tag) => {
            tags.append(createTagPill(tag, {
                isAuto: note.autoTags.includes(tag),
                noteId: note.id
            }));
        });
    } else {
        const emptyTag = document.createElement('span');
        emptyTag.className = 'note-tag note-tag-muted';
        emptyTag.textContent = UNTAGGED_FILTER_LABEL;
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

async function autoTagSavedNote(noteId) {
    const savedNote = Storage.getById(noteId);

    if (!savedNote || !hasMeaningfulContentForTagSuggestions(savedNote.content)) {
        return [];
    }

    try {
        const suggestedTags = await requestTagSuggestions(savedNote.content, savedNote.tags);
        const latestNote = Storage.getById(noteId);

        if (!latestNote) {
            return [];
        }

        const addedTags = suggestedTags.filter((tag) => !latestNote.tags.includes(tag));

        if (!addedTags.length) {
            return [];
        }

        const updatedNote = Storage.update(noteId, {
            tags: normalizeTags([...latestNote.tags, ...addedTags]),
            autoTags: normalizeTags([...latestNote.autoTags, ...addedTags])
        });

        if (!updatedNote) {
            return [];
        }

        setFeedback(`Saved. Added ${formatCountLabel(addedTags.length, 'auto-tag')}.`);
        refreshVisibleNotes();
        return addedTags;
    } catch (error) {
        console.error('Failed to auto-tag saved note.', error);
        return [];
    }
}

function removeAutoTag(noteId, tag) {
    const normalizedTag = normalizeTag(tag);
    const note = Storage.getById(noteId);

    if (!normalizedTag || !note || !note.autoTags.includes(normalizedTag)) {
        return false;
    }

    const updatedNote = Storage.update(noteId, {
        tags: note.tags.filter((entry) => entry !== normalizedTag),
        autoTags: note.autoTags.filter((entry) => entry !== normalizedTag)
    });

    if (!updatedNote) {
        return false;
    }

    setFeedback(`Removed auto-tag "${normalizedTag}".`);
    refreshVisibleNotes();
    return true;
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

        setNoteUiState(noteId, {
            isSummarizing: false,
            error: '',
            animateSummary: true
        });
        setFeedback('Summary added.');
        renderNotesList();
        scheduleSummaryRevealReset(noteId);
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
        refreshVisibleNotes();
        void autoTagSavedNote(savedNote.id);

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
    syncNotesPresentation(allNotes);
    notesList.classList.toggle('has-results', state.notes.length > 0);

    if (!state.notes.length) {
        notesList.replaceChildren(createEmptyState(allNotes));
        return;
    }

    const fragment = document.createDocumentFragment();

    state.notes.forEach((note, index) => {
        fragment.append(createNoteCard(note, index));
    });

    notesList.replaceChildren(fragment);
}

function getCurrentPage() {
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/journal') {
        return 'journal';
    }

    return 'home';
}

function renderJournalPanelMarkup() {
    return `
        <section class="panel journal-panel">
            <div class="journal-header">
                <div class="journal-title-group">
                    <p class="panel-kicker">// journal</p>
                    <h2 id="journal-panel-title" class="panel-title">Evolution journal</h2>
                    <p id="journal-panel-copy" class="panel-copy">Structured from JOURNAL.md as a running development log.</p>
                </div>
            </div>

            <div id="journal-stats" class="journal-stats" aria-label="Journal snapshot"></div>

            <div class="journal-grid">
                <div class="journal-timeline-shell">
                    <p id="journal-status" class="journal-status" aria-live="polite">Loading journal...</p>
                    <div id="journal-timeline" class="journal-timeline" aria-live="polite"></div>
                </div>

                <aside class="journal-sidebar">
                    <div class="journal-sidebar-card">
                        <p class="journal-sidebar-label">Recent git history</p>
                        <ul id="journal-git-history" class="journal-git-history"></ul>
                    </div>
                </aside>
            </div>
        </section>
    `;
}

function renderHomePage() {
    app.innerHTML = `
        <main class="shell">
            <div class="app-grid">
                <section class="hero-grid">
                    <header class="panel hero-panel">
                        <div class="hero-topbar">
                            <p class="eyebrow">Knowledge Hub</p>
                            <div class="header-actions">
                                <a class="secondary-link" href="/journal">Open journal</a>
                                <button id="theme-toggle" class="theme-toggle" type="button">
                                    <span class="theme-toggle-label">Theme</span>
                                    <span id="theme-toggle-value" class="theme-toggle-value">Light mode</span>
                                </button>
                            </div>
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
                    <p id="notes-count-indicator" class="notes-count-indicator" aria-live="polite">0 notes saved</p>
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
        beginTagFilterTransition();
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

        try {
            if (target.matches('.note-tag-remove')) {
                const removed = removeAutoTag(target.dataset.noteId, target.dataset.tag);

                if (!removed) {
                    setFeedback('That auto-tag could not be removed.');
                }

                return;
            }

            if (!target.matches('.note-delete')) {
                return;
            }

            const deleted = Storage.delete(target.dataset.noteId);

            if (!deleted) {
                setFeedback('That note could not be deleted.');
                return;
            }

            setFeedback('Deleted.');
            clearNoteUiState(target.dataset.noteId);
            refreshVisibleNotes();
        } catch (error) {
            console.error('Failed to delete note.', error);
            setFeedback('That note could not be deleted.');
        }
    });

    renderNotesList();
}

function renderJournalPage() {
    app.innerHTML = `
        <main class="shell">
            <div class="app-grid">
                <header class="panel page-header-panel">
                    <div class="hero-topbar">
                        <p class="eyebrow">Knowledge Hub</p>
                        <div class="header-actions">
                            <a class="secondary-link" href="/">Back to home</a>
                            <button id="theme-toggle" class="theme-toggle" type="button">
                                <span class="theme-toggle-label">Theme</span>
                                <span id="theme-toggle-value" class="theme-toggle-value">Light mode</span>
                            </button>
                        </div>
                    </div>

                    <div class="page-header-copy">
                        <p class="panel-kicker">// journal</p>
                        <h1 class="page-title">Evolution journal</h1>
                        <p class="hero-copy">A dedicated timeline view for the autonomous build log, grouped by day and kept separate from the capture workspace.</p>
                    </div>
                </header>

                ${renderJournalPanelMarkup()}
            </div>
        </main>
    `;

    const themeToggle = document.querySelector('#theme-toggle');

    applyThemePreference();

    themeToggle?.addEventListener('click', () => {
        toggleThemePreference();
    });

    renderJournalSection();
    void loadJournal();
}

function renderApp() {
    if (getCurrentPage() === 'journal') {
        renderJournalPage();
        return;
    }

    renderHomePage();
}

themeMediaQuery.addEventListener('change', () => {
    if (state.themePreference === 'system') {
        applyThemePreference();
    }
});

renderApp();
