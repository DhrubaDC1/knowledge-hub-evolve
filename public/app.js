import { clusterNotesByOverlappingTags } from './cluster.js';
import {
    buildReviewUpdate,
    buildViewUpdate,
    createRevisitSuggestionsFingerprint,
    normalizeRevisitState,
    suggestRevisitNotes
} from './revisit.js';

const STORAGE_KEY = 'kh-notes';
const THEME_STORAGE_KEY = 'kh-theme';
const THEME_COLORS = {
    light: '#f7f4ee',
    dark: '#141412'
};
const SEARCH_DEBOUNCE_MS = 300;
const TAG_SUGGESTIONS_DEBOUNCE_MS = 1000;
const TAG_SUGGESTIONS_MIN_CONTENT_LENGTH = 20;
const SPEECH_RECOGNITION_MAX_DURATION_MS = 5 * 60 * 1000;
const CAPTURE_IMAGE_MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024;
const CAPTURE_IMAGE_SUPPORTED_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp'
]);
const CAPTURE_PDF_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const CAPTURE_PDF_SUPPORTED_TYPES = new Set([
    'application/pdf'
]);
const TAG_FILTER_TRANSITION_MS = 320;
const SUMMARY_REVEAL_RESET_MS = 700;
const RELATED_NOTES_MAX_RESULTS = 3;
const RELATED_QUERY_MAX_LENGTH = 2400;
const GRAPH_TEXT_FIELD_MAX_LENGTH = 1200;
const GRAPH_MIN_EDGE_WEIGHT = 0.14;
const GRAPH_MIN_SIMILARITY_SCORE = 0.18;
const GRAPH_TAG_WEIGHT_SHARE = 0.55;
const GRAPH_SIMILARITY_WEIGHT_SHARE = 0.45;
const GRAPH_MIN_SCALE = 0.55;
const GRAPH_MAX_SCALE = 2.4;
const CLUSTER_COLOR_HUES = [168, 24, 218, 338, 84, 196, 12, 266, 48, 132];
const TIMELINE_DAY_GROUP_WINDOW_DAYS = 7;
const UNTAGGED_FILTER_VALUE = '__untagged__';
const UNTAGGED_FILTER_LABEL = 'untagged';
const REVISIT_SUGGESTIONS_MAX_RESULTS = 4;
const KNOWLEDGE_HEALTH_ACTIVITY_WINDOW_DAYS = 28;
const KNOWLEDGE_HEALTH_MAX_SUGGESTIONS = 3;
const KNOWLEDGE_HEALTH_DAY_IN_MS = 86_400_000;
const GRAPH_STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'for',
    'from',
    'how',
    'i',
    'in',
    'is',
    'it',
    'of',
    'on',
    'or',
    'that',
    'the',
    'their',
    'this',
    'to',
    'was',
    'what',
    'when',
    'where',
    'which',
    'with',
    'you',
    'your'
]);
const KNOWLEDGE_HEALTH_STOP_WORDS = new Set([
    ...GRAPH_STOP_WORDS,
    'into',
    'just',
    'link',
    'links',
    'note',
    'notes',
    'saved',
    'summary',
    'them',
    'they'
]);
const app = document.querySelector('#app');
const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
const SpeechRecognitionConstructor = window.SpeechRecognition || window.webkitSpeechRecognition || null;

function createEmptyCaptureImageState() {
    return {
        fileName: '',
        mimeType: '',
        dataUrl: '',
        extractedText: '',
        isProcessing: false,
        isDragActive: false,
        error: '',
        statusMessage: '',
        requestToken: 0
    };
}

function createEmptyCapturePdfState() {
    return {
        fileName: '',
        mimeType: '',
        dataUrl: '',
        extractedText: '',
        summary: '',
        pageCount: 0,
        characterCount: 0,
        isProcessing: false,
        isDragActive: false,
        attachToNextNote: false,
        error: '',
        statusMessage: '',
        requestToken: 0
    };
}

function createEmptyPatternAnalysis() {
    return {
        topTopics: [],
        learningStreak: {
            current: 0,
            longest: 0,
            activeDays: 0,
            lastActiveDate: ''
        },
        weeklyTrend: {
            days: [],
            currentTotal: 0,
            previousTotal: 0,
            delta: 0,
            direction: 'steady'
        },
        diversityScore: {
            score: 0,
            label: 'Narrow',
            uniqueTopics: 0
        }
    };
}

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
    relatedNotesCache: {},
    isSearching: false,
    searchResults: [],
    searchResultScores: {},
    searchSource: '',
    searchStatusMessage: '',
    captureImage: createEmptyCaptureImageState(),
    capturePdf: createEmptyCapturePdfState(),
    resolvedSearchQuery: '',
    activeLibraryView: 'list',
    clusterData: createEmptyClusterData(),
    clusterFingerprint: '',
    clusterResolvedFingerprint: '',
    clusterRequestFingerprint: '',
    clusterRequestToken: 0,
    graphData: {
        nodes: [],
        edges: []
    },
    selectedGraphNoteId: '',
    searchRequestToken: 0,
    searchDebounceTimer: null,
    isFilteringByTag: false,
    filterTransitionTimer: null,
    tagSuggestionsRequestToken: 0,
    tagSuggestionsDebounceTimer: null,
    journal: null,
    isJournalLoading: false,
    journalError: '',
    patternAnalysis: createEmptyPatternAnalysis(),
    isPatternAnalysisLoading: false,
    patternAnalysisError: '',
    patternAnalysisFingerprint: '',
    patternAnalysisResolvedFingerprint: '',
    patternAnalysisRequestFingerprint: '',
    patternAnalysisRequestToken: 0,
    revisitSuggestions: [],
    isRevisitLoading: false,
    revisitError: '',
    revisitFingerprint: '',
    revisitResolvedFingerprint: '',
    revisitRequestFingerprint: '',
    revisitRequestToken: 0,
    themePreference: readThemePreference(),
    activeTheme: 'light'
};

const speechState = {
    recognition: null,
    isSupported: Boolean(SpeechRecognitionConstructor),
    isRecording: false,
    requestedStop: false,
    startedAt: 0,
    autoStopTimer: 0,
    finalTranscript: '',
    interimTranscript: '',
    statusMessage: getSpeechDefaultMessage(),
    endMessage: '',
    stopResolvers: []
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

    update(id, data, options = {}) {
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
                updatedAt: options.preserveUpdatedAt
                    ? note.updatedAt
                    : new Date().toISOString()
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

function createEmptyClusterData() {
    return {
        clusterCount: 0,
        clusters: [],
        noteClusterMap: {}
    };
}

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

function getSpeechDefaultMessage() {
    if (!SpeechRecognitionConstructor) {
        return window.isSecureContext
            ? 'Voice capture requires a browser with Web Speech API support.'
            : 'Voice capture needs HTTPS or localhost plus Web Speech API support.';
    }

    return 'Tap the mic to dictate up to 5 minutes.';
}

function clearSpeechAutoStopTimer() {
    if (!speechState.autoStopTimer) {
        return;
    }

    window.clearTimeout(speechState.autoStopTimer);
    speechState.autoStopTimer = 0;
}

function scheduleSpeechAutoStopTimer(durationMs) {
    clearSpeechAutoStopTimer();

    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return;
    }

    speechState.autoStopTimer = window.setTimeout(() => {
        void stopSpeechCapture('max-duration');
    }, durationMs);
}

function queueSpeechStopResolver() {
    return new Promise((resolve) => {
        speechState.stopResolvers.push(resolve);
    });
}

function flushSpeechStopResolvers() {
    const resolvers = [...speechState.stopResolvers];

    speechState.stopResolvers = [];
    resolvers.forEach((resolve) => resolve());
}

function getSpeechCombinedTranscript() {
    return [speechState.finalTranscript, speechState.interimTranscript]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getSpeechControls() {
    return {
        contentInput: document.querySelector('#note-content'),
        micButton: document.querySelector('#note-mic-button'),
        micLabel: document.querySelector('#note-mic-label'),
        micStatus: document.querySelector('#capture-mic-status'),
        micPreview: document.querySelector('#capture-mic-preview')
    };
}

function updateSpeechUi() {
    const { micButton, micLabel, micStatus, micPreview } = getSpeechControls();
    const previewText = getSpeechCombinedTranscript();

    if (micButton) {
        micButton.disabled = !speechState.isSupported;
        micButton.classList.toggle('is-recording', speechState.isRecording);
        micButton.classList.toggle('is-unsupported', !speechState.isSupported);
        micButton.setAttribute('aria-pressed', String(speechState.isRecording));
        micButton.setAttribute('aria-label', speechState.isRecording ? 'Stop voice capture' : 'Start voice capture');
        micButton.title = speechState.isSupported
            ? (speechState.isRecording ? 'Stop voice capture' : 'Start voice capture')
            : getSpeechDefaultMessage();

        if (micLabel) {
            micLabel.textContent = speechState.isRecording ? 'Stop recording' : 'Record note';
        }
    }

    if (micStatus) {
        micStatus.textContent = speechState.statusMessage;
    }

    if (micPreview) {
        micPreview.hidden = !previewText;
        micPreview.textContent = previewText;
    }
}

function resetSpeechSession() {
    speechState.requestedStop = false;
    speechState.startedAt = 0;
    speechState.finalTranscript = '';
    speechState.interimTranscript = '';
    speechState.endMessage = '';
    clearSpeechAutoStopTimer();
}

function mergeTranscriptIntoContent(existingContent, transcript) {
    const normalizedExisting = String(existingContent || '').trimEnd();
    const normalizedTranscript = String(transcript || '').trim();

    if (!normalizedTranscript) {
        return normalizedExisting;
    }

    if (!normalizedExisting) {
        return normalizedTranscript;
    }

    return `${normalizedExisting}\n${normalizedTranscript}`;
}

function applySpeechTranscriptToTextarea() {
    const { contentInput } = getSpeechControls();
    const transcript = getSpeechCombinedTranscript();

    if (!(contentInput instanceof HTMLTextAreaElement) || !transcript) {
        return false;
    }

    contentInput.value = mergeTranscriptIntoContent(contentInput.value, transcript);
    contentInput.focus();
    contentInput.setSelectionRange(contentInput.value.length, contentInput.value.length);
    contentInput.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

function getSpeechErrorMessage(errorCode) {
    switch (errorCode) {
        case 'not-allowed':
        case 'service-not-allowed':
            return 'Microphone access was blocked. Allow mic permission and try again.';
        case 'audio-capture':
            return 'No microphone was found. Check your audio input and try again.';
        case 'network':
            return 'Voice capture needs a stable network connection.';
        case 'no-speech':
            return 'No speech detected. Try again.';
        case 'aborted':
            return 'Voice capture stopped.';
        default:
            return 'Voice capture stopped unexpectedly. Try again.';
    }
}

function finalizeSpeechCapture() {
    const appendedTranscript = applySpeechTranscriptToTextarea();
    let statusMessage = speechState.endMessage;
    const fallbackMessage = appendedTranscript
        ? 'Transcription added to your note.'
        : 'No speech detected. Try again.';

    if (!appendedTranscript && speechState.endMessage === 'Stopped after 5 minutes. Transcription added to your note.') {
        statusMessage = 'Stopped after 5 minutes. No speech was detected.';
    } else if (!appendedTranscript && speechState.endMessage === 'Transcription added to your note.') {
        statusMessage = fallbackMessage;
    }

    speechState.isRecording = false;
    speechState.statusMessage = statusMessage || fallbackMessage;
    resetSpeechSession();
    updateSpeechUi();
    flushSpeechStopResolvers();
}

function ensureSpeechRecognition() {
    if (!speechState.isSupported) {
        return null;
    }

    if (speechState.recognition) {
        return speechState.recognition;
    }

    const recognition = new SpeechRecognitionConstructor();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = document.documentElement.lang || navigator.language || 'en-US';

    recognition.onstart = () => {
        speechState.isRecording = true;
        speechState.statusMessage = 'Listening... transcript updates in real time.';
        updateSpeechUi();
    };

    recognition.onresult = (event) => {
        const finalizedParts = [];
        const interimParts = [];

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            const transcript = result?.[0]?.transcript?.trim();

            if (!transcript) {
                continue;
            }

            if (result.isFinal) {
                finalizedParts.push(transcript);
            } else {
                interimParts.push(transcript);
            }
        }

        if (finalizedParts.length) {
            speechState.finalTranscript = [speechState.finalTranscript, finalizedParts.join(' ')]
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        speechState.interimTranscript = interimParts.join(' ').replace(/\s+/g, ' ').trim();
        speechState.statusMessage = 'Listening... transcript updates in real time.';
        updateSpeechUi();
    };

    recognition.onerror = (event) => {
        speechState.requestedStop = true;
        speechState.endMessage = getSpeechErrorMessage(event.error);
    };

    recognition.onend = () => {
        clearSpeechAutoStopTimer();

        const elapsedMs = Date.now() - speechState.startedAt;
        const remainingMs = SPEECH_RECOGNITION_MAX_DURATION_MS - elapsedMs;
        const isWithinTimeLimit = remainingMs > 0;

        if (!speechState.requestedStop && isWithinTimeLimit) {
            try {
                scheduleSpeechAutoStopTimer(remainingMs);
                recognition.start();
                return;
            } catch (error) {
                console.error('Failed to restart speech recognition.', error);
                speechState.endMessage = 'Voice capture stopped unexpectedly. Try again.';
            }
        }

        finalizeSpeechCapture();
    };

    speechState.recognition = recognition;
    return recognition;
}

async function stopSpeechCapture(reason = 'manual') {
    const recognition = speechState.recognition;

    if (!speechState.isRecording || !recognition) {
        return false;
    }

    speechState.requestedStop = true;
    clearSpeechAutoStopTimer();

    if (reason === 'max-duration') {
        speechState.endMessage = 'Stopped after 5 minutes. Transcription added to your note.';
    } else if (reason === 'manual' || reason === 'save') {
        speechState.endMessage = 'Transcription added to your note.';
    }

    const stopped = queueSpeechStopResolver();

    try {
        recognition.stop();
    } catch (error) {
        console.error('Failed to stop speech recognition cleanly.', error);
        speechState.endMessage = 'Voice capture stopped unexpectedly. Try again.';
        finalizeSpeechCapture();
    }

    await stopped;
    return true;
}

function startSpeechCapture() {
    if (!speechState.isSupported) {
        speechState.statusMessage = getSpeechDefaultMessage();
        updateSpeechUi();
        return false;
    }

    if (state.isSavingNote) {
        speechState.statusMessage = 'Finish saving before starting voice capture.';
        updateSpeechUi();
        return false;
    }

    const recognition = ensureSpeechRecognition();

    if (!recognition) {
        speechState.statusMessage = getSpeechDefaultMessage();
        updateSpeechUi();
        return false;
    }

    speechState.requestedStop = false;
    speechState.startedAt = Date.now();
    speechState.finalTranscript = '';
    speechState.interimTranscript = '';
    speechState.endMessage = '';
    speechState.statusMessage = 'Starting microphone...';
    scheduleSpeechAutoStopTimer(SPEECH_RECOGNITION_MAX_DURATION_MS);
    updateSpeechUi();

    try {
        recognition.start();
        return true;
    } catch (error) {
        console.error('Failed to start speech recognition.', error);
        clearSpeechAutoStopTimer();
        speechState.statusMessage = 'Voice capture could not start. Try again.';
        resetSpeechSession();
        updateSpeechUi();
        return false;
    }
}

async function toggleSpeechCapture() {
    if (speechState.isRecording) {
        await stopSpeechCapture('manual');
        return;
    }

    startSpeechCapture();
}

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }

    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    if (bytes >= 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }

    return `${bytes} B`;
}

function formatCharacterCount(count) {
    const normalizedCount = Number.isFinite(Number(count))
        ? Math.max(0, Math.round(Number(count)))
        : 0;

    return `${new Intl.NumberFormat('en').format(normalizedCount)} characters`;
}

function getCaptureImageControls() {
    return {
        fileInput: document.querySelector('#note-image-input'),
        dropzone: document.querySelector('#capture-image-dropzone'),
        fileName: document.querySelector('#capture-image-file-name'),
        status: document.querySelector('#capture-image-status'),
        previewWrap: document.querySelector('#capture-image-preview-wrap'),
        previewImage: document.querySelector('#capture-image-preview'),
        extractButton: document.querySelector('#capture-image-process'),
        clearButton: document.querySelector('#capture-image-clear'),
        insertButton: document.querySelector('#capture-image-insert'),
        extractedWrap: document.querySelector('#capture-image-results'),
        extractedText: document.querySelector('#capture-image-text')
    };
}

function getDefaultCaptureImageMessage() {
    return `Drop a PNG, JPG, or WebP image here, or choose one to extract text. Max ${formatFileSize(CAPTURE_IMAGE_MAX_FILE_SIZE_BYTES)}.`;
}

function getCaptureImageStatusMessage() {
    if (state.captureImage.error) {
        return state.captureImage.error;
    }

    if (state.captureImage.isProcessing) {
        return state.captureImage.fileName
            ? `Extracting text from ${state.captureImage.fileName}...`
            : 'Extracting text from the image...';
    }

    if (state.captureImage.statusMessage) {
        return state.captureImage.statusMessage;
    }

    if (state.captureImage.dataUrl) {
        return 'Image ready. Extract text when you’re ready.';
    }

    return getDefaultCaptureImageMessage();
}

function renderCaptureImage(controls = getCaptureImageControls()) {
    const {
        fileInput,
        dropzone,
        fileName,
        status,
        previewWrap,
        previewImage,
        extractButton,
        clearButton,
        insertButton,
        extractedWrap,
        extractedText
    } = controls;
    const hasImage = Boolean(state.captureImage.dataUrl);
    const hasExtractedText = Boolean(state.captureImage.extractedText);

    if (dropzone) {
        dropzone.classList.toggle('is-active', state.captureImage.isDragActive);
        dropzone.classList.toggle('has-image', hasImage);
        dropzone.classList.toggle('is-processing', state.captureImage.isProcessing);
    }

    if (status) {
        status.textContent = getCaptureImageStatusMessage();
        status.classList.toggle('is-error', Boolean(state.captureImage.error));
    }

    if (fileName) {
        fileName.hidden = !hasImage;
        fileName.textContent = state.captureImage.fileName;
    }

    if (previewWrap) {
        previewWrap.hidden = !hasImage;
    }

    if (previewImage) {
        previewImage.hidden = !hasImage;
        previewImage.src = hasImage ? state.captureImage.dataUrl : '';
        previewImage.alt = state.captureImage.fileName
            ? `Preview of ${state.captureImage.fileName}`
            : 'Selected upload preview';
    }

    if (extractButton) {
        extractButton.disabled = !hasImage || state.captureImage.isProcessing;
        extractButton.textContent = state.captureImage.isProcessing ? 'Extracting...' : 'Extract text';
    }

    if (clearButton) {
        clearButton.hidden = !hasImage;
        clearButton.disabled = state.captureImage.isProcessing;
    }

    if (insertButton) {
        insertButton.hidden = !hasExtractedText;
        insertButton.disabled = !hasExtractedText || state.captureImage.isProcessing;
    }

    if (extractedWrap) {
        extractedWrap.hidden = !hasExtractedText;
    }

    if (extractedText) {
        extractedText.value = state.captureImage.extractedText;
    }

    if (fileInput && !hasImage && fileInput.value) {
        fileInput.value = '';
    }
}

function setCaptureImageState(patch = {}, controls = getCaptureImageControls()) {
    state.captureImage = {
        ...state.captureImage,
        ...patch
    };
    renderCaptureImage(controls);
}

function resetCaptureImageState(controls = getCaptureImageControls()) {
    state.captureImage = createEmptyCaptureImageState();
    renderCaptureImage(controls);
}

function getCapturePdfControls() {
    return {
        fileInput: document.querySelector('#note-pdf-input'),
        dropzone: document.querySelector('#capture-pdf-dropzone'),
        fileName: document.querySelector('#capture-pdf-file-name'),
        status: document.querySelector('#capture-pdf-status'),
        extractButton: document.querySelector('#capture-pdf-process'),
        clearButton: document.querySelector('#capture-pdf-clear'),
        insertButton: document.querySelector('#capture-pdf-insert'),
        extractedWrap: document.querySelector('#capture-pdf-results'),
        extractedText: document.querySelector('#capture-pdf-text'),
        summary: document.querySelector('#capture-pdf-summary'),
        metadataWrap: document.querySelector('#capture-pdf-meta'),
        pageCount: document.querySelector('#capture-pdf-page-count'),
        characterCount: document.querySelector('#capture-pdf-character-count')
    };
}

function getDefaultCapturePdfMessage() {
    return `Drop a PDF here, or choose one to extract text. Max ${formatFileSize(CAPTURE_PDF_MAX_FILE_SIZE_BYTES)}.`;
}

function getCapturePdfStatusMessage() {
    if (state.capturePdf.error) {
        return state.capturePdf.error;
    }

    if (state.capturePdf.isProcessing) {
        return state.capturePdf.fileName
            ? `Extracting text from ${state.capturePdf.fileName}...`
            : 'Extracting text from the PDF...';
    }

    if (state.capturePdf.statusMessage) {
        return state.capturePdf.statusMessage;
    }

    if (state.capturePdf.dataUrl) {
        return 'PDF ready. Extract text when you’re ready.';
    }

    return getDefaultCapturePdfMessage();
}

function renderCapturePdf(controls = getCapturePdfControls()) {
    const {
        fileInput,
        dropzone,
        fileName,
        status,
        extractButton,
        clearButton,
        insertButton,
        extractedWrap,
        extractedText,
        summary,
        metadataWrap,
        pageCount,
        characterCount
    } = controls;
    const hasPdf = Boolean(state.capturePdf.dataUrl);
    const hasText = Boolean(state.capturePdf.extractedText);
    const hasSummary = Boolean(state.capturePdf.summary);
    const hasMetadata = state.capturePdf.pageCount > 0 || state.capturePdf.characterCount > 0;
    const hasResults = hasText || hasSummary || hasMetadata;

    if (dropzone) {
        dropzone.classList.toggle('is-active', state.capturePdf.isDragActive);
        dropzone.classList.toggle('has-image', hasPdf);
        dropzone.classList.toggle('is-processing', state.capturePdf.isProcessing);
    }

    if (status) {
        status.textContent = getCapturePdfStatusMessage();
        status.classList.toggle('is-error', Boolean(state.capturePdf.error));
    }

    if (fileName) {
        fileName.hidden = !hasPdf;
        fileName.textContent = state.capturePdf.fileName;
    }

    if (extractButton) {
        extractButton.disabled = !hasPdf || state.capturePdf.isProcessing;
        extractButton.textContent = state.capturePdf.isProcessing ? 'Extracting...' : 'Extract text';
    }

    if (clearButton) {
        clearButton.hidden = !hasPdf;
        clearButton.disabled = state.capturePdf.isProcessing;
    }

    if (insertButton) {
        insertButton.hidden = !hasText;
        insertButton.disabled = !hasText || state.capturePdf.isProcessing;
    }

    if (extractedWrap) {
        extractedWrap.hidden = !hasResults;
    }

    if (metadataWrap) {
        metadataWrap.hidden = !hasMetadata;
    }

    if (pageCount) {
        pageCount.hidden = state.capturePdf.pageCount <= 0;
        pageCount.textContent = formatCountLabel(state.capturePdf.pageCount, 'page');
    }

    if (characterCount) {
        characterCount.hidden = state.capturePdf.characterCount <= 0;
        characterCount.textContent = formatCharacterCount(state.capturePdf.characterCount);
    }

    if (summary) {
        summary.hidden = !hasSummary;
        summary.textContent = state.capturePdf.summary;
    }

    if (extractedText) {
        extractedText.value = state.capturePdf.extractedText;
    }

    if (fileInput && !hasPdf && fileInput.value) {
        fileInput.value = '';
    }
}

function setCapturePdfState(patch = {}, controls = getCapturePdfControls()) {
    state.capturePdf = {
        ...state.capturePdf,
        ...patch
    };
    renderCapturePdf(controls);
}

function resetCapturePdfState(controls = getCapturePdfControls()) {
    state.capturePdf = createEmptyCapturePdfState();
    renderCapturePdf(controls);
}

function isSupportedCapturePdfFile(file) {
    if (!(file instanceof File)) {
        return false;
    }

    const mimeType = String(file.type || '').toLowerCase();

    return CAPTURE_PDF_SUPPORTED_TYPES.has(mimeType) || /\.pdf$/i.test(String(file.name || ''));
}

function isSupportedCaptureImageFile(file) {
    return file instanceof File && CAPTURE_IMAGE_SUPPORTED_TYPES.has(String(file.type || '').toLowerCase());
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            resolve(typeof reader.result === 'string' ? reader.result : '');
        };

        reader.onerror = () => {
            reject(reader.error || new Error('Could not read that image.'));
        };

        reader.readAsDataURL(file);
    });
}

