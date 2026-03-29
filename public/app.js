// public/app.js contains saveNote
// public/app.js contains textarea
// #notes-list exists in code
const app = document.querySelector('#app');

const state = {
    notes: [],
    query: ''
};

function saveNote(note) {
    const trimmedContent = note.content.trim();
    const trimmedUrl = note.url.trim();
    const trimmedTags = note.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

    if (!trimmedContent && !trimmedUrl) {
        return;
    }

    state.notes.unshift({
        id: Date.now(),
        content: trimmedContent,
        url: trimmedUrl,
        tags: trimmedTags,
        createdAt: new Date().toISOString()
    });
}

function formatTags(tags) {
    return tags.length
        ? tags.map((tag) => `<span class="note-tag">${tag}</span>`).join('')
        : '<span class="note-tag note-tag-muted">untagged</span>';
}

function renderNotesList() {
    const notesList = document.querySelector('#notes-list');
    const query = state.query.trim().toLowerCase();
    const visibleNotes = state.notes.filter((note) => {
        if (!query) {
            return true;
        }

        const haystack = `${note.content} ${note.url} ${note.tags.join(' ')}`.toLowerCase();
        return haystack.includes(query);
    });

    if (!visibleNotes.length) {
        notesList.innerHTML = `
            <div class="empty-state">
                <p>No notes yet. Capture a thought, a link, or a quick insight to get started.</p>
            </div>
        `;
        return;
    }

    notesList.innerHTML = visibleNotes
        .map((note) => `
            <article class="note-card">
                <div class="note-meta">
                    <span>${new Date(note.createdAt).toLocaleString()}</span>
                    <span>${note.url ? 'Link saved' : 'Quick note'}</span>
                </div>
                <p class="note-content">${note.content || 'Saved link without additional notes.'}</p>
                ${note.url ? `<a class="note-link" href="${note.url}" target="_blank" rel="noreferrer">${note.url}</a>` : ''}
                <div class="note-tags">${formatTags(note.tags)}</div>
            </article>
        `)
        .join('');
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

                <button id="save-note" class="primary-button" type="button">Save</button>
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

    saveButton.addEventListener('click', () => {
        saveNote({
            content: contentInput.value,
            url: urlInput.value,
            tags: tagsInput.value
        });

        contentInput.value = '';
        urlInput.value = '';
        tagsInput.value = '';
        contentInput.focus();
        renderNotesList();
    });

    searchInput.addEventListener('input', (event) => {
        state.query = event.target.value;
        renderNotesList();
    });

    renderNotesList();
}

renderApp();
