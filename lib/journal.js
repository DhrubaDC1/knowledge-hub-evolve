import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JOURNAL_PATH = path.resolve(__dirname, '..', 'JOURNAL.md');

function parseBulletList(sectionText) {
    return sectionText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2).trim());
}

function stripWrappingBackticks(value) {
    const text = String(value || '').trim();

    if (!text) {
        return '';
    }

    if ((text.startsWith('`') && text.endsWith('`')) || (text.startsWith('``') && text.endsWith('``'))) {
        return text.replace(/^`+|`+$/g, '').trim();
    }

    return text;
}

function parseKeyValueList(sectionText) {
    return Object.fromEntries(
        parseBulletList(sectionText)
            .map((line) => {
                const separatorIndex = line.indexOf(':');

                if (separatorIndex === -1) {
                    return null;
                }

                return [
                    line.slice(0, separatorIndex).trim(),
                    stripWrappingBackticks(line.slice(separatorIndex + 1))
                ];
            })
            .filter(Boolean)
    );
}

function splitSections(markdown) {
    const sections = {};
    const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];

    matches.forEach((match, index) => {
        const title = match[1].trim();
        const start = match.index + match[0].length;
        const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length;

        sections[title] = markdown.slice(start, end).trim();
    });

    return sections;
}

function cleanTitleValue(value) {
    return stripWrappingBackticks(String(value || '').replace(/`/g, '').trim());
}

function parseDelimitedValues(value) {
    return stripWrappingBackticks(value)
        .split(',')
        .map((item) => stripWrappingBackticks(item))
        .filter(Boolean);
}

function parseTimelineEntry(line) {
    const match = line.match(/^(\S+)\s+\[([^\]]+)\]\s+(.+)$/);

    if (!match) {
        return null;
    }

    const [, timestamp, label, rawBody] = match;
    const body = rawBody.trim();
    const separatorIndex = body.indexOf(': ');
    const hasSplitBody = separatorIndex > 0 && separatorIndex < 140;
    const title = cleanTitleValue(hasSplitBody ? body.slice(0, separatorIndex) : body);
    const details = hasSplitBody ? cleanTitleValue(body.slice(separatorIndex + 2)) : '';
    const branchMatch = body.match(/branch `([^`]+)`/);
    const itemMatch = body.match(/`([^`]+)`/);

    return {
        timestamp,
        label,
        title,
        details,
        branch: branchMatch ? branchMatch[1] : '',
        item: itemMatch ? itemMatch[1] : ''
    };
}

function groupEntriesByDate(entries) {
    const dateKeysAscending = [...new Set(
        entries
            .map((entry) => entry.timestamp.slice(0, 10))
            .sort((left, right) => left.localeCompare(right))
    )];
    const dayNumberByDate = new Map(
        dateKeysAscending.map((dateKey, index) => [dateKey, index + 1])
    );
    const groups = [];

    entries.forEach((entry) => {
        const dateKey = entry.timestamp.slice(0, 10);
        const lastGroup = groups.at(-1);

        if (!lastGroup || lastGroup.dateKey !== dateKey) {
            groups.push({
                dateKey,
                dayNumber: dayNumberByDate.get(dateKey) || 1,
                entries: [entry]
            });
            return;
        }

        lastGroup.entries.push(entry);
    });

    return groups;
}

export async function readJournalData() {
    const markdown = await readFile(JOURNAL_PATH, 'utf8');
    const sections = splitSections(markdown);
    const headingMatch = markdown.match(/^#\s+(.+)$/m);
    const bootstrappedMatch = markdown.match(/_Bootstrapped from existing automation logs on ([^_]+)\._/);
    const snapshot = parseKeyValueList(sections['Current State Snapshot'] || '');
    const recentGitHistory = parseBulletList(sections['Recent Git History'] || '');
    const reconstructedTimeline = parseBulletList(sections['Reconstructed Timeline'] || '');
    const liveEntries = parseBulletList(sections['Live Timeline'] || '')
        .map(parseTimelineEntry)
        .filter(Boolean)
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp));

    return {
        title: headingMatch ? headingMatch[1].trim() : 'Journal',
        bootstrappedAt: bootstrappedMatch ? bootstrappedMatch[1].trim() : '',
        snapshot: {
            phase: snapshot.Phase || '',
            taskIndex: snapshot['Task index'] || '',
            completedTasks: parseDelimitedValues(snapshot['Completed tasks']),
            failedTasks: parseDelimitedValues(snapshot['Failed tasks']),
            completedIssues: parseDelimitedValues(snapshot['Completed issues']),
            failedIssues: parseDelimitedValues(snapshot['Failed issues']),
            iterations: snapshot.Iterations || '',
            commits: snapshot.Commits || ''
        },
        recentGitHistory: recentGitHistory.map(stripWrappingBackticks),
        reconstructedTimeline,
        entries: liveEntries,
        groupedEntries: groupEntriesByDate(liveEntries)
    };
}