async function selectCaptureImage(file, controls = getCaptureImageControls()) {
    if (!(file instanceof File)) {
        setCaptureImageState({
            isDragActive: false,
            error: 'Choose an image file to continue.'
        }, controls);
        return false;
    }

    if (!isSupportedCaptureImageFile(file)) {
        setCaptureImageState({
            isDragActive: false,
            error: 'Use a PNG, JPG, or WebP image.',
            statusMessage: ''
        }, controls);
        return false;
    }

    if (file.size > CAPTURE_IMAGE_MAX_FILE_SIZE_BYTES) {
        setCaptureImageState({
            isDragActive: false,
            error: `Image must be ${formatFileSize(CAPTURE_IMAGE_MAX_FILE_SIZE_BYTES)} or smaller.`,
            statusMessage: ''
        }, controls);
        return false;
    }

    try {
        const dataUrl = await readFileAsDataUrl(file);

        setCaptureImageState({
            fileName: file.name || 'Uploaded image',
            mimeType: String(file.type || '').toLowerCase(),
            dataUrl,
            extractedText: '',
            isProcessing: false,
            isDragActive: false,
            error: '',
            statusMessage: `${file.name || 'Image'} ready. Extract text when you’re ready.`,
            requestToken: 0
        }, controls);

        return true;
    } catch (error) {
        console.error('Failed to read selected image.', error);
        setCaptureImageState({
            isDragActive: false,
            error: 'Could not read that image. Try another file.',
            statusMessage: ''
        }, controls);
        return false;
    }
}

function getBase64PayloadFromDataUrl(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);

    if (!match) {
        return '';
    }

    return match[2].trim();
}

async function requestImageTextExtraction({ dataUrl, mimeType }) {
    const imageBase64 = getBase64PayloadFromDataUrl(dataUrl);

    if (!imageBase64) {
        throw new Error('Could not prepare that image for processing.');
    }

    const response = await fetch('/api/process-image', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            imageBase64,
            mimeType
        })
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Image processing API not found. Run the app with `npm run dev` so Vercel serves `/api/process-image`.');
        }

        throw new Error(payload?.error || 'Could not extract text from that image right now.');
    }

    return typeof payload?.text === 'string' ? payload.text.trim() : '';
}

async function processCaptureImage(controls = getCaptureImageControls()) {
    if (!state.captureImage.dataUrl || state.captureImage.isProcessing) {
        return false;
    }

    const requestToken = state.captureImage.requestToken + 1;

    setCaptureImageState({
        isProcessing: true,
        error: '',
        statusMessage: '',
        requestToken
    }, controls);

    try {
        const text = await requestImageTextExtraction({
            dataUrl: state.captureImage.dataUrl,
            mimeType: state.captureImage.mimeType
        });

        if (state.captureImage.requestToken !== requestToken) {
            return false;
        }

        const hasText = Boolean(text);

        setCaptureImageState({
            isProcessing: false,
            extractedText: text,
            error: '',
            statusMessage: hasText
                ? 'Text extracted. Review it below or insert it into your note.'
                : 'No readable text found in that image.'
        }, controls);

        setFeedback(hasText ? 'Text extracted from the image.' : 'No readable text found in that image.');
        return true;
    } catch (error) {
        if (state.captureImage.requestToken !== requestToken) {
            return false;
        }

        console.error('Failed to process capture image.', error);
        setCaptureImageState({
            isProcessing: false,
            extractedText: '',
            error: error instanceof Error ? error.message : 'Could not extract text from that image right now.',
            statusMessage: ''
        }, controls);
        setFeedback('Could not extract text from that image.');
        return false;
    }
}

function insertCaptureImageText(contentInput, controls = getCaptureImageControls()) {
    const extractedText = String(state.captureImage.extractedText || '').trim();

    if (!(contentInput instanceof HTMLTextAreaElement) || !extractedText) {
        return false;
    }

    contentInput.value = mergeTranscriptIntoContent(contentInput.value, extractedText);
    contentInput.focus();
    contentInput.setSelectionRange(contentInput.value.length, contentInput.value.length);
    contentInput.dispatchEvent(new Event('input', { bubbles: true }));
    setCaptureImageState({
        error: '',
        statusMessage: 'Extracted text added to your note.'
    }, controls);
    setFeedback('Extracted text added to the note.');
    return true;
}

async function selectCapturePdf(file, controls = getCapturePdfControls()) {
    if (!(file instanceof File)) {
        setCapturePdfState({
            isDragActive: false,
            error: 'Choose a PDF file to continue.'
        }, controls);
        return false;
    }

    if (!isSupportedCapturePdfFile(file)) {
        setCapturePdfState({
            isDragActive: false,
            error: 'Use a PDF document.',
            statusMessage: ''
        }, controls);
        return false;
    }

    if (file.size > CAPTURE_PDF_MAX_FILE_SIZE_BYTES) {
        setCapturePdfState({
            isDragActive: false,
            error: `PDF must be ${formatFileSize(CAPTURE_PDF_MAX_FILE_SIZE_BYTES)} or smaller.`,
            statusMessage: ''
        }, controls);
        return false;
    }

    try {
        const dataUrl = await readFileAsDataUrl(file);

        setCapturePdfState({
            fileName: file.name || 'Uploaded PDF',
            mimeType: String(file.type || '').toLowerCase() || 'application/pdf',
            dataUrl,
            extractedText: '',
            summary: '',
            pageCount: 0,
            characterCount: 0,
            isProcessing: false,
            isDragActive: false,
            attachToNextNote: false,
            error: '',
            statusMessage: `${file.name || 'PDF'} ready. Extract text when you’re ready.`,
            requestToken: 0
        }, controls);

        return true;
    } catch (error) {
        console.error('Failed to read selected PDF.', error);
        setCapturePdfState({
            isDragActive: false,
            error: 'Could not read that PDF. Try another file.',
            statusMessage: ''
        }, controls);
        return false;
    }
}

async function requestPdfTextExtraction({ dataUrl, mimeType }) {
    const pdfBase64 = getBase64PayloadFromDataUrl(dataUrl);

    if (!pdfBase64) {
        throw new Error('Could not prepare that PDF for processing.');
    }

    const response = await fetch('/api/process-pdf', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            pdfBase64,
            mimeType
        })
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('PDF processing API not found. Run the app with `npm run dev` so Vercel serves `/api/process-pdf`.');
        }

        throw new Error(payload?.error || 'Could not extract text from that PDF right now.');
    }

    return {
        text: typeof payload?.text === 'string' ? payload.text.trim() : '',
        summary: typeof payload?.summary === 'string' ? payload.summary.trim() : '',
        pageCount: Number.isFinite(Number(payload?.pageCount))
            ? Math.max(0, Math.round(Number(payload.pageCount)))
            : 0
    };
}

async function processCapturePdf(controls = getCapturePdfControls()) {
    if (!state.capturePdf.dataUrl || state.capturePdf.isProcessing) {
        return false;
    }

    const requestToken = state.capturePdf.requestToken + 1;

    setCapturePdfState({
        isProcessing: true,
        error: '',
        statusMessage: '',
        requestToken
    }, controls);

    try {
        const { text, summary, pageCount } = await requestPdfTextExtraction({
            dataUrl: state.capturePdf.dataUrl,
            mimeType: state.capturePdf.mimeType
        });

        if (state.capturePdf.requestToken !== requestToken) {
            return false;
        }

        const hasText = Boolean(text);
        const hasSummary = Boolean(summary);

        setCapturePdfState({
            isProcessing: false,
            extractedText: text,
            summary,
            pageCount,
            characterCount: text.length,
            error: '',
            statusMessage: hasText
                ? hasSummary
                    ? 'Text extracted and summarized. Review it below or insert it into your note.'
                    : 'Text extracted. Review it below or insert it into your note.'
                : 'No readable text found in that PDF.'
        }, controls);

        if (hasText && hasSummary) {
            setFeedback('PDF processed and summarized.');
        } else if (hasText) {
            setFeedback('Text extracted from the PDF.');
        } else {
            setFeedback('No readable text found in that PDF.');
        }

        return true;
    } catch (error) {
        if (state.capturePdf.requestToken !== requestToken) {
            return false;
        }

        console.error('Failed to process capture PDF.', error);
        setCapturePdfState({
            isProcessing: false,
            extractedText: '',
            summary: '',
            pageCount: 0,
            characterCount: 0,
            attachToNextNote: false,
            error: error instanceof Error ? error.message : 'Could not extract text from that PDF right now.',
            statusMessage: ''
        }, controls);
        setFeedback('Could not extract text from that PDF.');
        return false;
    }
}

function insertCapturePdfText(contentInput, controls = getCapturePdfControls()) {
    const extractedText = String(state.capturePdf.extractedText || '').trim();

    if (!(contentInput instanceof HTMLTextAreaElement) || !extractedText) {
        return false;
    }

    contentInput.value = mergeTranscriptIntoContent(contentInput.value, extractedText);
    contentInput.focus();
    contentInput.setSelectionRange(contentInput.value.length, contentInput.value.length);
    contentInput.dispatchEvent(new Event('input', { bubbles: true }));
    setCapturePdfState({
        attachToNextNote: true,
        error: '',
        statusMessage: state.capturePdf.summary
            ? 'Extracted PDF text and summary are ready for this note.'
            : 'Extracted PDF text added to your note.'
    }, controls);
    setFeedback(state.capturePdf.summary ? 'PDF text inserted. The extracted summary will be saved with the note.' : 'Extracted PDF text added to the note.');
    return true;
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
    graphCanvasController.refresh();
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
    const insights = normalizeInsights(note.insights);
    const sourceDocument = normalizeSourceDocument(note.sourceDocument);
    const revisit = normalizeRevisitState(note.revisit);

    return {
        id: '',
        type,
        content,
        url,
        favicon,
        title,
        summary,
        insights,
        tags,
        autoTags,
        sourceDocument,
        revisit,
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

function limitTextLength(value, maxLength) {
    const text = String(value || '').trim();

    if (!text || text.length <= maxLength) {
        return text;
    }

    return text.slice(0, maxLength).trimEnd();
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

function formatCalendarDate(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric'
    }).format(date);
}

function formatRevisitDueLabel(suggestion = {}) {
    if (suggestion.status === 'overdue') {
        return suggestion.daysOverdue <= 1
            ? 'Overdue by 1 day'
            : `Overdue by ${suggestion.daysOverdue} days`;
    }

    if (suggestion.status === 'today') {
        return 'Due today';
    }

    if (suggestion.daysUntilDue === 1) {
        return 'Due tomorrow';
    }

    return suggestion.dueAt
        ? `Due ${formatCalendarDate(suggestion.dueAt)}`
        : 'Coming up';
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

function formatTimelineDayHeader(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return 'Recent';
    }

    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((startOfToday - startOfDate) / 86_400_000);

    if (diffDays === 0) {
        return 'Today';
    }

    if (diffDays === 1) {
        return 'Yesterday';
    }

    return new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date);
}

function formatTimelineDayMeta(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(date);
}

function formatTimelineWeekHeader(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return 'Earlier';
    }

    return `Week of ${new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric'
    }).format(date)}`;
}

