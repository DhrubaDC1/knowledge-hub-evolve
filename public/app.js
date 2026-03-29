const STORAGE_KEY = 'kh-notes';
const app = document.querySelector('#app');
const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const state = {
    notes: [],
    query: '',
    feedback: ''
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
    const summary = typeof note.summary === 'string' && note.summary.trim()
        ? note.summary.trim()
        : deriveSummary(content || title || url);

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

function deriveSummary(content) {
    return truncateText(content, 200);
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
        summary: deriveSummary(trimmedContent || trimmedUrl),
        tags: parsedTags
    });
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

function createNoteCard(note) {
    const article = document.createElement('article');
    const topRow = document.createElement('div');
    const headingGroup = document.createElement('div');
    const title = document.createElement('h2');
    const meta = document.createElement('div');
    const typeLabel = document.createElement('span');
    const timeLabel = document.createElement('span');
    const deleteButton = document.createElement('button');
    const bodyText = document.createElement('p');
    const tags = document.createElement('div');

    article.className = 'note-card';
    article.dataset.noteId = note.id;

    topRow.className = 'note-top';
    headingGroup.className = 'note-heading';
    title.className = 'note-title';
    title.textContent = note.title || (note.type === 'link' ? 'Saved link' : 'Untitled note');

    meta.className = 'note-meta';
    typeLabel.textContent = note.type === 'link' ? 'Link' : 'Note';
    timeLabel.textContent = formatRelativeTime(note.createdAt);
    meta.append(typeLabel, timeLabel);

    deleteButton.className = 'note-delete';
    deleteButton.type = 'button';
    deleteButton.dataset.noteId = note.id;
    deleteButton.setAttribute('aria-label', `Delete ${note.title || 'note'}`);
    deleteButton.textContent = 'Delete';

    headingGroup.append(title, meta);
    topRow.append(headingGroup, deleteButton);
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

function saveNote({ contentInput, urlInput, tagsInput }) {
    const nextNote = createNoteFromInputs({
        content: contentInput.value,
        url: urlInput.value,
        tags: tagsInput.value
    });

    if (!nextNote) {
        setFeedback('Add a note or a link before saving.');
        return false;
    }

    const savedNote = Storage.save(nextNote);

    if (!savedNote) {
        setFeedback('Could not save this note. Please try again.');
        return false;
    }

    clearCaptureInputs({ contentInput, urlInput, tagsInput });
    contentInput.focus();
    setFeedback('Saved.');
    renderNotesList();
    return true;
}

function renderNotesList() {
    const notesList = document.querySelector('#notes-list');

    state.notes = state.query.trim()
        ? Storage.search(state.query)
        : Storage.getAll();

    if (!state.notes.length) {
        notesList.innerHTML = `
            <div class="empty-state">
                <p>No notes yet. Capture a thought, a link, or a quick insight to get started.</p>
            </div>
        `;
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
            <header class="hero">
                <p class="eyebrow">Knowledge Hub</p>
                <h1>Capture. Understand. Recall.</h1>
                <p class="hero-copy">A focused place for notes, links, and ideas worth returning to.</p>
            </header>

            <section class="panel capture-panel">
                <label class="field">
                    <span>Note</span>
                    <textarea id="note-content" rows="6" placeholder="What did you just learn?"></textarea>
                </label>

                <label class="field">
                    <span>Link</span>
                    <input id="note-url" type="url" placeholder="Paste a link (optional)">
                </label>

                <label class="field">
                    <span>Tags</span>
                    <input id="note-tags" type="text" placeholder="Add tags, comma separated">
                </label>

                <div class="capture-actions">
                    <button id="save-note" class="primary-button" type="button">Save</button>
                    <p id="capture-feedback" class="capture-feedback" aria-live="polite"></p>
                </div>
            </section>

            <section class="panel notes-panel">
                <label class="field search-field">
                    <span>Search</span>
                    <input id="notes-search" type="search" placeholder="Search your knowledge...">
                </label>

                <div id="notes-list" class="notes-list" aria-live="polite"></div>
            </section>
        </main>
    `;

    const contentInput = document.querySelector('#note-content');
    const urlInput = document.querySelector('#note-url');
    const tagsInput = document.querySelector('#note-tags');
    const searchInput = document.querySelector('#notes-search');
    const saveButton = document.querySelector('#save-note');
    const notesList = document.querySelector('#notes-list');

    saveButton.addEventListener('click', () => {
        try {
            saveNote({ contentInput, urlInput, tagsInput });
        } catch (error) {
            console.error('Failed to save note.', error);
            setFeedback('Could not save this note. Please try again.');
        }
    });

    searchInput.addEventListener('input', (event) => {
        state.query = event.target.value;
        renderNotesList();
    });

    notesList.addEventListener('click', (event) => {
        const target = event.target;

        if (!(target instanceof HTMLElement) || !target.matches('.note-delete')) {
            return;
        }

        try {
            const deleted = Storage.delete(target.dataset.noteId);

            if (!deleted) {
                setFeedback('That note could not be deleted.');
                return;
            }

            setFeedback('Deleted.');
            renderNotesList();
        } catch (error) {
            console.error('Failed to delete note.', error);
            setFeedback('That note could not be deleted.');
        }
    });

    renderNotesList();
}

renderApp();
