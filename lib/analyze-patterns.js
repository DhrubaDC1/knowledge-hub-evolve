const TOPIC_STOP_WORDS = new Set([
    'a',
    'about',
    'after',
    'all',
    'also',
    'an',
    'and',
    'any',
    'are',
    'as',
    'at',
    'be',
    'because',
    'been',
    'before',
    'being',
    'but',
    'by',
    'can',
    'could',
    'did',
    'do',
    'does',
    'doing',
    'done',
    'for',
    'from',
    'get',
    'got',
    'had',
    'has',
    'have',
    'how',
    'i',
    'if',
    'in',
    'into',
    'is',
    'it',
    'its',
    'just',
    'like',
    'make',
    'many',
    'more',
    'most',
    'my',
    'new',
    'note',
    'not',
    'now',
    'of',
    'on',
    'one',
    'or',
    'our',
    'out',
    'over',
    'really',
    'so',
    'some',
    'still',
    'such',
    'than',
    'that',
    'the',
    'their',
    'them',
    'then',
    'there',
    'these',
    'they',
    'this',
    'those',
    'through',
    'to',
    'up',
    'use',
    'using',
    'very',
    'was',
    'we',
    'were',
    'what',
    'when',
    'where',
    'which',
    'while',
    'who',
    'why',
    'with',
    'would',
    'summary',
    'saved',
    'item',
    'link',
    'you',
    'your'
]);

function normalizeTag(tag) {
    return typeof tag === 'string' ? tag.trim().toLowerCase() : '';
}

