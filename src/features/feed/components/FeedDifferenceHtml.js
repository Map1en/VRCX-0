function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll(/&/g, '&amp;')
        .replaceAll(/</g, '&lt;')
        .replaceAll(/>/g, '&gt;')
        .replaceAll(/"/g, '&quot;')
        .replaceAll(/'/g, '&#039;')
        .replaceAll(/\n/g, '<br>');
}

function formatDifferenceHtml(
    oldValue,
    newValue,
    markerAddition = '<span class="rounded bg-primary/10 px-0.5 text-primary">{{text}}</span>',
    markerDeletion = '<span class="rounded bg-destructive/10 px-0.5 text-destructive line-through">{{text}}</span>'
) {
    const oldWords = escapeHtml(oldValue)
        .split(/\s+/)
        .flatMap((word) => word.split(/(<br>)/));
    const newWords = escapeHtml(newValue)
        .split(/\s+/)
        .flatMap((word) => word.split(/(<br>)/));

    function findLongestMatch(oldStart, oldEnd, newStart, newEnd) {
        let bestOldStart = oldStart;
        let bestNewStart = newStart;
        let bestSize = 0;
        const lookup = new Map();

        for (let i = oldStart; i < oldEnd; i += 1) {
            const word = oldWords[i];
            if (!lookup.has(word)) {
                lookup.set(word, []);
            }
            lookup.get(word).push(i);
        }

        for (let j = newStart; j < newEnd; j += 1) {
            const word = newWords[j];
            if (!lookup.has(word)) {
                continue;
            }
            for (const i of lookup.get(word)) {
                let size = 0;
                while (
                    i + size < oldEnd &&
                    j + size < newEnd &&
                    oldWords[i + size] === newWords[j + size]
                ) {
                    size += 1;
                }
                if (size > bestSize) {
                    bestOldStart = i;
                    bestNewStart = j;
                    bestSize = size;
                }
            }
        }

        return {
            oldStart: bestOldStart,
            newStart: bestNewStart,
            size: bestSize
        };
    }

    function build(words, start, end, pattern) {
        const result = [];
        const parts = words
            .slice(start, end)
            .filter((word) => word.length > 0)
            .join(' ')
            .split('<br>');

        for (let i = 0; i < parts.length; i += 1) {
            if (i > 0) {
                result.push('<br>');
            }
            if (parts[i].length > 0) {
                result.push(pattern.replace('{{text}}', parts[i]));
            }
        }
        return result;
    }

    function buildDiff(oldStart, oldEnd, newStart, newEnd) {
        const result = [];
        const match = findLongestMatch(oldStart, oldEnd, newStart, newEnd);

        if (match.size > 0) {
            if (oldStart < match.oldStart || newStart < match.newStart) {
                result.push(
                    ...buildDiff(
                        oldStart,
                        match.oldStart,
                        newStart,
                        match.newStart
                    )
                );
            }
            result.push(
                oldWords
                    .slice(match.oldStart, match.oldStart + match.size)
                    .join(' ')
            );
            if (
                match.oldStart + match.size < oldEnd ||
                match.newStart + match.size < newEnd
            ) {
                result.push(
                    ...buildDiff(
                        match.oldStart + match.size,
                        oldEnd,
                        match.newStart + match.size,
                        newEnd
                    )
                );
            }
        } else {
            if (oldStart < oldEnd) {
                result.push(
                    ...build(oldWords, oldStart, oldEnd, markerDeletion)
                );
            }
            if (newStart < newEnd) {
                result.push(
                    ...build(newWords, newStart, newEnd, markerAddition)
                );
            }
        }

        return result;
    }

    return buildDiff(0, oldWords.length, 0, newWords.length)
        .join(' ')
        .replace(/<br>[ ]+<br>/g, '<br><br>')
        .replace(/<br> /g, '<br>');
}

export { formatDifferenceHtml };
