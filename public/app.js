const STORAGE_KEY = 'kh-notes';
const THEME_STORAGE_KEY = 'kh-theme';
const THEME_COLORS = {
    light: '#f3f7fb',
    dark: '#071018'
};
const app = document.querySelector('#app');
const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

const state = {
    notes: [],
    query: '',
    feedback: '',
    captureAutoSummarize: false,
    isSavingNote: false,
    noteUi: {},
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
    const type = note.type === 'link' || url ? 'link' : 'note';
    const title = typeof note.title === 'string' && note.title.trim()
        ? note.title.trim()
        : deriveTitle({ content, url, type });
    const tags = Array.isArray(note.tags)
        ? note.tags.map((tag) => String(tag).trim()).filter(Boolean)
        : [];
    const summary = typeof note.summary === 'string' ? note.summary.trim() : '';

    return {
        id: '',
        type,
        content,
        url,
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
    return String(value || '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
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
    return pill;
}

function createEmptyState(query) {
    const emptyState = document.createElement('div');
    const title = document.createElement('p');
    const copy = document.createElement('p');
    const trimmedQuery = query.trim();

    emptyState.className = 'empty-state';
    title.className = 'empty-state-title';
    copy.className = 'empty-state-copy';

    if (trimmedQuery) {
        title.textContent = 'No matching notes';
        copy.textContent = 'Try a different keyword or clear the search to return to your full library.';
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
    const summaryElement = document.querySelector('#notes-summary');
    const resultsPill = document.querySelector('#notes-results-pill');
    const trimmedQuery = state.query.trim();

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

    if (resultsPill) {
        resultsPill.textContent = trimmedQuery
            ? `${formatCountLabel(state.notes.length, 'match')}`
            : `${formatCountLabel(metrics.summaryCount, 'AI summary', 'AI summaries')}`;
    }

    if (summaryElement) {
        summaryElement.textContent = trimmedQuery
            ? `Showing ${formatCountLabel(state.notes.length, 'result')} for "${trimmedQuery}".`
            : `${formatCountLabel(metrics.totalCount, 'saved item')} including ${formatCountLabel(metrics.linkCount, 'link')}, ${formatCountLabel(metrics.summaryCount, 'AI summary', 'AI summaries')}, and ${formatCountLabel(metrics.tagCount, 'active tag')}.`;
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
    const bodyText = document.createElement('p');
    const summaryText = document.createElement('p');
    const errorText = document.createElement('p');
    const tags = document.createElement('div');
    const uiState = getNoteUiState(note.id);
    const canSummarize = Boolean(note.content && !note.summary);

    article.className = 'note-card';
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
        const link = document.createElement('a');
        link.className = 'note-link';
        link.href = note.url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = note.url;
        article.append(link);
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

function clearCaptureInputs({ contentInput, urlInput, tagsInput }) {
    contentInput.value = '';
    urlInput.value = '';
    tagsInput.value = '';
}

function updateSaveButton(saveButton) {
    if (!saveButton) {
        return;
    }

    saveButton.disabled = state.isSavingNote;
    saveButton.textContent = state.isSavingNote ? 'Saving...' : 'Save';
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

async function saveNote({ contentInput, urlInput, tagsInput, saveButton }) {
    if (state.isSavingNote) {
        return false;
    }

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
    updateSaveButton(saveButton);

    let noteToSave = nextNote;
    let successMessage = 'Saved.';
    let summaryErrorMessage = '';

    try {
        if (state.captureAutoSummarize && nextNote.content) {
            setFeedback('Saving and summarizing...');
            noteToSave = {
                ...nextNote,
                summary: await requestSummary(nextNote.content)
            };
            successMessage = 'Saved and summarized.';
        } else {
            setFeedback('Saving...');
        }
    } catch (error) {
        console.error('Failed to summarize before saving note.', error);
        summaryErrorMessage = error instanceof Error
            ? error.message
            : 'Could not summarize this note right now.';
        successMessage = `Saved without summary. ${summaryErrorMessage}`;
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

        clearCaptureInputs({ contentInput, urlInput, tagsInput });
        contentInput.focus();
        setFeedback(successMessage);
        renderNotesList();
        return true;
    } finally {
        state.isSavingNote = false;
        updateSaveButton(saveButton);
    }
}

function renderNotesList() {
    const notesList = document.querySelector('#notes-list');

    if (!notesList) {
        return;
    }

    const allNotes = Storage.getAll();

    state.notes = state.query.trim()
        ? Storage.search(state.query)
        : allNotes;

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
                                    <input id="note-tags" type="text" placeholder="Add tags, comma separated">
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
                            <h2 class="panel-title">Your saved knowledge</h2>
                            <p id="notes-summary" class="notes-summary">Browse notes, links, and AI summaries from one place.</p>
                        </div>

                        <span id="notes-results-pill" class="results-pill">0 AI summaries</span>
                    </div>

                    <label class="field search-field">
                        <span>Search</span>
                        <input id="notes-search" type="search" placeholder="Search notes, links, and tags...">
                    </label>

                    <div id="notes-list" class="notes-list" aria-live="polite"></div>
                </section>
            </div>
        </main>
    `;

    const contentInput = document.querySelector('#note-content');
    const urlInput = document.querySelector('#note-url');
    const tagsInput = document.querySelector('#note-tags');
    const autoSummarizeInput = document.querySelector('#note-auto-summarize');
    const searchInput = document.querySelector('#notes-search');
    const saveButton = document.querySelector('#save-note');
    const notesList = document.querySelector('#notes-list');
    const themeToggle = document.querySelector('#theme-toggle');

    autoSummarizeInput.checked = state.captureAutoSummarize;
    searchInput.value = state.query;
    applyThemePreference();

    themeToggle.addEventListener('click', () => {
        toggleThemePreference();
    });

    saveButton.addEventListener('click', async () => {
        try {
            await saveNote({ contentInput, urlInput, tagsInput, saveButton });
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
        renderNotesList();
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
            renderNotesList();
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
