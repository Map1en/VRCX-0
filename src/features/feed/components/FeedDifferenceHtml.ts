function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replaceAll(/&/g, '&amp;')
        .replaceAll(/</g, '&lt;')
        .replaceAll(/>/g, '&gt;')
        .replaceAll(/"/g, '&quot;')
        .replaceAll(/'/g, '&#039;')
        .replaceAll(/\n/g, '<br>');
}

function formatDifferenceHtml(
    oldValue: unknown,
    newValue: unknown,
    markerAddition = '<span class="rounded bg-primary/10 px-0.5 text-primary">{{text}}</span>',
    markerDeletion = '<span class="rounded bg-destructive/10 px-0.5 text-destructive line-through">{{text}}</span>'
): string {
    const oldWords = escapeHtml(oldValue)
        .split(/\s+/)
        .flatMap((word) => word.split(/(<br>)/));
    const newWords = escapeHtml(newValue)
        .split(/\s+/)
        .flatMap((word) => word.split(/(<br>)/));

    function findLongestMatch(
        oldStart: number,
        oldEnd: number,
        newStart: number,
        newEnd: number
    ): { newStart: number; oldStart: number; size: number } {
        let bestOldStart = oldStart;
        let bestNewStart = newStart;
        let bestSize = 0;
        const lookup = new Map<string, number[]>();

        for (let i = oldStart; i < oldEnd; i += 1) {
            const word = oldWords[i];
            let positions = lookup.get(word);
            if (!positions) {
                positions = [];
                lookup.set(word, positions);
            }
            positions.push(i);
        }

        for (let j = newStart; j < newEnd; j += 1) {
            const word = newWords[j];
            const positions = lookup.get(word);
            if (!positions) {
                continue;
            }
            for (const i of positions) {
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

    function build(
        words: string[],
        start: number,
        end: number,
        pattern: string
    ): string[] {
        const result: string[] = [];
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

    function buildDiff(
        oldStart: number,
        oldEnd: number,
        newStart: number,
        newEnd: number
    ): string[] {
        const result: string[] = [];
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

export { escapeHtml, formatDifferenceHtml };
