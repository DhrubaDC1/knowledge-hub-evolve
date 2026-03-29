const DAY_IN_MS = 24 * 60 * 60 * 1000;
const INITIAL_REVIEW_INTERVAL_DAYS = 1;
const REVIEW_INTERVALS_DAYS = [3, 7, 14, 30, 60, 120];
const DEFAULT_SUGGESTION_LIMIT = 4;
const DUE_SOON_WINDOW_DAYS = 2;
const VIEW_HISTORY_LIMIT = 24;
const REVIEW_HISTORY_LIMIT = 16;
const MIN_VIEW_LOG_INTERVAL_MS = 45 * 1000;

function parsePositiveInteger(value) {
    const normalizedValue = Number(value);

    if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
        return 0;
    }

    return Math.round(normalizedValue);
}

function isValidDateValue(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return false;
    }

    return !Number.isNaN(new Date(value).getTime());
}

function normalizeDateValue(value) {
    return isValidDateValue(value)
        ? new Date(value).toISOString()
        : '';
}

function clampHistory(values, limit) {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .map((value) => normalizeDateValue(value))
        .filter(Boolean)
        .slice(-limit);
}

function addDays(dateValue, days) {
    const timestamp = new Date(dateValue).getTime();

    if (Number.isNaN(timestamp)) {
        return '';
    }

    return new Date(timestamp + (days * DAY_IN_MS)).toISOString();
}

function getUtcStartOfDayTimestamp(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return Number.NaN;
    }

    return Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
    );
}

function getNextIntervalDays(reviewCount) {
    if (reviewCount <= 0) {
        return INITIAL_REVIEW_INTERVAL_DAYS;
    }

    return REVIEW_INTERVALS_DAYS[Math.min(reviewCount - 1, REVIEW_INTERVALS_DAYS.length - 1)];
}

function getSeedDate(note, revisit) {
    return revisit.lastViewedAt || normalizeDateValue(note?.createdAt) || new Date().toISOString();
}

function createStatusFromDays(daysUntilDue) {
    if (daysUntilDue < 0) {
        return 'overdue';
    }

    if (daysUntilDue === 0) {
        return 'today';
    }

    return 'soon';
}

function buildSuggestionReason({ reviewCount, lastReviewedAt, lastViewedAt, daysUntilDue }) {
    if (daysUntilDue < 0) {
        return `Overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? '' : 's'}.`;
    }

    if (daysUntilDue === 0) {
        return 'Due today.';
    }

    if (lastReviewedAt) {
        return reviewCount <= 1
            ? 'Recently reviewed once. Reinforce it before it fades.'
            : `Reviewed ${reviewCount} times. Scheduled for the next interval.`;
    }

    if (lastViewedAt) {
        return 'You looked at this recently but have not marked it reviewed yet.';
    }

    return 'New note. Revisit it once the first spacing window opens.';
}

export function createEmptyRevisitState() {
    return {
        reviewCount: 0,
        viewCount: 0,
        lastViewedAt: '',
        lastReviewedAt: '',
        nextReviewAt: '',
        viewHistory: [],
        reviewHistory: []
    };
}

export function normalizeRevisitState(value = {}) {
    const revisit = value && typeof value === 'object' ? value : {};
    const viewHistory = clampHistory(revisit.viewHistory, VIEW_HISTORY_LIMIT);
    const reviewHistory = clampHistory(revisit.reviewHistory, REVIEW_HISTORY_LIMIT);
    const lastViewedAt = normalizeDateValue(revisit.lastViewedAt) || viewHistory.at(-1) || '';
    const lastReviewedAt = normalizeDateValue(revisit.lastReviewedAt) || reviewHistory.at(-1) || '';

    return {
        reviewCount: Math.max(parsePositiveInteger(revisit.reviewCount), reviewHistory.length),
        viewCount: Math.max(parsePositiveInteger(revisit.viewCount), viewHistory.length),
        lastViewedAt,
        lastReviewedAt,
        nextReviewAt: normalizeDateValue(revisit.nextReviewAt),
        viewHistory,
        reviewHistory
    };
}

export function buildViewUpdate(note = {}, options = {}) {
    const revisit = normalizeRevisitState(note.revisit);
    const viewedAt = normalizeDateValue(options.viewedAt) || new Date().toISOString();
    const lastViewedAtTimestamp = revisit.lastViewedAt ? new Date(revisit.lastViewedAt).getTime() : 0;
    const viewedAtTimestamp = new Date(viewedAt).getTime();

    if (lastViewedAtTimestamp && (viewedAtTimestamp - lastViewedAtTimestamp) < MIN_VIEW_LOG_INTERVAL_MS) {
        return revisit;
    }

    return {
        ...revisit,
        viewCount: revisit.viewCount + 1,
        lastViewedAt: viewedAt,
        viewHistory: [...revisit.viewHistory, viewedAt].slice(-VIEW_HISTORY_LIMIT)
    };
}

