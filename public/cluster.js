function normalizeTag(tag) {
    return typeof tag === 'string' ? tag.trim().toLowerCase() : '';
}

function normalizeTitle(note = {}) {
    if (typeof note.title === 'string' && note.title.trim()) {
        return note.title.trim();
    }

    if (typeof note.content === 'string' && note.content.trim()) {
        return note.content.trim().split('\n').find(Boolean)?.trim() || 'Untitled note';
    }

    if (typeof note.url === 'string' && note.url.trim()) {
        return note.url.trim();
    }

    return 'Untitled note';
}

function normalizeNote(note = {}, index = 0) {
    if (!note || typeof note !== 'object') {
        return null;
    }

    const id = note.id ? String(note.id) : '';

    if (!id) {
        return null;
    }

    const tags = Array.isArray(note.tags)
        ? [...new Set(note.tags.map(normalizeTag).filter(Boolean))]
        : [];

    return {
        id,
        title: normalizeTitle(note),
        tags,
        order: index
    };
}

function createUnionFind(ids = []) {
    const parent = new Map(ids.map((id) => [id, id]));

    function find(id) {
        const currentParent = parent.get(id);

        if (!currentParent || currentParent === id) {
            return id;
        }

        const root = find(currentParent);
        parent.set(id, root);
        return root;
    }

    function union(leftId, rightId) {
        const leftRoot = find(leftId);
        const rightRoot = find(rightId);

        if (!leftRoot || !rightRoot || leftRoot === rightRoot) {
            return;
        }

        parent.set(rightRoot, leftRoot);
    }

    return {
        find,
        union
    };
}

function sortTagEntries(left, right) {
    if (right.count !== left.count) {
        return right.count - left.count;
    }

    return left.tag.localeCompare(right.tag);
}

function createClusterLabel(topTags = []) {
    if (!topTags.length) {
        return 'untagged';
    }

    return topTags.slice(0, 2).join(' + ');
}

function compareClusters(left, right) {
    if (right.size !== left.size) {
        return right.size - left.size;
    }

    return left.label.localeCompare(right.label);
}

export function clusterNotesByOverlappingTags(notes = []) {
    const normalizedNotes = (Array.isArray(notes) ? notes : [])
        .map((note, index) => normalizeNote(note, index))
        .filter(Boolean);

    if (!normalizedNotes.length) {
        return {
            clusterCount: 0,
            clusters: [],
            noteClusterMap: {}
        };
    }

    const unionFind = createUnionFind(normalizedNotes.map((note) => note.id));
    const noteIdsByTag = normalizedNotes.reduce((tagMap, note) => {
        note.tags.forEach((tag) => {
            if (!tagMap.has(tag)) {
                tagMap.set(tag, []);
            }

            tagMap.get(tag).push(note.id);
        });

        return tagMap;
    }, new Map());

    noteIdsByTag.forEach((noteIds) => {
        const [firstNoteId, ...remainingNoteIds] = noteIds;

        remainingNoteIds.forEach((noteId) => {
            unionFind.union(firstNoteId, noteId);
        });
    });

    const notesByRoot = normalizedNotes.reduce((rootMap, note) => {
        const rootId = unionFind.find(note.id);

        if (!rootMap.has(rootId)) {
            rootMap.set(rootId, []);
        }

        rootMap.get(rootId).push(note);
        return rootMap;
    }, new Map());

    const clusters = [...notesByRoot.values()]
        .map((clusterNotes) => {
            const tagCounts = clusterNotes.reduce((counts, note) => {
                note.tags.forEach((tag) => {
                    counts.set(tag, (counts.get(tag) || 0) + 1);
                });

                return counts;
            }, new Map());
            const sortedTags = [...tagCounts.entries()]
                .map(([tag, count]) => ({ tag, count }))
                .sort(sortTagEntries);
            const topTags = sortedTags.slice(0, 4).map(({ tag }) => tag);
            const sharedTags = sortedTags
                .filter(({ count }) => count > 1)
                .slice(0, 4)
                .map(({ tag }) => tag);

            return {
                id: '',
                colorIndex: 0,
                label: createClusterLabel(topTags),
                size: clusterNotes.length,
                noteIds: clusterNotes
                    .slice()
                    .sort((left, right) => left.order - right.order)
                    .map((note) => note.id),
                topTags,
                sharedTags
            };
        })
        .sort(compareClusters)
        .map((cluster, index) => ({
            ...cluster,
            id: `cluster-${index + 1}`,
            colorIndex: index
        }));

    const noteClusterMap = {};

    clusters.forEach((cluster) => {
        cluster.noteIds.forEach((noteId) => {
            noteClusterMap[noteId] = cluster.id;
        });
    });

    return {
        clusterCount: clusters.length,
        clusters,
        noteClusterMap
    };
}