function normalizeToken(token) {
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

function tokenize(value) {
    const matches = String(value || '').toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || [];

    return matches
        .map((token) => normalizeToken(token))
        .filter((token) => token.length > 2 && !TOPIC_STOP_WORDS.has(token));
}

function getDateKey(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function createEmptyAnalysis() {
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

function normalizeNote(note = {}) {
    if (!note || typeof note !== 'object') {
        return null;
    }

    const title = typeof note.title === 'string' ? note.title.trim() : '';
    const content = typeof note.content === 'string' ? note.content.trim() : '';
    const summary = typeof note.summary === 'string' ? note.summary.trim() : '';
    const createdAt = typeof note.createdAt === 'string' ? note.createdAt : '';
    const tags = Array.isArray(note.tags)
        ? [...new Set(note.tags.map(normalizeTag).filter(Boolean))]
        : [];

    if (!title && !content && !summary && !tags.length) {
        return null;
    }

    return {
        title,
        content,
        summary,
        createdAt,
        tags
    };
}

function addTopicScore(topicMap, topic, weight) {
    if (!topic || !Number.isFinite(weight) || weight <= 0) {
        return;
    }

    const currentValue = topicMap.get(topic) || 0;

    topicMap.set(topic, currentValue + weight);
}

function collectTopics(notes = []) {
    const topicScores = new Map();
    const topicNoteCounts = new Map();

    notes.forEach((note) => {
        const perNoteScores = new Map();

        note.tags.forEach((tag) => {
            addTopicScore(perNoteScores, tag, 3.4);
        });

        [...new Set(tokenize(note.title))].forEach((token) => {
            addTopicScore(perNoteScores, token, 1.8);
        });

        [...new Set(tokenize(note.summary))].forEach((token) => {
            addTopicScore(perNoteScores, token, 1.3);
        });

        [...new Set(tokenize(note.content).slice(0, 24))].forEach((token) => {
            addTopicScore(perNoteScores, token, 0.75);
        });

        perNoteScores.forEach((score, topic) => {
            addTopicScore(topicScores, topic, score);
            topicNoteCounts.set(topic, (topicNoteCounts.get(topic) || 0) + 1);
        });
    });

    return {
        topicScores,
        topicNoteCounts
    };
}

function sortTopics(left, right) {
    if (right.score !== left.score) {
        return right.score - left.score;
    }

    if (right.count !== left.count) {
        return right.count - left.count;
    }

    return left.topic.localeCompare(right.topic);
}

function buildTopTopics(topicScores, topicNoteCounts, noteCount) {
    return [...topicScores.entries()]
        .map(([topic, score]) => {
            const count = topicNoteCounts.get(topic) || 0;

            return {
                topic,
                score: Number(score.toFixed(2)),
                count,
                share: noteCount > 0 ? Math.round((count / noteCount) * 100) : 0
            };
        })
        .sort(sortTopics)
        .slice(0, 5);
}

function calculateLearningStreak(notes = []) {
    const activeDates = [...new Set(
        notes
            .map((note) => getDateKey(note.createdAt))
            .filter(Boolean)
    )].sort();

    if (!activeDates.length) {
        return {
            current: 0,
            longest: 0,
            activeDays: 0,
            lastActiveDate: ''
        };
    }

    let longest = 1;
    let running = 1;

    for (let index = 1; index < activeDates.length; index += 1) {
        const previousDate = new Date(`${activeDates[index - 1]}T00:00:00.000Z`);
        const currentDate = new Date(`${activeDates[index]}T00:00:00.000Z`);
        const dayDifference = Math.round((currentDate - previousDate) / 86_400_000);

        if (dayDifference === 1) {
            running += 1;
            longest = Math.max(longest, running);
        } else {
            running = 1;
        }
    }

    let current = 1;

    for (let index = activeDates.length - 1; index > 0; index -= 1) {
        const currentDate = new Date(`${activeDates[index]}T00:00:00.000Z`);
        const previousDate = new Date(`${activeDates[index - 1]}T00:00:00.000Z`);
        const dayDifference = Math.round((currentDate - previousDate) / 86_400_000);

        if (dayDifference !== 1) {
            break;
        }

        current += 1;
    }

    return {
        current,
        longest,
        activeDays: activeDates.length,
        lastActiveDate: activeDates.at(-1) || ''
    };
}

function calculateWeeklyTrend(notes = []) {
    const countsByDay = notes.reduce((countMap, note) => {
        const dateKey = getDateKey(note.createdAt);

        if (!dateKey) {
            return countMap;
        }

        countMap.set(dateKey, (countMap.get(dateKey) || 0) + 1);
        return countMap;
    }, new Map());
    const today = new Date();
    const startOfToday = new Date(Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate()
    ));
    const formatter = new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' });
    const days = [];
    let currentTotal = 0;
    let previousTotal = 0;

    for (let offset = 13; offset >= 0; offset -= 1) {
        const day = new Date(startOfToday);

        day.setUTCDate(startOfToday.getUTCDate() - offset);

        const dateKey = getDateKey(day.toISOString());
        const count = countsByDay.get(dateKey) || 0;

        if (offset <= 6) {
            days.push({
                date: dateKey,
                label: formatter.format(day),
                count
            });
            currentTotal += count;
        } else {
            previousTotal += count;
        }
    }

    const delta = currentTotal - previousTotal;
    const direction = delta === 0 ? 'steady' : (delta > 0 ? 'up' : 'down');

    return {
        days,
        currentTotal,
        previousTotal,
        delta,
        direction
    };
}

function calculateDiversityScore(topicScores) {
    const topics = [...topicScores.values()].filter((value) => Number.isFinite(value) && value > 0);

    if (!topics.length) {
        return {
            score: 0,
            label: 'Narrow',
            uniqueTopics: 0
        };
    }

    const totalWeight = topics.reduce((sum, value) => sum + value, 0);
    const uniqueTopics = topics.length;

    if (!totalWeight || uniqueTopics === 1) {
        return {
            score: Math.min(20, uniqueTopics * 10),
            label: 'Narrow',
            uniqueTopics
        };
    }

    const entropy = topics.reduce((sum, value) => {
        const probability = value / totalWeight;

        return sum - (probability * Math.log(probability));
    }, 0);
    const normalizedEntropy = entropy / Math.log(uniqueTopics);
    const breadth = Math.min(1, uniqueTopics / 12);
    const score = Math.round(((normalizedEntropy * 0.7) + (breadth * 0.3)) * 100);
    const label = score >= 70
        ? 'Broad'
        : (score >= 40 ? 'Balanced' : 'Focused');

    return {
        score,
        label,
        uniqueTopics
    };
}

export function analyzePatterns(notes = []) {
    const normalizedNotes = (Array.isArray(notes) ? notes : [])
        .map((note) => normalizeNote(note))
        .filter(Boolean);

    if (!normalizedNotes.length) {
        return createEmptyAnalysis();
    }

    const { topicScores, topicNoteCounts } = collectTopics(normalizedNotes);

    return {
        topTopics: buildTopTopics(topicScores, topicNoteCounts, normalizedNotes.length),
        learningStreak: calculateLearningStreak(normalizedNotes),
        weeklyTrend: calculateWeeklyTrend(normalizedNotes),
        diversityScore: calculateDiversityScore(topicScores)
    };
}