function formatTimelineWeekMeta(startDateValue, endDateValue) {
    const startDate = new Date(startDateValue);
    const endDate = new Date(endDateValue);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return '';
    }

    const sameYear = startDate.getFullYear() === endDate.getFullYear();
    const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();
    const startText = new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric'
    }).format(startDate);
    const endText = new Intl.DateTimeFormat('en', sameMonth
        ? { day: 'numeric', year: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' }
    ).format(endDate);

    return `${startText} - ${endText}`;
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

function normalizeInsights(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    const insights = [];
    const seen = new Set();

    value.forEach((entry) => {
        if (typeof entry !== 'string') {
            return;
        }

        const insight = entry.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim();
        const normalizedInsight = insight.toLowerCase();

        if (!insight || seen.has(normalizedInsight) || insights.length >= 3) {
            return;
        }

        seen.add(normalizedInsight);
        insights.push(insight);
    });

    return insights;
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getValidTimestamp(dateValue) {
    const timestamp = new Date(dateValue).getTime();

    return Number.isNaN(timestamp) ? Number.NaN : timestamp;
}

function getUtcDateKey(dateValue) {
    const timestamp = getValidTimestamp(dateValue);

    if (!Number.isFinite(timestamp)) {
        return '';
    }

    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function getUtcWeekKey(dateKey) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) {
        return '';
    }

    const date = new Date(`${dateKey}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const day = date.getUTCDay() || 7;

    date.setUTCDate(date.getUTCDate() - day + 1);
    return getUtcDateKey(date.toISOString());
}

function normalizeKnowledgeHealthToken(token) {
    const normalizedToken = String(token || '').toLowerCase();

    if (normalizedToken.length > 4 && normalizedToken.endsWith('ies')) {
        return `${normalizedToken.slice(0, -3)}y`;
    }

    if (normalizedToken.length > 5 && normalizedToken.endsWith('ing')) {
        return normalizedToken.slice(0, -3);
    }

    if (normalizedToken.length > 4 && normalizedToken.endsWith('ed')) {
        return normalizedToken.slice(0, -2);
    }

    if (normalizedToken.length > 4 && normalizedToken.endsWith('es')) {
        return normalizedToken.slice(0, -2);
    }

    if (normalizedToken.length > 3 && normalizedToken.endsWith('s')) {
        return normalizedToken.slice(0, -1);
    }

    return normalizedToken;
}

function tokenizeKnowledgeHealthText(value, limit = Number.POSITIVE_INFINITY) {
    const matches = String(value || '').toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || [];
    const tokens = [];
    const seen = new Set();

    matches.forEach((token) => {
        if (tokens.length >= limit) {
            return;
        }

        const normalizedToken = normalizeKnowledgeHealthToken(token);

        if (normalizedToken.length <= 2 || KNOWLEDGE_HEALTH_STOP_WORDS.has(normalizedToken) || seen.has(normalizedToken)) {
            return;
        }

        seen.add(normalizedToken);
        tokens.push(normalizedToken);
    });

    return tokens;
}

function getNoteActivityTimestamps(note = {}) {
    const revisit = normalizeRevisitState(note.revisit);
    const timestamps = new Set();
    const dateValues = [
        note.createdAt,
        revisit.lastViewedAt,
        revisit.lastReviewedAt,
        ...revisit.viewHistory,
        ...revisit.reviewHistory
    ];

    dateValues.forEach((dateValue) => {
        const timestamp = getValidTimestamp(dateValue);

        if (Number.isFinite(timestamp)) {
            timestamps.add(timestamp);
        }
    });

    return [...timestamps].sort((left, right) => left - right);
}

function collectKnowledgeHealthTopics(note = {}) {
    const topics = new Set(normalizeTags(note.tags));
    const addTokens = (value, limit) => {
        tokenizeKnowledgeHealthText(value, limit).forEach((token) => topics.add(token));
    };

    addTokens(note.title, 3);
    addTokens(note.summary, 4);
    addTokens(note.content, 6);
    normalizeInsights(note.insights).forEach((insight) => addTokens(insight, 2));

    return topics;
}

function getKnowledgeHealthTone(score) {
    if (score >= 80) {
        return 'strong';
    }

    if (score >= 55) {
        return 'steady';
    }

    return 'growing';
}

function getKnowledgeHealthSummary(score, noteCount, weakestFactor) {
    if (!noteCount) {
        return {
            title: 'Ready to build',
            message: 'Save a few notes and this score will start climbing quickly.'
        };
    }

    if (score >= 85) {
        return {
            title: 'Excellent shape',
            message: `Your library feels fresh, detailed, and reusable. Keep ${weakestFactor.toLowerCase()} moving and it stays that way.`
        };
    }

    if (score >= 70) {
        return {
            title: 'Healthy momentum',
            message: `You already have a strong base. A few small upgrades to ${weakestFactor.toLowerCase()} will make recall even easier.`
        };
    }

    if (score >= 50) {
        return {
            title: 'Solid foundation',
            message: `The hub is starting to hold together well. Strengthening ${weakestFactor.toLowerCase()} should lift the score fast.`
        };
    }

    if (score >= 30) {
        return {
            title: 'Growing steadily',
            message: `There is real material here already. A bit more structure around ${weakestFactor.toLowerCase()} will compound quickly.`
        };
    }

    return {
        title: 'Just getting started',
        message: 'A few richer, better-linked notes will move this score faster than it looks.'
    };
}

function buildKnowledgeHealthSuggestions(factors, noteCount) {
    if (!noteCount) {
        return [
            {
                key: 'recency',
                title: 'Save the first spark',
                message: 'Capture one idea, article, or observation today so the score has something to build on.'
            },
            {
                key: 'depth',
                title: 'Write one layer deeper',
                message: 'A short summary or two concrete takeaways makes the first notes far more reusable.'
            },
            {
                key: 'connections',
                title: 'Start a tag trail',
                message: 'Use a couple of simple tags from the start so related notes can connect as the hub grows.'
            }
        ];
    }

    const suggestionCopy = {
        recency: {
            title: 'Refresh the library',
            message: 'Capture one small note or link today. Fresh activity lifts the score quickly.'
        },
        consistency: {
            title: 'Spread learning across the week',
            message: 'A few separate capture days beat one large batch when you want ideas to stay warm.'
        },
        diversity: {
            title: 'Widen the topic mix',
            message: 'Add notes from a couple of different themes so the hub becomes a broader map of what you know.'
        },
        depth: {
            title: 'Go one layer deeper',
            message: 'Turn thin captures into reusable knowledge with a short summary or a few key insights.'
        },
        connections: {
            title: 'Link related ideas',
            message: 'Reuse tags across neighboring notes so patterns, clusters, and revisit prompts get smarter.'
        }
    };

    return [...factors]
        .sort((left, right) => left.score - right.score)
        .slice(0, KNOWLEDGE_HEALTH_MAX_SUGGESTIONS)
        .map((factor) => ({
            key: factor.key,
            ...suggestionCopy[factor.key]
        }));
}

function calculateKnowledgeHealth(notes = []) {
    const normalizedNotes = (Array.isArray(notes) ? notes : []).filter((note) => note && typeof note === 'object');
    const noteCount = normalizedNotes.length;
    const allActivityTimestamps = normalizedNotes
        .flatMap((note) => getNoteActivityTimestamps(note))
        .sort((left, right) => left - right);
    const latestActivityTimestamp = allActivityTimestamps.at(-1) || 0;
    const daysSinceLatestActivity = latestActivityTimestamp
        ? Math.max(0, Math.floor((Date.now() - latestActivityTimestamp) / KNOWLEDGE_HEALTH_DAY_IN_MS))
        : Number.POSITIVE_INFINITY;
    let recencyScore = 0;

    if (noteCount > 0) {
        if (daysSinceLatestActivity <= 1) {
            recencyScore = 100;
        } else if (daysSinceLatestActivity <= 3) {
            recencyScore = 92;
        } else if (daysSinceLatestActivity <= 7) {
            recencyScore = 82;
        } else if (daysSinceLatestActivity <= 14) {
            recencyScore = 68;
        } else if (daysSinceLatestActivity <= 30) {
            recencyScore = 54;
        } else if (daysSinceLatestActivity <= 60) {
            recencyScore = 38;
        } else {
            recencyScore = 22;
        }
    }

    const nowTimestamp = Date.now();
    const recentCutoffTimestamp = nowTimestamp - ((KNOWLEDGE_HEALTH_ACTIVITY_WINDOW_DAYS - 1) * KNOWLEDGE_HEALTH_DAY_IN_MS);
    const recentActivityDayKeys = [...new Set(
        allActivityTimestamps
            .filter((timestamp) => timestamp >= recentCutoffTimestamp)
            .map((timestamp) => getUtcDateKey(new Date(timestamp).toISOString()))
            .filter(Boolean)
    )].sort((left, right) => left.localeCompare(right));
    const activeWeeks = new Set(recentActivityDayKeys.map((dateKey) => getUtcWeekKey(dateKey)).filter(Boolean));
    let activeStreak = 0;

    if (recentActivityDayKeys.length) {
        const today = new Date();
        const startOfTodayUtc = Date.UTC(
            today.getUTCFullYear(),
            today.getUTCMonth(),
            today.getUTCDate()
        );
        const latestActivityDay = recentActivityDayKeys.at(-1) || '';
        const latestActivityDayTimestamp = latestActivityDay
            ? new Date(`${latestActivityDay}T00:00:00.000Z`).getTime()
            : Number.NaN;
        const latestGapDays = Number.isFinite(latestActivityDayTimestamp)
            ? Math.round((startOfTodayUtc - latestActivityDayTimestamp) / KNOWLEDGE_HEALTH_DAY_IN_MS)
            : Number.POSITIVE_INFINITY;

        if (latestGapDays <= 1) {
            activeStreak = 1;

            for (let index = recentActivityDayKeys.length - 1; index > 0; index -= 1) {
                const currentTimestamp = new Date(`${recentActivityDayKeys[index]}T00:00:00.000Z`).getTime();
                const previousTimestamp = new Date(`${recentActivityDayKeys[index - 1]}T00:00:00.000Z`).getTime();

                if (Math.round((currentTimestamp - previousTimestamp) / KNOWLEDGE_HEALTH_DAY_IN_MS) !== 1) {
                    break;
                }

                activeStreak += 1;
            }
        }
    }

    const consistencyScore = noteCount > 0
        ? Math.round(clampNumber(
            ((recentActivityDayKeys.length / 12) * 60)
                + ((activeWeeks.size / 4) * 25)
                + ((Math.min(activeStreak, 7) / 7) * 15),
            0,
            100
        ))
        : 0;
    const noteTopicSets = normalizedNotes.map((note) => collectKnowledgeHealthTopics(note));
    const topicNoteCounts = noteTopicSets.reduce((topicMap, topicSet) => {
        topicSet.forEach((topic) => {
            topicMap.set(topic, (topicMap.get(topic) || 0) + 1);
        });

        return topicMap;
    }, new Map());
    const diversityTopicCounts = [...topicNoteCounts.values()].filter((value) => Number.isFinite(value) && value > 0);
    const uniqueTopics = diversityTopicCounts.length;
    let diversityScore = 0;
    let diversityLabel = 'Narrow';

    if (uniqueTopics === 1) {
        diversityScore = 14;
    } else if (uniqueTopics > 1) {
        const totalWeight = diversityTopicCounts.reduce((sum, value) => sum + value, 0);
        const entropy = diversityTopicCounts.reduce((sum, value) => {
            const probability = value / totalWeight;

            return sum - (probability * Math.log(probability));
        }, 0);
        const normalizedEntropy = entropy / Math.log(uniqueTopics);
        const breadth = Math.min(1, uniqueTopics / 12);

        diversityScore = Math.round(((normalizedEntropy * 0.65) + (breadth * 0.35)) * 100);
    }

    if (diversityScore >= 72) {
        diversityLabel = 'Broad';
    } else if (diversityScore >= 42) {
        diversityLabel = 'Balanced';
    } else {
        diversityLabel = 'Focused';
    }

    const richnessScores = normalizedNotes.map((note) => {
        const contentLength = String(note.content || '').trim().length;
        const summaryLength = String(note.summary || '').trim().length;
        const insightsCount = normalizeInsights(note.insights).length;
        const tagCount = normalizeTags(note.tags).length;
        const sourceDocument = normalizeSourceDocument(note.sourceDocument);
        const hasSourceContext = Boolean(note.url || sourceDocument);

        return clampNumber(
            (Math.min(contentLength, 480) / 480) * 0.55
                + (summaryLength > 0 ? 0.16 : 0)
                + ((Math.min(insightsCount, 3) / 3) * 0.14)
                + ((Math.min(tagCount, 4) / 4) * 0.1)
                + (hasSourceContext ? 0.05 : 0),
            0,
            1
        );
    });
    const averageRichness = richnessScores.length
        ? richnessScores.reduce((sum, value) => sum + value, 0) / richnessScores.length
        : 0;
    const substantiveNotes = richnessScores.filter((value) => value >= 0.6).length;
    const depthScore = Math.round(averageRichness * 100);
    const connectedNotes = new Set();
    let connectedPairs = 0;
    let sharedTopicStrength = 0;

    for (let leftIndex = 0; leftIndex < noteTopicSets.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < noteTopicSets.length; rightIndex += 1) {
            let overlapCount = 0;

            noteTopicSets[leftIndex].forEach((topic) => {
                if (noteTopicSets[rightIndex].has(topic)) {
                    overlapCount += 1;
                }
            });

            if (!overlapCount) {
                continue;
            }

            connectedPairs += 1;
            sharedTopicStrength += Math.min(overlapCount, 4);
            connectedNotes.add(leftIndex);
            connectedNotes.add(rightIndex);
        }
    }

    const possiblePairs = noteCount > 1 ? (noteCount * (noteCount - 1)) / 2 : 0;
    const connectionCoverage = noteCount > 0 ? connectedNotes.size / noteCount : 0;
    const connectionDensity = possiblePairs > 0 ? connectedPairs / possiblePairs : 0;
    const connectionStrength = connectedPairs > 0 ? Math.min(1, sharedTopicStrength / (connectedPairs * 2.2)) : 0;
    const connectionsScore = noteCount <= 1
        ? (noteCount === 1 ? 24 : 0)
        : Math.round(((connectionCoverage * 0.5) + (connectionDensity * 0.3) + (connectionStrength * 0.2)) * 100);
    const factors = [
        {
            key: 'recency',
            label: 'Recency',
            score: recencyScore,
            meta: latestActivityTimestamp
                ? `Last activity ${formatRelativeTime(new Date(latestActivityTimestamp).toISOString())}.`
                : 'No recent activity yet.'
        },
        {
            key: 'consistency',
            label: 'Consistency',
            score: consistencyScore,
            meta: recentActivityDayKeys.length
                ? `${formatCountLabel(recentActivityDayKeys.length, 'active day')} across ${formatCountLabel(activeWeeks.size, 'week')} lately.`
                : 'No learning rhythm yet.'
        },
        {
            key: 'diversity',
            label: 'Diversity',
            score: diversityScore,
            meta: uniqueTopics
                ? `${diversityLabel} spread across ${formatCountLabel(uniqueTopics, 'theme')}.`
                : 'Themes will emerge as you save more notes.'
        },
        {
            key: 'depth',
            label: 'Depth',
            score: depthScore,
            meta: noteCount
                ? `${formatCountLabel(substantiveNotes, 'note')} already carry strong detail or summaries.`
                : 'Add more detail to build reuse.'
        },
        {
            key: 'connections',
            label: 'Connections',
            score: connectionsScore,
            meta: connectedPairs
                ? `${formatCountLabel(connectedNotes.size, 'note')} already link through shared themes.`
                : 'Related tags will help ideas start connecting.'
        }
    ];
    const overallScore = Math.round(
        (recencyScore * 0.23)
        + (consistencyScore * 0.22)
        + (diversityScore * 0.2)
        + (depthScore * 0.18)
        + (connectionsScore * 0.17)
    );
    const weakestFactor = [...factors].sort((left, right) => left.score - right.score)[0] || factors[0];
    const summary = getKnowledgeHealthSummary(overallScore, noteCount, weakestFactor?.label || 'coverage');

    return {
        score: overallScore,
        tone: getKnowledgeHealthTone(overallScore),
        title: summary.title,
        message: summary.message,
        factors,
        suggestions: buildKnowledgeHealthSuggestions(factors, noteCount)
    };
}

function normalizeSourceDocument(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const kind = value.kind === 'pdf' ? 'pdf' : '';
    const fileName = typeof value.fileName === 'string' ? value.fileName.trim() : '';
    const pageCount = Number.isFinite(Number(value.pageCount))
        ? Math.max(0, Math.round(Number(value.pageCount)))
        : 0;
    const characterCount = Number.isFinite(Number(value.characterCount))
        ? Math.max(0, Math.round(Number(value.characterCount)))
        : 0;

    if (!kind || (!fileName && pageCount <= 0 && characterCount <= 0)) {
        return null;
    }

    return {
        kind,
        fileName,
        pageCount,
        characterCount
    };
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

function createClusterFingerprint(notes = []) {
    return (Array.isArray(notes) ? notes : [])
        .map((note) => {
            const noteId = note?.id ? String(note.id) : '';
            const tags = Array.isArray(note?.tags)
                ? [...note.tags].sort((left, right) => left.localeCompare(right)).join('|')
                : '';

            return noteId ? `${noteId}:${tags}` : '';
        })
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .join('||');
}

function createPatternAnalysisFingerprint(notes = []) {
    return (Array.isArray(notes) ? notes : [])
        .map((note) => {
            const noteId = note?.id ? String(note.id) : '';
            const updatedAt = typeof note?.updatedAt === 'string' ? note.updatedAt : '';
            const createdAt = typeof note?.createdAt === 'string' ? note.createdAt : '';
            const tags = Array.isArray(note?.tags)
                ? [...note.tags].sort((left, right) => left.localeCompare(right)).join('|')
                : '';

            return noteId ? `${noteId}:${updatedAt}:${createdAt}:${tags}` : '';
        })
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .join('||');
}

function normalizeClusterData(payload, notes = []) {
    if (!payload || typeof payload !== 'object') {
        return clusterNotesByOverlappingTags(notes);
    }

    const clusters = Array.isArray(payload.clusters) ? payload.clusters : null;
    const noteClusterMap = payload.noteClusterMap && typeof payload.noteClusterMap === 'object'
        ? payload.noteClusterMap
        : null;

    if (!clusters || !noteClusterMap) {
        return clusterNotesByOverlappingTags(notes);
    }

    return {
        clusterCount: Number.isFinite(payload.clusterCount) ? Number(payload.clusterCount) : clusters.length,
        clusters,
        noteClusterMap
    };
}

function getClusterById(clusterId, clusterData = state.clusterData) {
    if (!clusterId) {
        return null;
    }

    return clusterData.clusters.find((cluster) => cluster.id === clusterId) || null;
}

function getClusterForNote(noteId, clusterData = state.clusterData) {
    const clusterId = clusterData.noteClusterMap[String(noteId || '')];

    return getClusterById(clusterId, clusterData);
}

function getClusterColor(cluster) {
    const colorIndex = Number(cluster?.colorIndex) || 0;
    const hue = CLUSTER_COLOR_HUES[colorIndex % CLUSTER_COLOR_HUES.length];
    const saturation = cluster?.label === UNTAGGED_FILTER_LABEL ? '10%' : '62%';
    const lightness = state.activeTheme === 'dark' ? '68%' : '45%';

    return `hsl(${hue} ${saturation} ${lightness})`;
}

function setClusterTone(cluster, element) {
    element.style.setProperty('--cluster-color', getClusterColor(cluster));
}

function formatClusterLabel(cluster) {
    const label = String(cluster?.label || UNTAGGED_FILTER_LABEL).trim();

    if (!label) {
        return 'Untagged';
    }

    return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
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

function normalizePatternAnalysis(payload) {
    if (!payload || typeof payload !== 'object') {
        return createEmptyPatternAnalysis();
    }

    const topTopics = Array.isArray(payload.topTopics)
        ? payload.topTopics
            .map((entry) => ({
                topic: typeof entry?.topic === 'string' ? entry.topic.trim() : '',
                count: Number.isFinite(Number(entry?.count))
                    ? Math.max(0, Math.round(Number(entry.count)))
                    : 0,
                score: Number.isFinite(Number(entry?.score))
                    ? Number(Number(entry.score).toFixed(2))
                    : 0,
                share: Number.isFinite(Number(entry?.share))
                    ? Math.max(0, Math.min(100, Math.round(Number(entry.share))))
                    : 0
            }))
            .filter((entry) => entry.topic)
            .slice(0, 5)
        : [];
    const learningStreak = payload.learningStreak && typeof payload.learningStreak === 'object'
        ? {
            current: Number.isFinite(Number(payload.learningStreak.current))
                ? Math.max(0, Math.round(Number(payload.learningStreak.current)))
                : 0,
            longest: Number.isFinite(Number(payload.learningStreak.longest))
                ? Math.max(0, Math.round(Number(payload.learningStreak.longest)))
                : 0,
            activeDays: Number.isFinite(Number(payload.learningStreak.activeDays))
                ? Math.max(0, Math.round(Number(payload.learningStreak.activeDays)))
                : 0,
            lastActiveDate: typeof payload.learningStreak.lastActiveDate === 'string'
                ? payload.learningStreak.lastActiveDate
                : ''
        }
        : createEmptyPatternAnalysis().learningStreak;
    const weeklyTrend = payload.weeklyTrend && typeof payload.weeklyTrend === 'object'
        ? {
            days: Array.isArray(payload.weeklyTrend.days)
                ? payload.weeklyTrend.days
                    .map((entry) => ({
                        date: typeof entry?.date === 'string' ? entry.date : '',
                        label: typeof entry?.label === 'string' ? entry.label : '',
                        count: Number.isFinite(Number(entry?.count))
                            ? Math.max(0, Math.round(Number(entry.count)))
                            : 0
                    }))
                    .filter((entry) => entry.date)
                    .slice(0, 7)
                : [],
            currentTotal: Number.isFinite(Number(payload.weeklyTrend.currentTotal))
                ? Math.max(0, Math.round(Number(payload.weeklyTrend.currentTotal)))
                : 0,
            previousTotal: Number.isFinite(Number(payload.weeklyTrend.previousTotal))
                ? Math.max(0, Math.round(Number(payload.weeklyTrend.previousTotal)))
                : 0,
            delta: Number.isFinite(Number(payload.weeklyTrend.delta))
                ? Math.round(Number(payload.weeklyTrend.delta))
                : 0,
            direction: payload.weeklyTrend.direction === 'up' || payload.weeklyTrend.direction === 'down'
                ? payload.weeklyTrend.direction
                : 'steady'
        }
        : createEmptyPatternAnalysis().weeklyTrend;
    const diversityScore = payload.diversityScore && typeof payload.diversityScore === 'object'
        ? {
            score: Number.isFinite(Number(payload.diversityScore.score))
                ? Math.max(0, Math.min(100, Math.round(Number(payload.diversityScore.score))))
                : 0,
            label: typeof payload.diversityScore.label === 'string' && payload.diversityScore.label.trim()
                ? payload.diversityScore.label.trim()
                : 'Narrow',
            uniqueTopics: Number.isFinite(Number(payload.diversityScore.uniqueTopics))
                ? Math.max(0, Math.round(Number(payload.diversityScore.uniqueTopics)))
                : 0
        }
        : createEmptyPatternAnalysis().diversityScore;

    return {
        topTopics,
        learningStreak,
        weeklyTrend,
        diversityScore
    };
}

function formatTrendDirection(direction) {
    if (direction === 'up') {
        return 'Rising';
    }

    if (direction === 'down') {
        return 'Cooling';
    }

    return 'Steady';
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

function buildCapturePdfNotePatch() {
    if (!state.capturePdf.attachToNextNote || !state.capturePdf.extractedText) {
        return null;
    }

    const title = String(state.capturePdf.fileName || '')
        .replace(/\.pdf$/i, '')
        .trim();

    return {
        title: title || undefined,
        summary: state.capturePdf.summary || '',
        sourceDocument: {
            kind: 'pdf',
            fileName: state.capturePdf.fileName,
            pageCount: state.capturePdf.pageCount,
            characterCount: state.capturePdf.characterCount
        }
    };
}

function buildNoteSearchText(note = {}) {
    return [
        note.title,
        note.content,
        note.summary,
        note.url,
        note.sourceDocument?.fileName,
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

class GraphBuilder {
    build(notes = []) {
        const preparedNodes = this.prepareNodes(notes);

        return {
            nodes: preparedNodes.map(({ note }) => note),
            edges: this.createEdges(preparedNodes)
        };
    }

    prepareNodes(notes = []) {
        return (Array.isArray(notes) ? notes : [])
            .map((note) => this.prepareNode(note))
            .filter(Boolean);
    }

    prepareNode(note = {}) {
        const normalizedNote = createNoteModel(note, {
            id: note?.id ? String(note.id) : '',
            createdAt: note?.createdAt || new Date().toISOString(),
            updatedAt: note?.updatedAt || note?.createdAt || new Date().toISOString()
        });

        if (!normalizedNote?.id) {
            return null;
        }

        const textVector = this.createTextVector(normalizedNote);

        return {
            note: normalizedNote,
            tagSet: new Set(normalizedNote.tags),
            textVector,
            textMagnitude: this.calculateVectorMagnitude(textVector)
        };
    }

    createEdges(nodes = []) {
        const edges = [];

        for (let sourceIndex = 0; sourceIndex < nodes.length; sourceIndex += 1) {
            for (let targetIndex = sourceIndex + 1; targetIndex < nodes.length; targetIndex += 1) {
                const edge = this.createEdge(nodes[sourceIndex], nodes[targetIndex]);

                if (edge) {
                    edges.push(edge);
                }
            }
        }

        return edges;
    }

    createEdge(sourceNode, targetNode) {
        if (!sourceNode?.note?.id || !targetNode?.note?.id) {
            return null;
        }

        const tagWeight = this.calculateTagWeight(sourceNode, targetNode);
        const similarityWeight = this.calculateSemanticSimilarity(sourceNode, targetNode);

        if (!tagWeight && similarityWeight < GRAPH_MIN_SIMILARITY_SCORE) {
            return null;
        }

        const weight = this.roundWeight(
            (tagWeight * GRAPH_TAG_WEIGHT_SHARE) + (similarityWeight * GRAPH_SIMILARITY_WEIGHT_SHARE)
        );

        if (weight < GRAPH_MIN_EDGE_WEIGHT) {
            return null;
        }

        return {
            source: sourceNode.note.id,
            target: targetNode.note.id,
            weight
        };
    }

    calculateTagWeight(sourceNode, targetNode) {
        const sourceTags = sourceNode?.tagSet || new Set();
        const targetTags = targetNode?.tagSet || new Set();

        if (!sourceTags.size || !targetTags.size) {
            return 0;
        }

        let sharedTagCount = 0;

        sourceTags.forEach((tag) => {
            if (targetTags.has(tag)) {
                sharedTagCount += 1;
            }
        });

        if (!sharedTagCount) {
            return 0;
        }

        const denominator = Math.sqrt(sourceTags.size * targetTags.size);

        return Math.min(1, sharedTagCount / denominator);
    }

    calculateSemanticSimilarity(sourceNode, targetNode) {
        const sourceMagnitude = Number(sourceNode?.textMagnitude) || 0;
        const targetMagnitude = Number(targetNode?.textMagnitude) || 0;

        if (!sourceMagnitude || !targetMagnitude) {
            return 0;
        }

        const sourceVector = sourceNode?.textVector;
        const targetVector = targetNode?.textVector;
        const smallerVector = sourceVector.size <= targetVector.size ? sourceVector : targetVector;
        const largerVector = smallerVector === sourceVector ? targetVector : sourceVector;
        let dotProduct = 0;

        smallerVector.forEach((value, token) => {
            if (largerVector.has(token)) {
                dotProduct += value * largerVector.get(token);
            }
        });

        return Math.min(1, dotProduct / (sourceMagnitude * targetMagnitude));
    }

    createTextVector(note = {}) {
        const vector = new Map();

        this.addTokens(vector, note.title, 3);
        this.addTokens(vector, note.summary, 2.4);
        this.addTokens(vector, Array.isArray(note.insights) ? note.insights.join(' ') : '', 2);
        this.addTokens(vector, limitTextLength(note.content, GRAPH_TEXT_FIELD_MAX_LENGTH), 1.6);
        this.addTokens(vector, this.extractUrlText(note.url), 1);

        return vector;
    }

    addTokens(vector, value, weight) {
        this.tokenize(value).forEach((token) => {
            vector.set(token, (vector.get(token) || 0) + weight);
        });
    }

    tokenize(value) {
        const matches = String(value || '').toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || [];

        return matches
            .map((token) => this.normalizeToken(token))
            .filter((token) => token.length > 1 && !GRAPH_STOP_WORDS.has(token));
    }

    normalizeToken(token) {
        if (token.length > 4 && token.endsWith('ies')) {
            return `${token.slice(0, -3)}y`;
        }

        if (token.length > 5 && token.endsWith('ing')) {
            return token.slice(0, -3);
        }

        if (token.length > 4 && token.endsWith('ed')) {
            return token.slice(0, -2);
        }

        if (token.length > 4 && token.endsWith('es')) {
            return token.slice(0, -2);
        }

        if (token.length > 3 && token.endsWith('s')) {
            return token.slice(0, -1);
        }

        return token;
    }

    extractUrlText(url) {
        const trimmedUrl = String(url || '').trim();

        if (!trimmedUrl) {
            return '';
        }

        try {
            const parsedUrl = new URL(trimmedUrl);

            return `${parsedUrl.hostname} ${parsedUrl.pathname}`.replace(/[./_-]+/g, ' ');
        } catch (error) {
            return trimmedUrl;
        }
    }

    calculateVectorMagnitude(vector) {
        let total = 0;

        vector.forEach((value) => {
            total += value * value;
        });

        return Math.sqrt(total);
    }

    roundWeight(value) {
        return Number(value.toFixed(4));
    }
}

window.GraphBuilder = GraphBuilder;
const graphBuilder = new GraphBuilder();

class GraphCanvasController {
    constructor({ onSelect } = {}) {
        this.canvas = null;
        this.context = null;
        this.resizeObserver = null;
        this.onSelect = typeof onSelect === 'function' ? onSelect : () => {};
        this.nodes = [];
        this.edges = [];
        this.nodeMap = new Map();
        this.selectedNoteId = '';
        this.hoveredNoteId = '';
        this.draggedNode = null;
        this.dragPointerOffset = { x: 0, y: 0 };
        this.isPanning = false;
        this.panOrigin = { x: 0, y: 0 };
        this.panStart = { x: 0, y: 0 };
        this.pointerDownNodeId = '';
        this.pointerDownPosition = { x: 0, y: 0 };
        this.didPointerMove = false;
        this.frameId = 0;
        this.shouldAnimate = false;
        this.isActive = false;
        this.width = 0;
        this.height = 0;
        this.dpr = window.devicePixelRatio || 1;
        this.transform = {
            x: 0,
            y: 0,
            scale: 1
        };

        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handlePointerLeave = this.handlePointerLeave.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
        this.handleResize = this.handleResize.bind(this);
        this.animate = this.animate.bind(this);
    }

    mount(canvas) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            this.unmount();
            return;
        }

        if (this.canvas === canvas) {
            this.handleResize();
            return;
        }

        this.unmount();
        this.canvas = canvas;
        this.context = canvas.getContext('2d');

        if (!this.context) {
            return;
        }

        this.canvas.addEventListener('pointerdown', this.handlePointerDown);
        this.canvas.addEventListener('pointermove', this.handlePointerMove);
        this.canvas.addEventListener('pointerup', this.handlePointerUp);
        this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
        this.canvas.addEventListener('pointercancel', this.handlePointerLeave);
        this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });

        if ('ResizeObserver' in window) {
            this.resizeObserver = new ResizeObserver(() => {
                this.handleResize();
            });
            this.resizeObserver.observe(this.canvas);
        } else {
            window.addEventListener('resize', this.handleResize);
        }

        this.handleResize();
    }

    unmount() {
        if (this.canvas) {
            this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
            this.canvas.removeEventListener('pointermove', this.handlePointerMove);
            this.canvas.removeEventListener('pointerup', this.handlePointerUp);
            this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
            this.canvas.removeEventListener('pointercancel', this.handlePointerLeave);
            this.canvas.removeEventListener('wheel', this.handleWheel);
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        } else {
            window.removeEventListener('resize', this.handleResize);
        }

        if (this.frameId) {
            window.cancelAnimationFrame(this.frameId);
            this.frameId = 0;
        }

        this.canvas = null;
        this.context = null;
        this.draggedNode = null;
        this.isPanning = false;
    }

    setData(graphData = {}) {
        const nextNodes = Array.isArray(graphData.nodes) ? graphData.nodes : [];
        const nextEdges = Array.isArray(graphData.edges) ? graphData.edges : [];
        const previousNodes = this.nodeMap;
        const radius = Math.min(this.width, this.height) * 0.28 || 160;
        const count = Math.max(nextNodes.length, 1);
        const nodeMap = new Map();
        const degreeById = nextEdges.reduce((degrees, edge) => {
            degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
            degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
            return degrees;
        }, new Map());

        this.nodes = nextNodes.map((note, index) => {
            const existingNode = previousNodes.get(note.id);
            const angle = (Math.PI * 2 * index) / count;
            const degree = degreeById.get(note.id) || 0;
            const nextNode = {
                id: note.id,
                note,
                x: existingNode?.x ?? Math.cos(angle) * radius,
                y: existingNode?.y ?? Math.sin(angle) * radius,
                vx: existingNode?.vx ?? 0,
                vy: existingNode?.vy ?? 0,
                radius: 16 + Math.min(degree * 2.1, 14),
                mass: 1 + Math.min(degree * 0.16, 1.6)
            };

            nodeMap.set(nextNode.id, nextNode);
            return nextNode;
        });

        this.nodeMap = nodeMap;
        this.edges = nextEdges
            .map((edge) => {
                const sourceNode = nodeMap.get(edge.source);
                const targetNode = nodeMap.get(edge.target);

                if (!sourceNode || !targetNode) {
                    return null;
                }

                return {
                    ...edge,
                    sourceNode,
                    targetNode
                };
            })
            .filter(Boolean);

        if (this.selectedNoteId && !this.nodeMap.has(this.selectedNoteId)) {
            this.selectedNoteId = '';
        }

        if (this.hoveredNoteId && !this.nodeMap.has(this.hoveredNoteId)) {
            this.hoveredNoteId = '';
        }

        this.kick(24);
    }

    setSelectedNoteId(noteId) {
        this.selectedNoteId = this.nodeMap.has(noteId) ? noteId : '';
        this.draw();
    }

    setActive(isActive) {
        this.isActive = Boolean(isActive);

        if (this.isActive) {
            this.kick(18);
            return;
        }

        if (this.frameId) {
            window.cancelAnimationFrame(this.frameId);
            this.frameId = 0;
        }
    }

    refresh() {
        this.draw();
    }

    handleResize() {
        if (!this.canvas || !this.context) {
            return;
        }

        const bounds = this.canvas.getBoundingClientRect();
        const nextWidth = Math.max(Math.floor(bounds.width), 320);
        const nextHeight = Math.max(Math.floor(bounds.height), 320);
        const previousWidth = this.width || nextWidth;
        const previousHeight = this.height || nextHeight;

        this.width = nextWidth;
        this.height = nextHeight;
        this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.floor(this.width * this.dpr);
        this.canvas.height = Math.floor(this.height * this.dpr);

        if (!this.transform.x && !this.transform.y) {
            this.transform.x = this.width / 2;
            this.transform.y = this.height / 2;
        } else {
            this.transform.x += (this.width - previousWidth) / 2;
            this.transform.y += (this.height - previousHeight) / 2;
        }

        this.context.setTransform(1, 0, 0, 1, 0, 0);
        this.draw();
    }

    kick(frameBudget = 14) {
        this.shouldAnimate = true;
        this.animationBudget = Math.max(this.animationBudget || 0, frameBudget);

        if (!this.isActive || this.frameId) {
            this.draw();
            return;
        }

        this.frameId = window.requestAnimationFrame(this.animate);
    }

    animate() {
        this.frameId = 0;

        if (!this.isActive) {
            return;
        }

        const energy = this.stepSimulation();

        if (this.animationBudget > 0) {
            this.animationBudget -= 1;
        }

        this.draw();

        if (this.shouldAnimate || this.draggedNode || this.isPanning || energy > 0.045 || this.animationBudget > 0) {
            this.shouldAnimate = false;
            this.frameId = window.requestAnimationFrame(this.animate);
        }
    }

    stepSimulation() {
        if (!this.nodes.length) {
            return 0;
        }

        const repulsionStrength = 8200;
        const centeringStrength = 0.0019;
        const damping = this.draggedNode ? 0.76 : 0.88;
        const maxVelocity = 12;

        for (let sourceIndex = 0; sourceIndex < this.nodes.length; sourceIndex += 1) {
            const sourceNode = this.nodes[sourceIndex];

            if (sourceNode === this.draggedNode) {
                continue;
            }

            for (let targetIndex = sourceIndex + 1; targetIndex < this.nodes.length; targetIndex += 1) {
                const targetNode = this.nodes[targetIndex];

                if (targetNode === this.draggedNode) {
                    continue;
                }

                const dx = targetNode.x - sourceNode.x;
                const dy = targetNode.y - sourceNode.y;
                const distanceSquared = Math.max((dx * dx) + (dy * dy), 64);
                const distance = Math.sqrt(distanceSquared);
                const force = repulsionStrength / distanceSquared;
                const offsetX = (dx / distance) * force;
                const offsetY = (dy / distance) * force;

                sourceNode.vx -= offsetX / sourceNode.mass;
                sourceNode.vy -= offsetY / sourceNode.mass;
                targetNode.vx += offsetX / targetNode.mass;
                targetNode.vy += offsetY / targetNode.mass;
            }
        }

        this.edges.forEach((edge) => {
            const { sourceNode, targetNode, weight } = edge;

            if (!sourceNode || !targetNode) {
                return;
            }

            const dx = targetNode.x - sourceNode.x;
            const dy = targetNode.y - sourceNode.y;
            const distance = Math.max(Math.sqrt((dx * dx) + (dy * dy)), 0.001);
            const targetDistance = 178 - (weight * 76);
            const springStrength = 0.003 + (weight * 0.006);
            const stretch = distance - targetDistance;
            const offsetX = (dx / distance) * stretch * springStrength;
            const offsetY = (dy / distance) * stretch * springStrength;

            if (sourceNode !== this.draggedNode) {
                sourceNode.vx += offsetX;
                sourceNode.vy += offsetY;
            }

            if (targetNode !== this.draggedNode) {
                targetNode.vx -= offsetX;
                targetNode.vy -= offsetY;
            }
        });

        let energy = 0;

        this.nodes.forEach((node) => {
            if (node === this.draggedNode) {
                return;
            }

            node.vx += (-node.x) * centeringStrength;
            node.vy += (-node.y) * centeringStrength;
            node.vx *= damping;
            node.vy *= damping;

            node.vx = Math.max(-maxVelocity, Math.min(maxVelocity, node.vx));
            node.vy = Math.max(-maxVelocity, Math.min(maxVelocity, node.vy));
            node.x += node.vx;
            node.y += node.vy;
            energy += Math.abs(node.vx) + Math.abs(node.vy);
        });

        return energy / this.nodes.length;
    }

    draw() {
        if (!this.context || !this.canvas) {
            return;
        }

        const ctx = this.context;
        const styles = getComputedStyle(document.documentElement);
        const surfaceColor = styles.getPropertyValue('--surface-strong').trim() || '#ffffff';
        const borderColor = styles.getPropertyValue('--border').trim() || 'rgba(0, 0, 0, 0.12)';
        const textColor = styles.getPropertyValue('--text').trim() || '#1f2933';
        const mutedTextColor = styles.getPropertyValue('--text-muted').trim() || '#6b7280';
        const accentColor = styles.getPropertyValue('--accent-strong').trim() || '#506458';

        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        ctx.fillStyle = surfaceColor;
        ctx.fillRect(0, 0, this.width, this.height);

        this.drawGraphGrid(ctx, borderColor);

        ctx.save();
        ctx.translate(this.transform.x, this.transform.y);
        ctx.scale(this.transform.scale, this.transform.scale);

        this.edges.forEach((edge) => {
            ctx.beginPath();
            ctx.moveTo(edge.sourceNode.x, edge.sourceNode.y);
            ctx.lineTo(edge.targetNode.x, edge.targetNode.y);
            ctx.lineWidth = 1 + (edge.weight * 1.6);
            ctx.strokeStyle = this.createAlphaColor(mutedTextColor, 0.24 + (edge.weight * 0.24));
            ctx.stroke();
        });

        this.nodes.forEach((node) => {
            const isSelected = node.id === this.selectedNoteId;
            const isHovered = node.id === this.hoveredNoteId;
            const fillColor = this.getNodeColor(node.note);
            const ringColor = isSelected ? accentColor : borderColor;

            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius + (isSelected ? 5 : (isHovered ? 3 : 0)), 0, Math.PI * 2);
            ctx.fillStyle = this.createAlphaColor(fillColor, isSelected ? 0.16 : 0.1);
            ctx.fill();

            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            ctx.fillStyle = fillColor;
            ctx.strokeStyle = ringColor;
            ctx.lineWidth = isSelected ? 2.4 : 1.2;
            ctx.fill();
            ctx.stroke();

            const shouldDrawLabel = isSelected
                || isHovered
                || this.transform.scale >= 1.05
                || this.nodes.length <= 18;

            if (!shouldDrawLabel) {
                return;
            }

            const label = truncateText(node.note.title || 'Untitled note', 26);

            ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            const paddingX = 8;
            const paddingY = 5;
            const textWidth = ctx.measureText(label).width;
            const labelWidth = textWidth + (paddingX * 2);
            const labelHeight = 24;
            const labelX = node.x - (labelWidth / 2);
            const labelY = node.y + node.radius + 10;

            ctx.fillStyle = this.createAlphaColor(surfaceColor, 0.92);
            ctx.strokeStyle = this.createAlphaColor(borderColor, 0.96);
            ctx.lineWidth = 1 / this.transform.scale;
            ctx.beginPath();
            ctx.roundRect(labelX, labelY, labelWidth, labelHeight, 12);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = textColor;
            ctx.fillText(label, node.x, labelY + paddingY + 1);
        });

        ctx.restore();
    }

    drawGraphGrid(ctx, borderColor) {
        const spacing = 44;

        ctx.save();
        ctx.strokeStyle = this.createAlphaColor(borderColor, 0.28);
        ctx.lineWidth = 1;

        for (let x = 0; x <= this.width; x += spacing) {
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, this.height);
            ctx.stroke();
        }

        for (let y = 0; y <= this.height; y += spacing) {
            ctx.beginPath();
            ctx.moveTo(0, y + 0.5);
            ctx.lineTo(this.width, y + 0.5);
            ctx.stroke();
        }

        ctx.restore();
    }

    handlePointerDown(event) {
        if (!this.canvas) {
            return;
        }

        const point = this.getCanvasPoint(event);
        const worldPoint = this.toWorld(point.x, point.y);
        const node = this.findNodeAtPoint(worldPoint.x, worldPoint.y);

        this.pointerDownNodeId = node?.id || '';
        this.pointerDownPosition = point;
        this.didPointerMove = false;

        if (node) {
            this.draggedNode = node;
            this.dragPointerOffset.x = worldPoint.x - node.x;
            this.dragPointerOffset.y = worldPoint.y - node.y;
            node.vx = 0;
            node.vy = 0;
        } else {
            this.isPanning = true;
            this.panOrigin.x = point.x;
            this.panOrigin.y = point.y;
            this.panStart.x = this.transform.x;
            this.panStart.y = this.transform.y;
        }

        this.canvas.setPointerCapture(event.pointerId);
        this.kick(18);
    }

    handlePointerMove(event) {
        if (!this.canvas) {
            return;
        }

        const point = this.getCanvasPoint(event);
        const worldPoint = this.toWorld(point.x, point.y);
        const moveDistance = Math.hypot(
            point.x - this.pointerDownPosition.x,
            point.y - this.pointerDownPosition.y
        );

        if (moveDistance > 3) {
            this.didPointerMove = true;
        }

        if (this.draggedNode) {
            this.draggedNode.x = worldPoint.x - this.dragPointerOffset.x;
            this.draggedNode.y = worldPoint.y - this.dragPointerOffset.y;
            this.draggedNode.vx = 0;
            this.draggedNode.vy = 0;
            this.kick(22);
            return;
        }

        if (this.isPanning) {
            this.transform.x = this.panStart.x + (point.x - this.panOrigin.x);
            this.transform.y = this.panStart.y + (point.y - this.panOrigin.y);
            this.draw();
            return;
        }

        const hoveredNode = this.findNodeAtPoint(worldPoint.x, worldPoint.y);
        const nextHoveredId = hoveredNode?.id || '';

        if (nextHoveredId !== this.hoveredNoteId) {
            this.hoveredNoteId = nextHoveredId;
            this.canvas.style.cursor = hoveredNode ? 'grab' : 'default';
            this.draw();
        }
    }

    handlePointerUp(event) {
        if (!this.canvas) {
            return;
        }

        const point = this.getCanvasPoint(event);
        const worldPoint = this.toWorld(point.x, point.y);
        const releasedNode = this.findNodeAtPoint(worldPoint.x, worldPoint.y);
        const shouldSelect = !this.didPointerMove
            && releasedNode
            && releasedNode.id === this.pointerDownNodeId;

        if (this.canvas.hasPointerCapture(event.pointerId)) {
            this.canvas.releasePointerCapture(event.pointerId);
        }
        this.draggedNode = null;
        this.isPanning = false;
        this.pointerDownNodeId = '';
        this.canvas.style.cursor = releasedNode ? 'grab' : 'default';

        if (shouldSelect) {
            this.selectedNoteId = releasedNode.id;
            this.onSelect(releasedNode.id);
        }

        this.kick(16);
    }

    handlePointerLeave(event) {
        this.hoveredNoteId = '';

        if (event?.type === 'pointercancel') {
            this.draggedNode = null;
            this.isPanning = false;
            this.pointerDownNodeId = '';
        }

        if (!this.draggedNode && !this.isPanning) {
            this.draw();
        }
    }

    handleWheel(event) {
        if (!this.canvas) {
            return;
        }

        event.preventDefault();

        const point = this.getCanvasPoint(event);
        const beforeZoom = this.toWorld(point.x, point.y);
        const delta = event.deltaY < 0 ? 1.08 : 0.92;
        const nextScale = Math.max(GRAPH_MIN_SCALE, Math.min(GRAPH_MAX_SCALE, this.transform.scale * delta));

        if (nextScale === this.transform.scale) {
            return;
        }

        this.transform.scale = nextScale;
        this.transform.x = point.x - (beforeZoom.x * this.transform.scale);
        this.transform.y = point.y - (beforeZoom.y * this.transform.scale);
        this.kick(8);
    }

    getCanvasPoint(event) {
        const bounds = this.canvas?.getBoundingClientRect();

        return {
            x: (event.clientX - (bounds?.left || 0)),
            y: (event.clientY - (bounds?.top || 0))
        };
    }

    toWorld(screenX, screenY) {
        return {
            x: (screenX - this.transform.x) / this.transform.scale,
            y: (screenY - this.transform.y) / this.transform.scale
        };
    }

    findNodeAtPoint(x, y) {
        for (let index = this.nodes.length - 1; index >= 0; index -= 1) {
            const node = this.nodes[index];
            const distance = Math.hypot(node.x - x, node.y - y);

            if (distance <= node.radius + 4) {
                return node;
            }
        }

        return null;
    }

    getNodeColor(note = {}) {
        const cluster = getClusterForNote(note.id);

        if (cluster) {
            return getClusterColor(cluster);
        }

        const lightness = state.activeTheme === 'dark' ? '69%' : '44%';

        return `hsl(0 0% ${lightness})`;
    }

    createAlphaColor(color, alpha) {
        if (color.startsWith('rgb')) {
            const values = color.match(/[\d.]+/g);

            if (values && values.length >= 3) {
                return `rgba(${values[0]}, ${values[1]}, ${values[2]}, ${alpha})`;
            }
        }

        if (color.startsWith('hsl')) {
            const values = color.match(/[\d.]+%?/g);

            if (values && values.length >= 3) {
                return `hsl(${values[0]} ${values[1]} ${values[2]} / ${alpha})`;
            }
        }

        if (color.startsWith('#')) {
            const normalized = color.length === 4
                ? color
                    .slice(1)
                    .split('')
                    .map((value) => value + value)
                    .join('')
                : color.slice(1, 7);
            const red = Number.parseInt(normalized.slice(0, 2), 16);
            const green = Number.parseInt(normalized.slice(2, 4), 16);
            const blue = Number.parseInt(normalized.slice(4, 6), 16);

            if ([red, green, blue].every((value) => Number.isFinite(value))) {
                return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
            }
        }

        return color;
    }
}

const graphCanvasController = new GraphCanvasController({
    onSelect(noteId) {
        if (!noteId) {
            return;
        }

        state.selectedGraphNoteId = noteId;
        renderGraphSelection();
    }
});

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

function normalizeRevisitSuggestions(entries) {
    return (Array.isArray(entries) ? entries : [])
        .map((entry) => {
            const noteId = entry?.noteId ? String(entry.noteId) : '';

            if (!noteId) {
                return null;
            }

            return {
                noteId,
                dueAt: typeof entry?.dueAt === 'string' ? entry.dueAt : '',
                status: entry?.status === 'overdue' || entry?.status === 'today' ? entry.status : 'soon',
                daysUntilDue: Number.isFinite(Number(entry?.daysUntilDue))
                    ? Math.round(Number(entry.daysUntilDue))
                    : 0,
                daysOverdue: Number.isFinite(Number(entry?.daysOverdue))
                    ? Math.max(0, Math.round(Number(entry.daysOverdue)))
                    : 0,
                reviewCount: Number.isFinite(Number(entry?.reviewCount))
                    ? Math.max(0, Math.round(Number(entry.reviewCount)))
                    : 0,
                viewCount: Number.isFinite(Number(entry?.viewCount))
                    ? Math.max(0, Math.round(Number(entry.viewCount)))
                    : 0,
                lastViewedAt: typeof entry?.lastViewedAt === 'string' ? entry.lastViewedAt : '',
                lastReviewedAt: typeof entry?.lastReviewedAt === 'string' ? entry.lastReviewedAt : '',
                nextIntervalDays: Number.isFinite(Number(entry?.nextIntervalDays))
                    ? Math.max(1, Math.round(Number(entry.nextIntervalDays)))
                    : 1,
                priorityScore: Number.isFinite(Number(entry?.priorityScore))
                    ? Number(entry.priorityScore)
                    : 0,
                reason: typeof entry?.reason === 'string' ? entry.reason.trim() : ''
            };
        })
        .filter(Boolean);
}

async function requestRevisitSuggestions(notes) {
    const response = await fetch('/api/suggest-revisit', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            notes,
            limit: REVISIT_SUGGESTIONS_MAX_RESULTS
        })
    });

    let payload = null;

    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Revisit API not found. Run the app with `npm run dev` so Vercel serves `/api/suggest-revisit`.');
        }

        throw new Error(payload?.error || 'Could not load revisit suggestions right now.');
    }

    return normalizeRevisitSuggestions(payload?.suggestions);
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

async function refreshRevisitSuggestions(notes, fingerprint, requestToken) {
    try {
        const suggestions = await requestRevisitSuggestions(notes);

        if (requestToken !== state.revisitRequestToken || fingerprint !== state.revisitFingerprint) {
            return;
        }

        state.revisitSuggestions = suggestions;
        state.isRevisitLoading = false;
        state.revisitError = '';
        state.revisitResolvedFingerprint = fingerprint;
        state.revisitRequestFingerprint = '';
        renderRevisitSection(notes);
    } catch (error) {
        if (requestToken !== state.revisitRequestToken || fingerprint !== state.revisitFingerprint) {
            return;
        }

        console.error('Failed to load revisit suggestions via API.', error);
        state.revisitSuggestions = normalizeRevisitSuggestions(suggestRevisitNotes(notes, {
            limit: REVISIT_SUGGESTIONS_MAX_RESULTS
        }));
        state.isRevisitLoading = false;
        state.revisitError = error instanceof Error
            ? error.message
            : 'Could not load revisit suggestions right now.';
        state.revisitResolvedFingerprint = fingerprint;
        state.revisitRequestFingerprint = '';
        renderRevisitSection(notes);
    }
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

async function requestClusterResults(notes) {
    const response = await fetch('/api/cluster', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ notes })
    });

    let payload = null;

    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Cluster API not found. Run the app with `npm run dev` so Vercel serves `/api/cluster`.');
        }

        throw new Error(payload?.error || 'Could not cluster notes right now.');
    }

    return normalizeClusterData(payload, notes);
}

async function requestPatternAnalysis(notes) {
    const response = await fetch('/api/analyze-patterns', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            notes: notes.map((note) => ({
                id: note.id,
                title: note.title,
                content: note.content,
                summary: note.summary,
                tags: note.tags,
                createdAt: note.createdAt,
                updatedAt: note.updatedAt
            }))
        })
    });

    let payload = null;

    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Pattern analysis API not found. Run the app with `npm run dev` so Vercel serves `/api/analyze-patterns`.');
        }

        throw new Error(payload?.error || 'Could not analyze note patterns right now.');
    }

    return normalizePatternAnalysis(payload);
}

function createRelatedResults(results, currentNoteId) {
    return (Array.isArray(results) ? results : [])
        .filter(({ note }) => note?.id && note.id !== currentNoteId)
        .slice(0, RELATED_NOTES_MAX_RESULTS);
}

async function requestRelatedNotes(note) {
    const noteId = String(note?.id || '');
    const query = createRelatedNotesQuery(note);
    const candidateNotes = Storage.getAll().filter((entry) => entry.id !== noteId);

    if (!query) {
        return {
            results: [],
            source: 'empty',
            message: 'Add more note content to see related suggestions.'
        };
    }

    if (!candidateNotes.length) {
        return {
            results: [],
            source: 'empty',
            message: 'Save one more note to unlock related suggestions.'
        };
    }

    try {
        const results = await requestSearchResults(query, candidateNotes);

        return {
            results: createRelatedResults(results, noteId),
            source: 'api',
            message: ''
        };
    } catch (error) {
        console.error('Failed to load related notes via API.', error);
        const results = createRelatedResults(createLocalSearchResults(query, candidateNotes), noteId);

        return {
            results,
            source: 'local',
            message: results.length
                ? 'Showing local matches because the search API is unavailable.'
                : 'No related notes found. The search API is unavailable right now.'
        };
    }
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
        isExpanded: false,
        isSummarizing: false,
        error: '',
        isLoadingInsights: false,
        insightsError: '',
        insightsRequestToken: 0,
        isLoadingRelated: false,
        relatedError: '',
        relatedRequestToken: 0
    };
}

function setNoteUiState(noteId, nextState) {
    state.noteUi[noteId] = {
        ...getNoteUiState(noteId),
        ...nextState
    };
}

function clearNoteUiState(noteId, options = {}) {
    if (options.force) {
        delete state.noteUi[noteId];
        return;
    }

    const uiState = state.noteUi[noteId];

    if (!uiState) {
        return;
    }

    const nextUiState = {};

    if (uiState.isExpanded) {
        nextUiState.isExpanded = true;
    }

    if (uiState.isLoadingRelated) {
        nextUiState.isLoadingRelated = true;
    }

    if (uiState.isLoadingInsights) {
        nextUiState.isLoadingInsights = true;
    }

    if (uiState.relatedError) {
        nextUiState.relatedError = uiState.relatedError;
    }

    if (uiState.insightsError) {
        nextUiState.insightsError = uiState.insightsError;
    }

    if (uiState.relatedRequestToken) {
        nextUiState.relatedRequestToken = uiState.relatedRequestToken;
    }

    if (uiState.insightsRequestToken) {
        nextUiState.insightsRequestToken = uiState.insightsRequestToken;
    }

    if (Object.keys(nextUiState).length) {
        state.noteUi[noteId] = nextUiState;
        return;
    }

    delete state.noteUi[noteId];
}

function updateStoredNoteRevisit(noteId, computeNextRevisit) {
    const note = Storage.getById(noteId);

    if (!note || typeof computeNextRevisit !== 'function') {
        return null;
    }

    const nextRevisit = normalizeRevisitState(computeNextRevisit(note));

    if (JSON.stringify(nextRevisit) === JSON.stringify(normalizeRevisitState(note.revisit))) {
        return null;
    }

    const updatedNote = Storage.update(noteId, { revisit: nextRevisit }, { preserveUpdatedAt: true });

    return updatedNote || null;
}

function trackNoteView(noteId, options = {}) {
    const updatedNote = updateStoredNoteRevisit(noteId, (note) => {
        return buildViewUpdate(note, {
            viewedAt: options.viewedAt
        });
    });

    if (updatedNote && !options.skipRender) {
        refreshVisibleNotes();
    }

    return updatedNote;
}

function markNoteReviewed(noteId) {
    const updatedNote = updateStoredNoteRevisit(noteId, (note) => {
        return buildReviewUpdate(note);
    });

    if (!updatedNote) {
        return false;
    }

    setFeedback(`Marked "${updatedNote.title || 'note'}" as reviewed.`);
    refreshVisibleNotes();
    return true;
}

function getRelatedNotesCacheEntry(noteId) {
    return state.relatedNotesCache[noteId] || null;
}

function setRelatedNotesCacheEntry(noteId, entry) {
    state.relatedNotesCache[noteId] = entry;
}

function invalidateRelatedNotesCache() {
    state.relatedNotesCache = {};
}

function createRelatedNotesQuery(note = {}) {
    const content = String(note.content || '').trim();
    const fallbackText = [note.title, note.url]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join('\n\n');

    return limitTextLength(content || fallbackText, RELATED_QUERY_MAX_LENGTH);
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

async function requestInsights({ text, summary }) {
    const response = await fetch('/api/extract-insights', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text, summary })
    });

    let payload = null;

    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Insights API not found. Run the app with `npm run dev` so Vercel serves `/api/extract-insights`.');
        }

        throw new Error(payload?.error || 'Could not extract key insights right now.');
    }

    const insights = normalizeInsights(payload?.insights);

    if (!insights.length) {
        throw new Error('Could not extract key insights right now.');
    }

    return insights;
}

async function loadInsightsForNote(noteId, options = {}) {
    const note = Storage.getById(noteId);
    const uiState = getNoteUiState(noteId);

    if (!note || !note.summary) {
        return [];
    }

    if (!options.force && (note.insights.length || uiState.isLoadingInsights || uiState.insightsError)) {
        return note.insights;
    }

    const requestToken = uiState.insightsRequestToken + 1;

    setNoteUiState(noteId, {
        isLoadingInsights: true,
        insightsError: '',
        insightsRequestToken: requestToken
    });
    renderNotesList();

    try {
        const insights = await requestInsights({
            text: note.content,
            summary: note.summary
        });

        if (getNoteUiState(noteId).insightsRequestToken !== requestToken) {
            return [];
        }

        const updatedNote = Storage.update(noteId, { insights });

        if (!updatedNote) {
            throw new Error('Could not save key insights.');
        }

        setNoteUiState(noteId, {
            isLoadingInsights: false,
            insightsError: '',
            insightsRequestToken: 0
        });
        renderNotesList();
        return insights;
    } catch (error) {
        if (getNoteUiState(noteId).insightsRequestToken !== requestToken) {
            return [];
        }

        console.error('Failed to load key insights.', error);
        setNoteUiState(noteId, {
            isLoadingInsights: false,
            insightsError: error instanceof Error ? error.message : 'Could not extract key insights right now.',
            insightsRequestToken: 0
        });
        renderNotesList();
        return [];
    }
}

function ensureVisibleInsights(notes = state.notes) {
    notes.forEach((note) => {
        const uiState = getNoteUiState(note.id);

        if (note.summary && !note.insights.length && !uiState.isLoadingInsights && !uiState.insightsError) {
            void loadInsightsForNote(note.id);
        }
    });
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

async function refreshClusterData(notes, fingerprint, requestToken) {
    try {
        const clusterData = await requestClusterResults(notes);

        if (requestToken !== state.clusterRequestToken || fingerprint !== state.clusterFingerprint) {
            return;
        }

        state.clusterData = clusterData;
        state.clusterResolvedFingerprint = fingerprint;
        state.clusterRequestFingerprint = '';
        renderNotesList();
    } catch (error) {
        if (requestToken !== state.clusterRequestToken || fingerprint !== state.clusterFingerprint) {
            return;
        }

        console.error('Failed to refresh clusters via API.', error);
        state.clusterResolvedFingerprint = fingerprint;
        state.clusterRequestFingerprint = '';
    }
}

async function refreshPatternAnalysis(notes, fingerprint, requestToken) {
    try {
        const patternAnalysis = await requestPatternAnalysis(notes);

        if (requestToken !== state.patternAnalysisRequestToken || fingerprint !== state.patternAnalysisFingerprint) {
            return;
        }

        state.patternAnalysis = patternAnalysis;
        state.isPatternAnalysisLoading = false;
        state.patternAnalysisError = '';
        state.patternAnalysisResolvedFingerprint = fingerprint;
        state.patternAnalysisRequestFingerprint = '';
        renderInsightsView(notes);
    } catch (error) {
        if (requestToken !== state.patternAnalysisRequestToken || fingerprint !== state.patternAnalysisFingerprint) {
            return;
        }

        console.error('Failed to analyze note patterns via API.', error);
        state.isPatternAnalysisLoading = false;
        state.patternAnalysisError = error instanceof Error
            ? error.message
            : 'Could not analyze note patterns right now.';
        state.patternAnalysisResolvedFingerprint = fingerprint;
        state.patternAnalysisRequestFingerprint = '';
        renderInsightsView(notes);
    }
}

function syncClusterData(notes) {
    const nextNotes = Array.isArray(notes) ? notes : [];
    const fingerprint = createClusterFingerprint(nextNotes);

    state.clusterFingerprint = fingerprint;
    state.clusterData = clusterNotesByOverlappingTags(nextNotes);

    if (!fingerprint) {
        state.clusterResolvedFingerprint = '';
        state.clusterRequestFingerprint = '';
        return;
    }

    if (state.clusterResolvedFingerprint === fingerprint || state.clusterRequestFingerprint === fingerprint) {
        return;
    }

    state.clusterRequestToken += 1;
    state.clusterRequestFingerprint = fingerprint;
    void refreshClusterData(nextNotes, fingerprint, state.clusterRequestToken);
}

function syncPatternAnalysis(notes) {
    const nextNotes = Array.isArray(notes) ? notes : [];
    const fingerprint = createPatternAnalysisFingerprint(nextNotes);

    state.patternAnalysisFingerprint = fingerprint;

    if (!fingerprint) {
        state.patternAnalysis = createEmptyPatternAnalysis();
        state.isPatternAnalysisLoading = false;
        state.patternAnalysisError = '';
        state.patternAnalysisResolvedFingerprint = '';
        state.patternAnalysisRequestFingerprint = '';
        return;
    }

    if (state.patternAnalysisResolvedFingerprint === fingerprint || state.patternAnalysisRequestFingerprint === fingerprint) {
        return;
    }

    state.patternAnalysisRequestToken += 1;
    state.isPatternAnalysisLoading = true;
    state.patternAnalysisError = '';
    state.patternAnalysisRequestFingerprint = fingerprint;
    void refreshPatternAnalysis(nextNotes, fingerprint, state.patternAnalysisRequestToken);
}

function syncRevisitSuggestions(notes) {
    const nextNotes = Array.isArray(notes) ? notes : [];
    const fingerprint = createRevisitSuggestionsFingerprint(nextNotes);

    state.revisitFingerprint = fingerprint;

    if (!fingerprint) {
        state.revisitSuggestions = [];
        state.isRevisitLoading = false;
        state.revisitError = '';
        state.revisitResolvedFingerprint = '';
        state.revisitRequestFingerprint = '';
        return;
    }

    if (state.revisitResolvedFingerprint === fingerprint || state.revisitRequestFingerprint === fingerprint) {
        return;
    }

    state.revisitSuggestions = normalizeRevisitSuggestions(suggestRevisitNotes(nextNotes, {
        limit: REVISIT_SUGGESTIONS_MAX_RESULTS
    }));
    state.revisitRequestToken += 1;
    state.isRevisitLoading = true;
    state.revisitError = '';
    state.revisitRequestFingerprint = fingerprint;
    void refreshRevisitSuggestions(nextNotes, fingerprint, state.revisitRequestToken);
}

function setFeedback(message) {
    state.feedback = message;
    const feedbackElement = document.querySelector('#capture-feedback');

    if (feedbackElement) {
        feedbackElement.textContent = message;
    }
}

function syncGraphData(notes) {
    try {
        state.graphData = graphBuilder.build(notes);
    } catch (error) {
        console.error('Failed to build note graph data.', error);
        state.graphData = {
            nodes: [],
            edges: []
        };
    }
}

function setActiveLibraryView(view) {
    const nextView = view === 'insights' || view === 'graph' || view === 'timeline'
        ? view
        : 'list';

    if (state.activeLibraryView !== nextView) {
        state.activeLibraryView = nextView;
    }

    syncLibraryView();

    if (nextView === 'graph') {
        renderGraphView();
        return;
    }

    if (nextView === 'timeline') {
        renderTimelineView();
        return;
    }

    if (nextView === 'insights') {
        renderInsightsView();
    }
}

function syncLibraryView() {
    const listView = document.querySelector('#notes-list-view');
    const graphView = document.querySelector('#graph-view');
    const insightsView = document.querySelector('#insights-view');
    const timelineView = document.querySelector('#timeline-view');
    const tabButtons = document.querySelectorAll('.view-tab');
    const isInsightsView = state.activeLibraryView === 'insights';
    const isGraphView = state.activeLibraryView === 'graph';
    const isTimelineView = state.activeLibraryView === 'timeline';

    if (listView) {
        listView.hidden = isInsightsView || isGraphView || isTimelineView;
    }

    if (insightsView) {
        insightsView.hidden = !isInsightsView;
    }

    if (graphView) {
        graphView.hidden = !isGraphView;
    }

    if (timelineView) {
        timelineView.hidden = !isTimelineView;
    }

    tabButtons.forEach((button) => {
        const isSelected = button instanceof HTMLButtonElement
            && button.dataset.libraryView === state.activeLibraryView;

        button.classList.toggle('is-active', isSelected);
        button.setAttribute('aria-selected', String(isSelected));
        button.tabIndex = isSelected ? 0 : -1;
    });

    graphCanvasController.setActive(isGraphView);
}

function createInsightsStatCard({ label, value, meta, tone = 'default' }) {
    const card = document.createElement('article');
    const labelElement = document.createElement('p');
    const valueElement = document.createElement('strong');
    const metaElement = document.createElement('p');

    card.className = 'insight-stat-card';
    card.dataset.tone = tone;

    labelElement.className = 'insight-stat-label';
    labelElement.textContent = label;

    valueElement.className = 'insight-stat-value';
    valueElement.textContent = value;

    metaElement.className = 'insight-stat-meta';
    metaElement.textContent = meta;

    card.append(labelElement, valueElement, metaElement);

    return card;
}

function createInsightTopicPill(topicEntry = {}) {
    const item = document.createElement('li');
    const pill = document.createElement('div');
    const topic = document.createElement('span');
    const meta = document.createElement('span');

    item.className = 'insight-topic-item';
    pill.className = 'insight-topic-pill';
    topic.className = 'insight-topic-label';
    topic.textContent = topicEntry.topic || 'untitled';
    meta.className = 'insight-topic-meta';
    meta.textContent = `${formatCountLabel(topicEntry.count || 0, 'note')} • ${topicEntry.share || 0}%`;
    pill.append(topic, meta);
    item.append(pill);

    return item;
}

function createTrendDay(day = {}, maxCount = 0) {
    const item = document.createElement('div');
    const bar = document.createElement('div');
    const fill = document.createElement('span');
    const count = document.createElement('span');
    const label = document.createElement('span');
    const barHeight = maxCount > 0 ? Math.max(10, Math.round((day.count / maxCount) * 100)) : 10;

    item.className = 'trend-day';
    bar.className = 'trend-day-bar';
    fill.className = 'trend-day-fill';
    fill.style.setProperty('--trend-bar-height', `${barHeight}%`);
    fill.setAttribute('aria-hidden', 'true');
    count.className = 'trend-day-count';
    count.textContent = String(day.count || 0);
    label.className = 'trend-day-label';
    label.textContent = day.label || '';
    bar.title = `${day.label || ''}: ${formatCountLabel(day.count || 0, 'note')}`;
    bar.append(fill);
    item.append(count, bar, label);

    return item;
}

function createKnowledgeHealthRing(health = {}) {
    const ring = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const progress = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const copy = document.createElement('div');
    const value = document.createElement('strong');
    const label = document.createElement('span');
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const score = clampNumber(Number(health.score) || 0, 0, 100);
    const dashOffset = circumference - ((score / 100) * circumference);

    ring.className = 'health-ring';
    ring.dataset.tone = health.tone || 'growing';
    ring.setAttribute('role', 'img');
    ring.setAttribute('aria-label', `Knowledge health score ${score} out of 100`);

    svg.classList.add('health-ring-graphic');
    svg.setAttribute('viewBox', '0 0 120 120');
    track.classList.add('health-ring-track');
    progress.classList.add('health-ring-progress');

    [track, progress].forEach((circle) => {
        circle.setAttribute('cx', '60');
        circle.setAttribute('cy', '60');
        circle.setAttribute('r', String(radius));
    });

    progress.style.strokeDasharray = String(circumference);
    progress.style.strokeDashoffset = String(dashOffset);

    copy.className = 'health-ring-copy';
    value.className = 'health-ring-value';
    value.textContent = String(score);
    label.className = 'health-ring-label';
    label.textContent = 'Out of 100';

    svg.append(track, progress);
    copy.append(value, label);
    ring.append(svg, copy);

    return ring;
}

function createKnowledgeHealthFactorCard(factor = {}) {
    const card = document.createElement('article');
    const label = document.createElement('p');
    const score = document.createElement('strong');
    const meta = document.createElement('p');

    card.className = 'health-factor-card';
    card.dataset.tone = getKnowledgeHealthTone(factor.score || 0);

    label.className = 'health-factor-label';
    label.textContent = factor.label || 'Coverage';

    score.className = 'health-factor-score';
    score.textContent = String(Math.round(factor.score || 0));

    meta.className = 'health-factor-meta';
    meta.textContent = factor.meta || '';

    card.append(label, score, meta);
    return card;
}

function createKnowledgeHealthSuggestionCard(suggestion = {}) {
    const item = document.createElement('li');
    const card = document.createElement('article');
    const title = document.createElement('p');
    const message = document.createElement('p');

    item.className = 'health-suggestion-item';
    card.className = 'health-suggestion-card';
    title.className = 'health-suggestion-title';
    title.textContent = suggestion.title || 'Keep it moving';
    message.className = 'health-suggestion-copy';
    message.textContent = suggestion.message || 'Small, regular improvements compound quickly.';
    card.append(title, message);
    item.append(card);

    return item;
}

function renderKnowledgeHealth(allNotes = Storage.getAll()) {
    const container = document.querySelector('#knowledge-health');

    if (!container) {
        return;
    }

    const health = calculateKnowledgeHealth(allNotes);
    const overview = document.createElement('div');
    const copy = document.createElement('div');
    const kicker = document.createElement('p');
    const title = document.createElement('h4');
    const message = document.createElement('p');
    const breakdown = document.createElement('div');
    const suggestionWrap = document.createElement('div');
    const suggestionHeader = document.createElement('div');
    const suggestionTitle = document.createElement('p');
    const suggestionMeta = document.createElement('p');
    const suggestionList = document.createElement('ul');

    container.dataset.tone = health.tone;
    overview.className = 'health-overview';
    copy.className = 'health-copy';
    kicker.className = 'health-kicker';
    kicker.textContent = 'Knowledge health';
    title.className = 'health-title';
    title.textContent = health.title;
    message.className = 'health-message';
    message.textContent = health.message;

    breakdown.className = 'health-breakdown';
    health.factors.forEach((factor) => {
        breakdown.append(createKnowledgeHealthFactorCard(factor));
    });

    copy.append(kicker, title, message, breakdown);
    overview.append(createKnowledgeHealthRing(health), copy);

    suggestionWrap.className = 'health-suggestions';
    suggestionHeader.className = 'health-suggestions-header';
    suggestionTitle.className = 'health-suggestions-title';
    suggestionTitle.textContent = 'Next best lifts';
    suggestionMeta.className = 'health-suggestions-meta';
    suggestionMeta.textContent = 'Small habits that will raise the score fastest.';
    suggestionHeader.append(suggestionTitle, suggestionMeta);

    suggestionList.className = 'health-suggestion-list';
    health.suggestions.forEach((suggestion) => {
        suggestionList.append(createKnowledgeHealthSuggestionCard(suggestion));
    });

    suggestionWrap.append(suggestionHeader, suggestionList);
    container.replaceChildren(overview, suggestionWrap);
}

function renderInsightsView(allNotes = Storage.getAll()) {
    const view = document.querySelector('#insights-view');
    const status = document.querySelector('#insights-status');
    const stats = document.querySelector('#insights-stats');
    const topics = document.querySelector('#insights-topics');
    const trend = document.querySelector('#insights-trend');
    const summary = document.querySelector('#insights-summary');

    if (!view || !status || !stats || !topics || !trend || !summary) {
        return;
    }

    const noteCount = Array.isArray(allNotes) ? allNotes.length : 0;
    const patternAnalysis = state.patternAnalysis;
    const trendData = patternAnalysis.weeklyTrend;
    const topTopic = patternAnalysis.topTopics[0] || null;

    if (!noteCount) {
        status.textContent = 'Save a few notes to unlock pattern analysis.';
        summary.textContent = 'Insights appear once the library has enough activity to summarize.';
        renderKnowledgeHealth(allNotes);
        stats.replaceChildren(
            createInsightsStatCard({
                label: 'Learning streak',
                value: '0 days',
                meta: 'No activity yet.',
                tone: 'muted'
            }),
            createInsightsStatCard({
                label: 'Diversity score',
                value: '0',
                meta: 'Add notes across different topics.',
                tone: 'muted'
            }),
            createInsightsStatCard({
                label: 'Weekly trend',
                value: 'Steady',
                meta: 'No recent activity yet.',
                tone: 'muted'
            }),
            createInsightsStatCard({
                label: 'Top topic',
                value: 'None',
                meta: 'Tags and note content will surface here.',
                tone: 'muted'
            })
        );
        topics.replaceChildren();
        trend.replaceChildren();
        return;
    }

    if (state.isPatternAnalysisLoading && !state.patternAnalysisResolvedFingerprint) {
        status.textContent = 'Analyzing patterns...';
    } else if (state.patternAnalysisError) {
        status.textContent = state.patternAnalysisError;
    } else {
        status.textContent = 'Patterns across your full saved library.';
    }

    summary.textContent = state.isPatternAnalysisLoading && !state.patternAnalysisError
        ? 'Refreshing topic coverage, streaks, and weekly activity.'
        : `Based on ${formatCountLabel(noteCount, 'saved item')}, not just the current search results.`;
    renderKnowledgeHealth(allNotes);

    stats.replaceChildren(
        createInsightsStatCard({
            label: 'Learning streak',
            value: `${patternAnalysis.learningStreak.current} day${patternAnalysis.learningStreak.current === 1 ? '' : 's'}`,
            meta: patternAnalysis.learningStreak.longest > 0
                ? `Longest run: ${patternAnalysis.learningStreak.longest} day${patternAnalysis.learningStreak.longest === 1 ? '' : 's'}`
                : 'Start saving daily to build a streak.',
            tone: 'accent'
        }),
        createInsightsStatCard({
            label: 'Diversity score',
            value: `${patternAnalysis.diversityScore.score}`,
            meta: `${patternAnalysis.diversityScore.label} spread across ${formatCountLabel(patternAnalysis.diversityScore.uniqueTopics, 'topic')}`,
            tone: 'default'
        }),
        createInsightsStatCard({
            label: 'Weekly trend',
            value: formatTrendDirection(trendData.direction),
            meta: `${formatCountLabel(trendData.currentTotal, 'note')} this week vs ${formatCountLabel(trendData.previousTotal, 'note')} last week`,
            tone: trendData.direction === 'up' ? 'accent' : (trendData.direction === 'down' ? 'warning' : 'default')
        }),
        createInsightsStatCard({
            label: 'Top topic',
            value: topTopic ? topTopic.topic : 'Mixed',
            meta: topTopic
                ? `${formatCountLabel(topTopic.count, 'note')} • ${topTopic.share}% of library`
                : 'Add tags or richer note content to sharpen this.',
            tone: 'default'
        })
    );

    topics.replaceChildren();

    if (patternAnalysis.topTopics.length) {
        const topicList = document.createElement('ul');

        topicList.className = 'insight-topic-list';
        patternAnalysis.topTopics.forEach((topicEntry) => {
            topicList.append(createInsightTopicPill(topicEntry));
        });
        topics.append(topicList);
    } else {
        const emptyTopics = document.createElement('p');

        emptyTopics.className = 'insights-empty-copy';
        emptyTopics.textContent = 'Top topics will appear once the notes have stronger recurring themes.';
        topics.append(emptyTopics);
    }

    trend.replaceChildren();

    if (trendData.days.length) {
        const trendHeader = document.createElement('div');
        const trendTitle = document.createElement('p');
        const trendMeta = document.createElement('p');
        const trendBars = document.createElement('div');
        const maxCount = Math.max(...trendData.days.map((day) => day.count), 0);

        trendHeader.className = 'trend-header';
        trendTitle.className = 'trend-title';
        trendTitle.textContent = 'Last 7 days';
        trendMeta.className = 'trend-meta';
        trendMeta.textContent = state.patternAnalysisError
            ? 'Showing the latest successful analysis.'
            : `Direction: ${formatTrendDirection(trendData.direction)}`;
        trendHeader.append(trendTitle, trendMeta);

        trendBars.className = 'trend-bars';
        trendData.days.forEach((day) => {
            trendBars.append(createTrendDay(day, maxCount));
        });

        trend.append(trendHeader, trendBars);
    } else {
        const emptyTrend = document.createElement('p');

        emptyTrend.className = 'insights-empty-copy';
        emptyTrend.textContent = 'Weekly activity will appear once your notes have timestamps to compare.';
        trend.append(emptyTrend);
    }
}

function syncGraphSelection(notes = state.notes) {
    const selectedNoteId = state.selectedGraphNoteId;
    const isSelectionVisible = notes.some((note) => note.id === selectedNoteId);

    if (!isSelectionVisible) {
        state.selectedGraphNoteId = '';
    }
}

function createGraphSelectedTag(tag) {
    const pill = document.createElement('span');

    pill.className = 'graph-note-tag';
    pill.textContent = tag;
    setTagTone(tag, pill);

    return pill;
}

function createGraphSelectionPlaceholder(copy) {
    const card = document.createElement('div');
    const title = document.createElement('p');
    const body = document.createElement('p');

    card.className = 'graph-note-card graph-note-card-empty';
    title.className = 'graph-note-placeholder-title';
    title.textContent = 'Select a note';
    body.className = 'graph-note-placeholder-copy';
    body.textContent = copy;
    card.append(title, body);

    return card;
}

function createGraphSelectionCard(note) {
    const article = document.createElement('article');
    const header = document.createElement('div');
    const title = document.createElement('h3');
    const meta = document.createElement('p');
    const body = document.createElement('p');
    const tags = document.createElement('div');
    const actions = document.createElement('div');
    const openInListButton = document.createElement('button');

    article.className = 'graph-note-card';
    header.className = 'graph-note-header';
    title.className = 'graph-note-title';
    title.textContent = note.title || 'Untitled note';

    meta.className = 'graph-note-meta';
    meta.textContent = `${note.type === 'link' ? 'Link' : 'Note'} • ${formatRelativeTime(note.createdAt)}`;
    header.append(title, meta);
    article.append(header);

    if (note.type === 'link' && note.url) {
        const link = document.createElement('a');

        link.className = 'graph-note-link';
        link.href = note.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = note.url;
        article.append(link);
    }

    if (note.summary) {
        const summary = document.createElement('p');

        summary.className = 'graph-note-summary';
        summary.textContent = note.summary;
        article.append(summary);
    }

    body.className = 'graph-note-body';
    body.textContent = truncateText(note.content || 'No written content saved for this note.', 360);
    article.append(body);

    if (note.insights.length) {
        const insightsTitle = document.createElement('p');
        const insightsList = document.createElement('ul');

        insightsTitle.className = 'graph-note-insights-title';
        insightsTitle.textContent = 'Key insights';
        insightsList.className = 'graph-note-insights';

        note.insights.forEach((insight) => {
            const item = document.createElement('li');

            item.className = 'graph-note-insight';
            item.textContent = insight;
            insightsList.append(item);
        });

        article.append(insightsTitle, insightsList);
    }

    tags.className = 'graph-note-tags';

    if (note.tags.length) {
        note.tags.forEach((tag) => {
            tags.append(createGraphSelectedTag(tag));
        });
    } else {
        const untagged = document.createElement('span');

        untagged.className = 'graph-note-tag graph-note-tag-muted';
        untagged.textContent = UNTAGGED_FILTER_LABEL;
        tags.append(untagged);
    }

    article.append(tags);

    actions.className = 'graph-note-actions';

    openInListButton.className = 'graph-note-action';
    openInListButton.type = 'button';
    openInListButton.dataset.noteId = note.id;
    openInListButton.dataset.graphAction = 'open-in-list';
    openInListButton.textContent = 'Open in list';
    actions.append(openInListButton);

    if (note.summary && !note.insights.length) {
        const helper = document.createElement('p');

        helper.className = 'graph-note-helper';
        helper.textContent = 'Insights are still loading for this note.';
        article.append(helper);
    }

    article.append(actions);

    return article;
}

function renderGraphSelection() {
    const selectionPanel = document.querySelector('#graph-note-panel');

    if (!selectionPanel) {
        return;
    }

    const selectedNote = state.notes.find((note) => note.id === state.selectedGraphNoteId) || null;

    if (!state.notes.length) {
        selectionPanel.replaceChildren(createGraphSelectionPlaceholder('Save a note to start mapping connections.'));
        return;
    }

    if (!selectedNote) {
        selectionPanel.replaceChildren(
            createGraphSelectionPlaceholder('Click a node to inspect the connected note here.')
        );
        return;
    }

    selectionPanel.replaceChildren(createGraphSelectionCard(selectedNote));
}

function renderGraphView() {
    const canvas = document.querySelector('#notes-graph-canvas');
    const graphEmpty = document.querySelector('#graph-empty-state');
    const graphHint = document.querySelector('#graph-hint');
    const graphCount = document.querySelector('#graph-count');
    const graphLegend = document.querySelector('#graph-legend');
    const hasNotes = state.graphData.nodes.length > 0;

    graphCanvasController.mount(canvas);
    graphCanvasController.setData(state.graphData);
    graphCanvasController.setSelectedNoteId(state.selectedGraphNoteId);
    graphCanvasController.setActive(state.activeLibraryView === 'graph');

    if (graphEmpty) {
        graphEmpty.hidden = hasNotes;
    }

    if (canvas instanceof HTMLCanvasElement) {
        canvas.hidden = !hasNotes;
    }

    if (graphHint) {
        graphHint.textContent = hasNotes
            ? 'Drag notes to rearrange. Scroll to zoom. Drag the background to pan. Colors show tag clusters.'
            : 'The graph will appear once there are notes to connect.';
    }

    if (graphCount) {
        const edgeCount = state.graphData.edges.length;
        const clusterCount = state.clusterData.clusters.length;
        graphCount.textContent = hasNotes
            ? `${formatCountLabel(state.graphData.nodes.length, 'node')} • ${formatCountLabel(edgeCount, 'connection')} • ${formatCountLabel(clusterCount, 'cluster')}`
            : '0 nodes';
    }

    if (graphLegend) {
        graphLegend.hidden = !hasNotes || !state.clusterData.clusters.length;

        if (hasNotes && state.clusterData.clusters.length) {
            const fragment = document.createDocumentFragment();

            state.clusterData.clusters.forEach((cluster) => {
                const item = document.createElement('article');
                const swatch = document.createElement('span');
                const body = document.createElement('div');
                const label = document.createElement('p');
                const meta = document.createElement('p');

                item.className = 'graph-legend-item';
                swatch.className = 'graph-legend-swatch';
                setClusterTone(cluster, swatch);

                body.className = 'graph-legend-body';
                label.className = 'graph-legend-label';
                label.textContent = formatClusterLabel(cluster);

                meta.className = 'graph-legend-meta';
                meta.textContent = cluster.topTags.length
                    ? `${formatCountLabel(cluster.size, 'note')} • ${cluster.topTags.join(', ')}`
                    : `${formatCountLabel(cluster.size, 'note')} • no tags`;

                body.append(label, meta);
                item.append(swatch, body);
                fragment.append(item);
            });

            graphLegend.replaceChildren(fragment);
        } else {
            graphLegend.replaceChildren();
        }
    }

    renderGraphSelection();
}

function createDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function getTimelineGroupDescriptor(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return {
            key: 'day:invalid',
            kind: 'day',
            label: 'Recent',
            meta: '',
            sortTime: 0
        };
    }

    const noteDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffDays = Math.round((startOfToday - noteDay) / 86_400_000);

    if (diffDays < TIMELINE_DAY_GROUP_WINDOW_DAYS) {
        return {
            key: `day:${createDateKey(noteDay)}`,
            kind: 'day',
            label: formatTimelineDayHeader(noteDay),
            meta: formatTimelineDayMeta(noteDay),
            sortTime: noteDay.getTime()
        };
    }

    const weekStart = new Date(noteDay);
    const dayOfWeek = weekStart.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    weekStart.setDate(weekStart.getDate() + diffToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);

    weekEnd.setDate(weekStart.getDate() + 6);

    return {
        key: `week:${createDateKey(weekStart)}`,
        kind: 'week',
        label: formatTimelineWeekHeader(weekStart),
        meta: formatTimelineWeekMeta(weekStart, weekEnd),
        sortTime: weekStart.getTime()
    };
}

function buildTimelineGroups(notes) {
    const groups = [];
    const groupsByKey = new Map();
    const sortedNotes = [...notes].sort((left, right) => {
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });

    sortedNotes.forEach((note) => {
        const descriptor = getTimelineGroupDescriptor(note.createdAt);
        let group = groupsByKey.get(descriptor.key);

        if (!group) {
            group = {
                ...descriptor,
                items: []
            };
            groupsByKey.set(descriptor.key, group);
            groups.push(group);
        }

        group.items.push(note);
    });

    return groups.sort((left, right) => right.sortTime - left.sortTime);
}

function createTimelineTag(tag) {
    return createTagPill(tag);
}

function createTimelineItem(note) {
    const article = document.createElement('article');
    const rail = document.createElement('div');
    const dot = document.createElement('span');
    const card = document.createElement('div');
    const topRow = document.createElement('div');
    const heading = document.createElement('div');
    const title = document.createElement('h4');
    const meta = document.createElement('p');
    const openButton = document.createElement('button');
    const snippet = document.createElement('p');
    const tags = document.createElement('div');
    const previewText = note.summary || note.content || note.url || 'No preview available.';

    article.className = 'timeline-item';
    rail.className = 'timeline-item-rail';
    dot.className = 'timeline-item-dot';
    rail.append(dot);

    card.className = 'timeline-item-card';
    topRow.className = 'timeline-item-top';
    heading.className = 'timeline-item-heading';

    title.className = 'timeline-item-title';
    title.textContent = note.title || (note.type === 'link' ? 'Saved link' : 'Untitled note');

    meta.className = 'timeline-item-meta';
    meta.textContent = `${note.type === 'link' ? 'Link' : 'Note'} • ${formatRelativeTime(note.createdAt)}`;

    heading.append(title, meta);

    openButton.className = 'timeline-item-action';
    openButton.type = 'button';
    openButton.dataset.noteId = note.id;
    openButton.dataset.timelineAction = 'open-in-list';
    openButton.textContent = 'Open in list';

    topRow.append(heading, openButton);

    snippet.className = 'timeline-item-snippet';
    snippet.textContent = truncateText(previewText, 180);

    tags.className = 'timeline-item-tags';

    if (note.tags.length) {
        note.tags.forEach((tag) => {
            tags.append(createTimelineTag(tag));
        });
    } else {
        const untagged = document.createElement('span');

        untagged.className = 'note-tag note-tag-muted';
        untagged.textContent = UNTAGGED_FILTER_LABEL;
        tags.append(untagged);
    }

    card.append(topRow, snippet, tags);
    article.append(rail, card);

    return article;
}

function createTimelineGroup(group) {
    const section = document.createElement('section');
    const header = document.createElement('div');
    const heading = document.createElement('div');
    const label = document.createElement('h3');
    const meta = document.createElement('p');
    const count = document.createElement('span');
    const list = document.createElement('div');

    section.className = 'timeline-group';
    section.dataset.timelineGroup = group.kind;
    header.className = 'timeline-group-header';
    heading.className = 'timeline-group-heading';

    label.className = 'timeline-group-label';
    label.textContent = group.label;

    meta.className = 'timeline-group-meta';
    meta.textContent = group.meta;

    heading.append(label);

    if (group.meta) {
        heading.append(meta);
    }

    count.className = 'timeline-group-count';
    count.textContent = formatCountLabel(group.items.length, 'entry');

    list.className = 'timeline-group-list';
    group.items.forEach((note) => {
        list.append(createTimelineItem(note));
    });

    header.append(heading, count);
    section.append(header, list);

    return section;
}

function renderTimelineView(allNotes = Storage.getAll()) {
    const timeline = document.querySelector('#notes-timeline');
    const timelineHint = document.querySelector('#timeline-hint');
    const timelineCount = document.querySelector('#timeline-count');

    if (!timeline) {
        return;
    }

    if (timelineHint) {
        timelineHint.textContent = state.notes.length
            ? 'Recent entries are grouped by day. Older entries roll up by week.'
            : 'Your saved notes will appear here as a vertical timeline.';
    }

    if (timelineCount) {
        timelineCount.textContent = state.notes.length
            ? formatCountLabel(state.notes.length, 'entry')
            : '0 entries';
    }

    if (!state.notes.length) {
        timeline.replaceChildren(createEmptyState(allNotes));
        return;
    }

    const fragment = document.createDocumentFragment();

    buildTimelineGroups(state.notes).forEach((group) => {
        fragment.append(createTimelineGroup(group));
    });

    timeline.replaceChildren(fragment);
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

function createRevisitSuggestionCard(note, suggestion) {
    const article = document.createElement('article');
    const topRow = document.createElement('div');
    const heading = document.createElement('div');
    const title = document.createElement('h3');
    const meta = document.createElement('p');
    const reason = document.createElement('p');
    const snippet = document.createElement('p');
    const actions = document.createElement('div');
    const openButton = document.createElement('button');
    const reviewButton = document.createElement('button');
    const snippetText = note.summary || note.content || note.url || 'Open this note to review it.';
    const reviewedMeta = suggestion.lastReviewedAt
        ? `Last reviewed ${formatRelativeTime(suggestion.lastReviewedAt)}`
        : (suggestion.lastViewedAt ? `Last viewed ${formatRelativeTime(suggestion.lastViewedAt)}` : 'Not reviewed yet');

    article.className = 'revisit-card';
    topRow.className = 'revisit-card-top';
    heading.className = 'revisit-card-heading';

    title.className = 'revisit-card-title';
    title.textContent = note.title || (note.type === 'link' ? 'Saved link' : 'Untitled note');

    meta.className = 'revisit-card-meta';
    meta.textContent = `${formatRevisitDueLabel(suggestion)} • ${reviewedMeta}`;

    heading.append(title, meta);

    reason.className = 'revisit-card-reason';
    reason.textContent = suggestion.reason || 'Scheduled for revisit.';

    snippet.className = 'revisit-card-snippet';
    snippet.textContent = truncateText(snippetText, 150);

    actions.className = 'revisit-card-actions';

    openButton.className = 'secondary-button';
    openButton.type = 'button';
    openButton.dataset.noteId = note.id;
    openButton.dataset.revisitAction = 'open-note';
    openButton.textContent = 'Open note';

    reviewButton.className = 'ghost-button revisit-review-button';
    reviewButton.type = 'button';
    reviewButton.dataset.noteId = note.id;
    reviewButton.dataset.revisitAction = 'mark-reviewed';
    reviewButton.textContent = 'Mark as reviewed';

    topRow.append(heading);
    actions.append(openButton, reviewButton);
    article.append(topRow, reason, snippet, actions);

    return article;
}

function renderRevisitSection(allNotes = Storage.getAll()) {
    const section = document.querySelector('#revisit-section');
    const status = document.querySelector('#revisit-status');
    const list = document.querySelector('#revisit-list');
    const count = document.querySelector('#revisit-count');

    if (!section || !status || !list || !count) {
        return;
    }

    const noteCount = Array.isArray(allNotes) ? allNotes.length : 0;

    if (!noteCount) {
        section.hidden = true;
        list.replaceChildren();
        return;
    }

    const notesById = new Map(allNotes.map((note) => [note.id, note]));
    const suggestions = normalizeRevisitSuggestions(state.revisitSuggestions)
        .map((suggestion) => {
            const note = notesById.get(suggestion.noteId);

            if (!note) {
                return null;
            }

            return {
                note,
                suggestion
            };
        })
        .filter(Boolean);

    section.hidden = false;
    count.textContent = suggestions.length
        ? formatCountLabel(suggestions.length, 'note')
        : '0 notes';

    if (state.isRevisitLoading && !suggestions.length) {
        status.textContent = 'Calculating spaced repetition suggestions...';
    } else if (state.revisitError && suggestions.length) {
        status.textContent = 'Showing local suggestions because the revisit API is unavailable.';
    } else if (state.revisitError) {
        status.textContent = state.revisitError;
    } else if (suggestions.length) {
        status.textContent = 'Based on your local review history and spaced intervals.';
    } else {
        status.textContent = 'Nothing is due right now. Recently reviewed notes will reappear automatically.';
    }

    if (!suggestions.length) {
        const emptyState = document.createElement('div');
        const title = document.createElement('p');
        const copy = document.createElement('p');

        emptyState.className = 'revisit-empty';
        title.className = 'revisit-empty-title';
        title.textContent = state.isRevisitLoading
            ? 'Preparing revisit suggestions...'
            : 'No notes to revisit yet.';
        copy.className = 'revisit-empty-copy';
        copy.textContent = state.isRevisitLoading
            ? 'Recent note history is being evaluated now.'
            : 'Open notes and mark them reviewed to build a spaced repetition rhythm.';
        emptyState.append(title, copy);
        list.replaceChildren(emptyState);
        return;
    }

    const fragment = document.createDocumentFragment();

    suggestions.forEach(({ note, suggestion }) => {
        fragment.append(createRevisitSuggestionCard(note, suggestion));
    });

    list.replaceChildren(fragment);
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

function createClusterSection(cluster, notes, startIndex = 0) {
    const section = document.createElement('section');
    const header = document.createElement('div');
    const heading = document.createElement('div');
    const kicker = document.createElement('p');
    const titleRow = document.createElement('div');
    const swatch = document.createElement('span');
    const title = document.createElement('h3');
    const meta = document.createElement('p');
    const count = document.createElement('span');
    const notesGrid = document.createElement('div');

    section.className = 'notes-cluster';
    header.className = 'notes-cluster-header';
    heading.className = 'notes-cluster-heading';
    setClusterTone(cluster, header);

    kicker.className = 'notes-cluster-kicker';
    kicker.textContent = `Cluster ${Number(cluster?.colorIndex || 0) + 1}`;

    titleRow.className = 'notes-cluster-title-row';
    swatch.className = 'notes-cluster-swatch';
    setClusterTone(cluster, swatch);

    title.className = 'notes-cluster-title';
    title.textContent = formatClusterLabel(cluster);
    titleRow.append(swatch, title);

    meta.className = 'notes-cluster-meta';
    meta.textContent = cluster.topTags.length
        ? `Connected by ${cluster.topTags.join(', ')}.`
        : 'No tags yet, so these notes currently stand alone.';

    heading.append(kicker, titleRow, meta);

    count.className = 'notes-cluster-count';
    count.textContent = formatCountLabel(notes.length, 'note');

    notesGrid.className = 'notes-cluster-notes';
    notes.forEach((note, noteIndex) => {
        notesGrid.append(createNoteCard(note, startIndex + noteIndex));
    });

    header.append(heading, count);
    section.append(header, notesGrid);

    return section;
}

function renderClusteredNotesList(notesList, notes) {
    const notesByClusterId = new Map();
    const orderedClusters = [];
    let globalIndex = 0;

    notes.forEach((note) => {
        const cluster = getClusterForNote(note.id);
        const clusterId = cluster?.id || 'cluster-unassigned';

        if (!notesByClusterId.has(clusterId)) {
            notesByClusterId.set(clusterId, []);
        }

        notesByClusterId.get(clusterId).push(note);
    });

    state.clusterData.clusters.forEach((cluster) => {
        if (notesByClusterId.has(cluster.id)) {
            orderedClusters.push({
                cluster,
                notes: notesByClusterId.get(cluster.id) || []
            });
        }
    });

    if (!orderedClusters.length) {
        orderedClusters.push({
            cluster: {
                id: 'cluster-1',
                colorIndex: 0,
                label: UNTAGGED_FILTER_LABEL,
                topTags: []
            },
            notes
        });
    }

    const fragment = document.createDocumentFragment();

    orderedClusters.forEach(({ cluster, notes: clusterNotes }) => {
        fragment.append(createClusterSection(cluster, clusterNotes, globalIndex));
        globalIndex += clusterNotes.length;
    });

    notesList.replaceChildren(fragment);
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

async function ensureRelatedNotesLoaded(noteId) {
    const uiState = getNoteUiState(noteId);
    const cachedEntry = getRelatedNotesCacheEntry(noteId);

    if (!uiState.isExpanded || uiState.isLoadingRelated || cachedEntry) {
        return;
    }

    const note = Storage.getById(noteId);

    if (!note) {
        return;
    }

    const requestToken = Date.now() + Math.random();

    setNoteUiState(noteId, {
        isLoadingRelated: true,
        relatedError: '',
        relatedRequestToken: requestToken
    });
    renderNotesList();

    try {
        const related = await requestRelatedNotes(note);
        const latestUiState = getNoteUiState(noteId);

        if (latestUiState.relatedRequestToken !== requestToken) {
            return;
        }

        setRelatedNotesCacheEntry(noteId, related);
        setNoteUiState(noteId, {
            isLoadingRelated: false,
            relatedError: '',
            relatedRequestToken: 0
        });
    } catch (error) {
        const latestUiState = getNoteUiState(noteId);

        if (latestUiState.relatedRequestToken !== requestToken) {
            return;
        }

        setNoteUiState(noteId, {
            isLoadingRelated: false,
            relatedError: error instanceof Error ? error.message : 'Could not load related notes right now.',
            relatedRequestToken: 0
        });
    }

    renderNotesList();
}

function syncExpandedRelatedNotes() {
    Object.entries(state.noteUi).forEach(([noteId, uiState]) => {
        if (uiState?.isExpanded) {
            void ensureRelatedNotesLoaded(noteId);
        }
    });
}

function toggleNoteExpansion(noteId) {
    const isExpanded = getNoteUiState(noteId).isExpanded;

    if (!isExpanded) {
        trackNoteView(noteId, { skipRender: true });
    }

    setNoteUiState(noteId, {
        isExpanded: !isExpanded,
        relatedError: isExpanded ? '' : getNoteUiState(noteId).relatedError
    });
    renderNotesList();

    if (!isExpanded) {
        void ensureRelatedNotesLoaded(noteId);
    }
}

function focusNoteCard(noteId) {
    const escapedNoteId = window.CSS?.escape ? window.CSS.escape(noteId) : noteId;
    const noteCard = document.querySelector(`.note-card[data-note-id="${escapedNoteId}"]`);

    if (!(noteCard instanceof HTMLElement)) {
        return;
    }

    noteCard.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
    });

    const toggleButton = noteCard.querySelector('.note-expand');

    if (toggleButton instanceof HTMLButtonElement) {
        toggleButton.focus({ preventScroll: true });
    }
}

function openNoteInList(noteId, options = {}) {
    const note = Storage.getById(noteId);

    if (!note) {
        setFeedback('That note is no longer available.');
        invalidateRelatedNotesCache();
        renderNotesList();
        return false;
    }

    const isVisible = state.notes.some((entry) => entry.id === noteId);

    if (!isVisible) {
        state.query = '';
        state.activeTagFilter = '';
        resetSearchState();

        const searchInput = document.querySelector('#notes-search');

        if (searchInput instanceof HTMLInputElement) {
            searchInput.value = '';
        }
    }

    if (options.trackView !== false) {
        trackNoteView(noteId, { skipRender: true });
    }

    setActiveLibraryView('list');
    setNoteUiState(noteId, { isExpanded: true });
    renderNotesList();
    void ensureRelatedNotesLoaded(noteId);
    window.requestAnimationFrame(() => {
        focusNoteCard(noteId);
    });

    return true;
}

function openRelatedNote(noteId) {
    return openNoteInList(noteId);
}

function createRelatedNoteCard(note) {
    const button = document.createElement('button');
    const title = document.createElement('span');
    const snippet = document.createElement('span');
    const meta = document.createElement('span');
    const previewText = note.content || note.url || '';

    button.className = 'related-note-card';
    button.type = 'button';
    button.dataset.noteId = note.id;
    button.setAttribute('aria-label', `Open related note ${note.title || 'note'}`);

    title.className = 'related-note-title';
    title.textContent = note.title || (note.type === 'link' ? 'Saved link' : 'Untitled note');

    snippet.className = 'related-note-snippet';
    snippet.textContent = previewText
        ? truncateText(previewText, 110)
        : 'Open this note.';

    meta.className = 'related-note-meta';
    meta.textContent = `${note.type === 'link' ? 'Link' : 'Note'} • ${formatRelativeTime(note.createdAt)}`;

    button.append(title, snippet, meta);

    return button;
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
    const expandButton = document.createElement('button');
    const summarizeButton = document.createElement('button');
    const deleteButton = document.createElement('button');
    const linkPreview = document.createElement('div');
    const sourceMeta = document.createElement('div');
    const bodyText = document.createElement('p');
    const summaryText = document.createElement('p');
    const insightsSection = document.createElement('section');
    const insightsTitle = document.createElement('p');
    const insightsList = document.createElement('ul');
    const insightsStatus = document.createElement('p');
    const errorText = document.createElement('p');
    const tags = document.createElement('div');
    const uiState = getNoteUiState(note.id);
    const isExpanded = uiState.isExpanded;
    const relatedSectionId = `note-related-${note.id}`;
    const relatedEntry = getRelatedNotesCacheEntry(note.id);
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

    expandButton.className = 'note-expand';
    expandButton.type = 'button';
    expandButton.dataset.noteId = note.id;
    expandButton.setAttribute('aria-controls', relatedSectionId);
    expandButton.setAttribute('aria-expanded', String(isExpanded));
    expandButton.setAttribute('aria-label', `${isExpanded ? 'Hide' : 'Show'} related notes for ${note.title || 'note'}`);
    expandButton.textContent = isExpanded ? 'Hide related' : 'Show related';
    actions.append(expandButton);

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

    if (note.sourceDocument?.kind === 'pdf') {
        sourceMeta.className = 'note-source-meta';

        if (note.sourceDocument.fileName) {
            const fileName = document.createElement('span');

            fileName.className = 'note-source-chip';
            fileName.textContent = note.sourceDocument.fileName;
            sourceMeta.append(fileName);
        }

        if (note.sourceDocument.pageCount > 0) {
            const pageCount = document.createElement('span');

            pageCount.className = 'note-source-chip';
            pageCount.textContent = formatCountLabel(note.sourceDocument.pageCount, 'page');
            sourceMeta.append(pageCount);
        }

        if (note.sourceDocument.characterCount > 0) {
            const characterCount = document.createElement('span');

            characterCount.className = 'note-source-chip';
            characterCount.textContent = formatCharacterCount(note.sourceDocument.characterCount);
            sourceMeta.append(characterCount);
        }

        if (sourceMeta.childElementCount) {
            article.append(sourceMeta);
        }
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

        insightsSection.className = 'note-insights';
        insightsTitle.className = 'note-insights-title';
        insightsTitle.textContent = 'Key insights';
        insightsSection.append(insightsTitle);

        if (note.insights.length) {
            insightsList.className = 'note-insights-list';

            note.insights.forEach((insight) => {
                const item = document.createElement('li');

                item.className = 'note-insight-item';
                item.textContent = insight;
                insightsList.append(item);
            });

            insightsSection.append(insightsList);
        } else {
            insightsStatus.className = 'note-insights-status';
            insightsStatus.textContent = uiState.insightsError || 'Pulling out the strongest takeaways...';
            insightsStatus.setAttribute('aria-live', 'polite');

            if (uiState.insightsError) {
                insightsStatus.classList.add('is-error');
            }

            insightsSection.append(insightsStatus);
        }

        article.append(insightsSection);
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

    if (isExpanded) {
        const relatedSection = document.createElement('section');
        const relatedHeader = document.createElement('div');
        const relatedTitle = document.createElement('h3');
        const relatedCaption = document.createElement('p');

        relatedSection.className = 'note-related';
        relatedSection.id = relatedSectionId;

        relatedHeader.className = 'note-related-header';
        relatedTitle.className = 'note-related-title';
        relatedTitle.textContent = 'Related';

        relatedCaption.className = 'note-related-caption';

        if (uiState.isLoadingRelated) {
            relatedCaption.textContent = 'Finding related notes...';
        } else if (uiState.relatedError) {
            relatedCaption.textContent = uiState.relatedError;
            relatedCaption.classList.add('is-error');
        } else if (relatedEntry?.message) {
            relatedCaption.textContent = relatedEntry.message;
        } else if (relatedEntry?.results?.length) {
            relatedCaption.textContent = `Top ${formatCountLabel(relatedEntry.results.length, 'match')}`;
        } else {
            relatedCaption.textContent = 'No related notes yet.';
        }

        relatedHeader.append(relatedTitle, relatedCaption);
        relatedSection.append(relatedHeader);

        if (relatedEntry?.results?.length) {
            const relatedList = document.createElement('div');

            relatedList.className = 'related-notes-list';
            relatedEntry.results.forEach(({ note: relatedNote }) => {
                relatedList.append(createRelatedNoteCard(relatedNote));
            });
            relatedSection.append(relatedList);
        }

        article.append(relatedSection);
    }

    return article;
}

function clearCaptureInputs({
    contentInput,
    urlInput,
    tagsInput,
    tagsTextInput,
    tagsList,
    suggestionsWrap,
    suggestionsList,
    imageControls,
    pdfControls
}) {
    contentInput.value = '';
    urlInput.value = '';
    state.captureTags = [];
    tagsInput.value = '';
    tagsTextInput.value = '';
    renderCaptureTagsInput({ tagsInput, tagsTextInput, tagsList });
    resetCaptureTagSuggestions({ suggestionsWrap, suggestionsList });
    resetCaptureImageState(imageControls);
    resetCapturePdfState(pdfControls);
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

        invalidateRelatedNotesCache();
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

    invalidateRelatedNotesCache();
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
        void loadInsightsForNote(noteId, { force: true });
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
    saveButton,
    imageControls,
    pdfControls
}) {
    if (speechState.isRecording) {
        await stopSpeechCapture('save');
    }

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

    const capturePdfPatch = buildCapturePdfNotePatch();
    let noteToSave = capturePdfPatch
        ? {
            ...nextNote,
            ...capturePdfPatch
        }
        : nextNote;
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

        if (state.captureAutoSummarize && noteToSave.content && !noteToSave.summary) {
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
        } else if (noteToSave.summary) {
            setFeedback(linkMetadataErrorMessage ? 'Saving with PDF summary and raw URL...' : 'Saving with PDF summary...');
            setSaveButtonLabel('Saving...', saveButton);
            successMessage = linkMetadataErrorMessage
                ? 'Saved with PDF summary and raw URL.'
                : 'Saved with PDF summary.';
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
            suggestionsList,
            imageControls,
            pdfControls
        });
        invalidateRelatedNotesCache();
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
    syncClusterData(state.notes);
    syncGraphData(state.notes);
    syncGraphSelection(state.notes);
    syncPatternAnalysis(allNotes);
    syncRevisitSuggestions(allNotes);

    syncOverview(allNotes);
    syncNotesPresentation(allNotes);
    renderRevisitSection(allNotes);
    notesList.classList.toggle('has-results', state.notes.length > 0);
    notesList.classList.toggle('is-clustered', state.notes.length > 0);

    if (!state.notes.length) {
        notesList.replaceChildren(createEmptyState(allNotes));
        renderInsightsView(allNotes);
        renderGraphView();
        renderTimelineView(allNotes);
        return;
    }

    renderClusteredNotesList(notesList, state.notes);
    syncExpandedRelatedNotes();
    ensureVisibleInsights(state.notes);
    renderInsightsView(allNotes);
    renderGraphView();
    renderTimelineView(allNotes);
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
                                <span class="field-label-row">
                                    <span>Note</span>
                                    <button
                                        id="note-mic-button"
                                        class="mic-button"
                                        type="button"
                                        aria-pressed="false"
                                        aria-describedby="capture-mic-status"
                                    >
                                        <span class="mic-indicator" aria-hidden="true"></span>
                                        <span id="note-mic-label">Record note</span>
                                    </button>
                                </span>
                                <textarea id="note-content" rows="6" placeholder="What did you just learn?"></textarea>
                                <div class="mic-meta">
                                    <p id="capture-mic-status" class="mic-status" aria-live="polite">Tap the mic to dictate up to 5 minutes.</p>
                                    <p id="capture-mic-preview" class="mic-preview" hidden></p>
                                </div>
                            </label>

                            <section class="field field-image" aria-labelledby="capture-image-label">
                                <div class="field-label-row">
                                    <span id="capture-image-label">Image text extraction</span>
                                    <input id="note-image-input" type="file" accept="image/png,image/jpeg,image/webp" hidden>
                                    <button id="capture-image-process" class="secondary-button" type="button" disabled>Extract text</button>
                                </div>

                                <div
                                    id="capture-image-dropzone"
                                    class="image-dropzone"
                                    aria-describedby="capture-image-status"
                                >
                                    <div class="image-dropzone-copy">
                                        <p class="image-dropzone-title">Drop an image here</p>
                                        <p class="image-dropzone-text">PNG, JPG, or WebP up to 3 MB. A preview appears here before OCR runs.</p>
                                    </div>

                                    <div class="image-dropzone-actions">
                                        <button id="capture-image-select" class="secondary-button" type="button">Choose image</button>
                                        <button id="capture-image-clear" class="ghost-button" type="button" hidden>Remove</button>
                                    </div>
                                </div>

                                <p id="capture-image-status" class="image-upload-status" aria-live="polite">Drop a PNG, JPG, or WebP image here, or choose one to extract text. Max 3.0 MB.</p>
                                <p id="capture-image-file-name" class="image-file-name" hidden></p>

                                <div id="capture-image-preview-wrap" class="image-preview-wrap" hidden>
                                    <img id="capture-image-preview" class="image-preview" alt="Selected upload preview" hidden>
                                </div>

                                <div id="capture-image-results" class="field image-results" hidden>
                                    <span>Extracted text</span>
                                    <textarea id="capture-image-text" rows="7" readonly placeholder="Extracted text will appear here."></textarea>
                                    <div class="capture-image-actions">
                                        <button id="capture-image-insert" class="ghost-button" type="button" hidden>Insert into note</button>
                                    </div>
                                </div>
                            </section>

                            <section class="field field-document" aria-labelledby="capture-pdf-label">
                                <div class="field-label-row">
                                    <span id="capture-pdf-label">PDF extraction</span>
                                    <input id="note-pdf-input" type="file" accept="application/pdf,.pdf" hidden>
                                    <button id="capture-pdf-process" class="secondary-button" type="button" disabled>Extract text</button>
                                </div>

                                <div
                                    id="capture-pdf-dropzone"
                                    class="image-dropzone"
                                    aria-describedby="capture-pdf-status"
                                >
                                    <div class="image-dropzone-copy">
                                        <p class="image-dropzone-title">Drop a PDF here</p>
                                        <p class="image-dropzone-text">PDF files up to 10 MB. Long documents get an automatic summary after text extraction.</p>
                                    </div>

                                    <div class="image-dropzone-actions">
                                        <button id="capture-pdf-select" class="secondary-button" type="button">Choose PDF</button>
                                        <button id="capture-pdf-clear" class="ghost-button" type="button" hidden>Remove</button>
                                    </div>
                                </div>

                                <p id="capture-pdf-status" class="image-upload-status" aria-live="polite">Drop a PDF here, or choose one to extract text. Max 10.0 MB.</p>
                                <p id="capture-pdf-file-name" class="image-file-name" hidden></p>

                                <div id="capture-pdf-results" class="field image-results" hidden>
                                    <div id="capture-pdf-meta" class="capture-pdf-meta" hidden>
                                        <span id="capture-pdf-page-count" class="capture-pdf-chip" hidden></span>
                                        <span id="capture-pdf-character-count" class="capture-pdf-chip" hidden></span>
                                    </div>
                                    <p id="capture-pdf-summary" class="capture-pdf-summary" hidden></p>
                                    <span>Extracted text</span>
                                    <textarea id="capture-pdf-text" rows="8" readonly placeholder="Extracted PDF text will appear here."></textarea>
                                    <div class="capture-image-actions">
                                        <button id="capture-pdf-insert" class="ghost-button" type="button" hidden>Insert into note</button>
                                    </div>
                                </div>
                            </section>

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

                    <section id="revisit-section" class="revisit-section" hidden>
                        <div class="revisit-section-header">
                            <div>
                                <p class="panel-kicker">Revisit</p>
                                <h3 class="revisit-section-title">Notes to revisit</h3>
                                <p id="revisit-status" class="revisit-status" aria-live="polite">Calculating spaced repetition suggestions...</p>
                            </div>

                            <span id="revisit-count" class="revisit-count">0 notes</span>
                        </div>

                        <div id="revisit-list" class="revisit-list" aria-live="polite"></div>
                    </section>

                    <div class="view-tabs" role="tablist" aria-label="Library views">
                        <button class="view-tab is-active" type="button" role="tab" aria-selected="true" aria-controls="notes-list-view" data-library-view="list">List</button>
                        <button class="view-tab" type="button" role="tab" aria-selected="false" aria-controls="insights-view" tabindex="-1" data-library-view="insights">Insights</button>
                        <button class="view-tab" type="button" role="tab" aria-selected="false" aria-controls="graph-view" tabindex="-1" data-library-view="graph">Graph</button>
                        <button class="view-tab" type="button" role="tab" aria-selected="false" aria-controls="timeline-view" tabindex="-1" data-library-view="timeline">Timeline</button>
                    </div>

                    <div id="notes-list-view" class="library-view-panel">
                        <div id="notes-list" class="notes-list" aria-live="polite"></div>
                    </div>

                    <section id="insights-view" class="insights-view" hidden>
                        <div class="insights-panel-header">
                            <div class="insights-copy">
                                <p class="panel-kicker">Patterns</p>
                                <h3 class="insights-title">Learning insights</h3>
                                <p id="insights-summary" class="insights-summary">Patterns across your full saved library.</p>
                            </div>

                            <span id="insights-status" class="insights-status" aria-live="polite">Analyzing patterns...</span>
                        </div>

                        <section id="knowledge-health" class="knowledge-health" aria-live="polite"></section>

                        <div id="insights-stats" class="insights-stats" aria-live="polite"></div>

                        <div class="insights-grid">
                            <section class="insights-section">
                                <div class="insights-section-header">
                                    <p class="insights-section-kicker">Top topics</p>
                                    <p class="insights-section-meta">Top 5 recurring themes from tags and note content.</p>
                                </div>
                                <div id="insights-topics" class="insights-topics" aria-live="polite"></div>
                            </section>

                            <section class="insights-section">
                                <div class="insights-section-header">
                                    <p class="insights-section-kicker">Weekly trend</p>
                                    <p class="insights-section-meta">A CSS-only snapshot of recent activity.</p>
                                </div>
                                <div id="insights-trend" class="insights-trend" aria-live="polite"></div>
                            </section>
                        </div>
                    </section>

                    <section id="graph-view" class="graph-view" hidden>
                        <div class="graph-panel-header">
                            <p id="graph-hint" class="graph-hint">Drag notes to rearrange. Scroll to zoom. Drag the background to pan.</p>
                            <span id="graph-count" class="graph-count">0 nodes</span>
                        </div>

                        <div id="graph-legend" class="graph-legend" aria-label="Cluster legend" hidden></div>

                        <div class="graph-stage">
                            <div class="graph-canvas-shell">
                                <canvas id="notes-graph-canvas" class="graph-canvas" aria-label="Knowledge graph"></canvas>
                                <div id="graph-empty-state" class="graph-empty-state">
                                    <p class="graph-empty-title">No graph yet.</p>
                                    <p class="graph-empty-copy">Save a few notes or links and their connections will appear here.</p>
                                </div>
                            </div>

                            <aside id="graph-note-panel" class="graph-note-panel" aria-live="polite"></aside>
                        </div>
                    </section>

                    <section id="timeline-view" class="timeline-view" hidden>
                        <div class="timeline-panel-header">
                            <p id="timeline-hint" class="timeline-hint">Recent entries are grouped by day. Older entries roll up by week.</p>
                            <span id="timeline-count" class="timeline-count">0 entries</span>
                        </div>

                        <div id="notes-timeline" class="notes-timeline" aria-live="polite"></div>
                    </section>
                </section>
            </div>
        </main>
    `;

    const contentInput = document.querySelector('#note-content');
    const micButton = document.querySelector('#note-mic-button');
    const urlInput = document.querySelector('#note-url');
    const imageInput = document.querySelector('#note-image-input');
    const imageDropzone = document.querySelector('#capture-image-dropzone');
    const imageSelectButton = document.querySelector('#capture-image-select');
    const imageProcessButton = document.querySelector('#capture-image-process');
    const imageClearButton = document.querySelector('#capture-image-clear');
    const imageInsertButton = document.querySelector('#capture-image-insert');
    const pdfInput = document.querySelector('#note-pdf-input');
    const pdfDropzone = document.querySelector('#capture-pdf-dropzone');
    const pdfSelectButton = document.querySelector('#capture-pdf-select');
    const pdfProcessButton = document.querySelector('#capture-pdf-process');
    const pdfClearButton = document.querySelector('#capture-pdf-clear');
    const pdfInsertButton = document.querySelector('#capture-pdf-insert');
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
    const revisitSection = document.querySelector('#revisit-section');
    const notesList = document.querySelector('#notes-list');
    const graphNotePanel = document.querySelector('#graph-note-panel');
    const timelineView = document.querySelector('#timeline-view');
    const themeToggle = document.querySelector('#theme-toggle');
    const captureImageControls = getCaptureImageControls();
    const capturePdfControls = getCapturePdfControls();
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
    renderCaptureImage(captureImageControls);
    renderCapturePdf(capturePdfControls);
    applyThemePreference();
    speechState.statusMessage = getSpeechDefaultMessage();
    updateSpeechUi();

    themeToggle.addEventListener('click', () => {
        toggleThemePreference();
    });

    micButton?.addEventListener('click', async () => {
        await toggleSpeechCapture();
    });

    document.querySelectorAll('.view-tab').forEach((button) => {
        button.addEventListener('click', () => {
            setActiveLibraryView(button.dataset.libraryView);
        });
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
                saveButton,
                imageControls: captureImageControls,
                pdfControls: capturePdfControls
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

    imageSelectButton?.addEventListener('click', () => {
        imageInput?.click();
    });

    imageDropzone?.addEventListener('click', (event) => {
        const target = event.target instanceof HTMLElement ? event.target.closest('button') : null;

        if (target) {
            return;
        }

        imageInput?.click();
    });

    imageInput?.addEventListener('change', async (event) => {
        const file = event.target instanceof HTMLInputElement ? event.target.files?.[0] : null;

        if (!file) {
            return;
        }

        await selectCaptureImage(file, captureImageControls);
    });

    imageProcessButton?.addEventListener('click', async () => {
        await processCaptureImage(captureImageControls);
    });

    imageClearButton?.addEventListener('click', () => {
        resetCaptureImageState(captureImageControls);
        setFeedback('Image cleared.');
    });

    imageInsertButton?.addEventListener('click', () => {
        insertCaptureImageText(contentInput, captureImageControls);
    });

    pdfSelectButton?.addEventListener('click', () => {
        pdfInput?.click();
    });

    pdfDropzone?.addEventListener('click', (event) => {
        const target = event.target instanceof HTMLElement ? event.target.closest('button') : null;

        if (target) {
            return;
        }

        pdfInput?.click();
    });

    pdfInput?.addEventListener('change', async (event) => {
        const file = event.target instanceof HTMLInputElement ? event.target.files?.[0] : null;

        if (!file) {
            return;
        }

        await selectCapturePdf(file, capturePdfControls);
    });

    pdfProcessButton?.addEventListener('click', async () => {
        await processCapturePdf(capturePdfControls);
    });

    pdfClearButton?.addEventListener('click', () => {
        resetCapturePdfState(capturePdfControls);
        setFeedback('PDF cleared.');
    });

    pdfInsertButton?.addEventListener('click', () => {
        insertCapturePdfText(contentInput, capturePdfControls);
    });

    if (imageDropzone) {
        let dragDepth = 0;

        ['dragenter', 'dragover'].forEach((eventName) => {
            imageDropzone.addEventListener(eventName, (event) => {
                event.preventDefault();
                dragDepth += eventName === 'dragenter' ? 1 : 0;
                setCaptureImageState({ isDragActive: true }, captureImageControls);
            });
        });

        imageDropzone.addEventListener('dragleave', (event) => {
            event.preventDefault();
            dragDepth = Math.max(0, dragDepth - 1);

            if (dragDepth === 0) {
                setCaptureImageState({ isDragActive: false }, captureImageControls);
            }
        });

        imageDropzone.addEventListener('drop', async (event) => {
            event.preventDefault();
            dragDepth = 0;

            const file = event.dataTransfer?.files?.[0] || null;

            if (!file) {
                setCaptureImageState({ isDragActive: false }, captureImageControls);
                return;
            }

            await selectCaptureImage(file, captureImageControls);
        });
    }

    if (pdfDropzone) {
        let dragDepth = 0;

        ['dragenter', 'dragover'].forEach((eventName) => {
            pdfDropzone.addEventListener(eventName, (event) => {
                event.preventDefault();
                dragDepth += eventName === 'dragenter' ? 1 : 0;
                setCapturePdfState({ isDragActive: true }, capturePdfControls);
            });
        });

        pdfDropzone.addEventListener('dragleave', (event) => {
            event.preventDefault();
            dragDepth = Math.max(0, dragDepth - 1);

            if (dragDepth === 0) {
                setCapturePdfState({ isDragActive: false }, capturePdfControls);
            }
        });

        pdfDropzone.addEventListener('drop', async (event) => {
            event.preventDefault();
            dragDepth = 0;

            const file = event.dataTransfer?.files?.[0] || null;

            if (!file) {
                setCapturePdfState({ isDragActive: false }, capturePdfControls);
                return;
            }

            await selectCapturePdf(file, capturePdfControls);
        });
    }

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

    revisitSection?.addEventListener('click', (event) => {
        const target = event.target instanceof HTMLElement
            ? event.target.closest('[data-revisit-action]')
            : null;

        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        if (target.dataset.revisitAction === 'open-note') {
            openNoteInList(target.dataset.noteId);
            return;
        }

        if (target.dataset.revisitAction === 'mark-reviewed') {
            const reviewed = markNoteReviewed(target.dataset.noteId);

            if (!reviewed) {
                setFeedback('That note could not be marked as reviewed.');
            }
        }
    });

    notesList.addEventListener('click', async (event) => {
        const target = event.target instanceof HTMLElement
            ? event.target.closest('button')
            : null;

        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        if (target.matches('.note-expand')) {
            toggleNoteExpansion(target.dataset.noteId);
            return;
        }

        if (target.matches('.related-note-card')) {
            openRelatedNote(target.dataset.noteId);
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
            invalidateRelatedNotesCache();
            clearNoteUiState(target.dataset.noteId, { force: true });
            refreshVisibleNotes();
        } catch (error) {
            console.error('Failed to delete note.', error);
            setFeedback('That note could not be deleted.');
        }
    });

    graphNotePanel?.addEventListener('click', (event) => {
        const target = event.target instanceof HTMLElement
            ? event.target.closest('[data-graph-action="open-in-list"]')
            : null;

        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        openNoteInList(target.dataset.noteId);
    });

    timelineView?.addEventListener('click', (event) => {
        const target = event.target instanceof HTMLElement
            ? event.target.closest('[data-timeline-action="open-in-list"]')
            : null;

        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        openNoteInList(target.dataset.noteId);
    });

    renderNotesList();
    syncLibraryView();
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

window.addEventListener('pagehide', () => {
    clearSpeechAutoStopTimer();

    if (!speechState.recognition || !speechState.isRecording) {
        return;
    }

    try {
        speechState.requestedStop = true;
        speechState.recognition.abort();
    } catch (error) {
        console.error('Failed to abort speech recognition on page hide.', error);
    }
});