export function buildReviewUpdate(note = {}, options = {}) {
    const reviewedAt = normalizeDateValue(options.reviewedAt) || new Date().toISOString();
    const viewedRevisit = buildViewUpdate(note, { viewedAt: reviewedAt });
    const reviewCount = viewedRevisit.reviewCount + 1;
    const nextReviewAt = addDays(reviewedAt, getNextIntervalDays(reviewCount));

    return {
        ...viewedRevisit,
        reviewCount,
        lastReviewedAt: reviewedAt,
        nextReviewAt,
        reviewHistory: [...viewedRevisit.reviewHistory, reviewedAt].slice(-REVIEW_HISTORY_LIMIT)
    };
}

export function createRevisitSuggestionsFingerprint(notes = []) {
    return (Array.isArray(notes) ? notes : [])
        .map((note) => {
            const revisit = normalizeRevisitState(note?.revisit);
            const noteId = note?.id ? String(note.id) : '';

            if (!noteId) {
                return '';
            }

            return [
                noteId,
                normalizeDateValue(note?.createdAt),
                normalizeDateValue(note?.updatedAt),
                revisit.reviewCount,
                revisit.viewCount,
                revisit.lastViewedAt,
                revisit.lastReviewedAt,
                revisit.nextReviewAt
            ].join(':');
        })
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .join('||');
}

export function suggestRevisitNotes(notes = [], options = {}) {
    const now = normalizeDateValue(options.now) || new Date().toISOString();
    const nowTimestamp = new Date(now).getTime();
    const nowDayTimestamp = getUtcStartOfDayTimestamp(now);
    const limit = Math.max(1, parsePositiveInteger(options.limit) || DEFAULT_SUGGESTION_LIMIT);

    return (Array.isArray(notes) ? notes : [])
        .map((note) => {
            const noteId = note?.id ? String(note.id) : '';
            const title = typeof note?.title === 'string' ? note.title.trim() : '';
            const content = typeof note?.content === 'string' ? note.content.trim() : '';
            const summary = typeof note?.summary === 'string' ? note.summary.trim() : '';

            if (!noteId || (!title && !content && !summary)) {
                return null;
            }

            const revisit = normalizeRevisitState(note.revisit);
            const dueAt = revisit.nextReviewAt || addDays(
                revisit.lastReviewedAt || getSeedDate(note, revisit),
                revisit.lastReviewedAt ? getNextIntervalDays(revisit.reviewCount) : INITIAL_REVIEW_INTERVAL_DAYS
            );
            const dueTimestamp = new Date(dueAt).getTime();
            const dueDayTimestamp = getUtcStartOfDayTimestamp(dueAt);

            if (Number.isNaN(dueTimestamp) || Number.isNaN(dueDayTimestamp) || Number.isNaN(nowDayTimestamp)) {
                return null;
            }

            const daysUntilDue = Math.round((dueDayTimestamp - nowDayTimestamp) / DAY_IN_MS);

            if (daysUntilDue > DUE_SOON_WINDOW_DAYS) {
                return null;
            }

            const daysOverdue = Math.max(0, Math.round((nowDayTimestamp - dueDayTimestamp) / DAY_IN_MS));
            const status = createStatusFromDays(daysUntilDue);
            const priorityScore = (daysOverdue * 100)
                + (Math.max(0, DUE_SOON_WINDOW_DAYS - Math.max(daysUntilDue, 0)) * 10)
                + Math.min(revisit.viewCount, 12)
                - (revisit.reviewCount * 3);

            return {
                noteId,
                dueAt,
                status,
                daysUntilDue,
                daysOverdue,
                reviewCount: revisit.reviewCount,
                viewCount: revisit.viewCount,
                lastViewedAt: revisit.lastViewedAt,
                lastReviewedAt: revisit.lastReviewedAt,
                nextIntervalDays: revisit.lastReviewedAt
                    ? getNextIntervalDays(revisit.reviewCount)
                    : INITIAL_REVIEW_INTERVAL_DAYS,
                priorityScore,
                reason: buildSuggestionReason({
                    reviewCount: revisit.reviewCount,
                    lastReviewedAt: revisit.lastReviewedAt,
                    lastViewedAt: revisit.lastViewedAt,
                    daysUntilDue
                })
            };
        })
        .filter(Boolean)
        .sort((left, right) => {
            if (right.priorityScore !== left.priorityScore) {
                return right.priorityScore - left.priorityScore;
            }

            if (left.daysUntilDue !== right.daysUntilDue) {
                return left.daysUntilDue - right.daysUntilDue;
            }

            return left.noteId.localeCompare(right.noteId);
        })
        .slice(0, limit);
}
