function padDatePart(value: number) {
    return String(value).padStart(2, '0');
}

export function screenshotDayKey(timeMs: number) {
    const date = new Date(timeMs);
    if (!timeMs || Number.isNaN(date.getTime())) {
        return '';
    }
    return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

export type ScreenshotTimelineMark = {
    monthKey: string;
    year: string;
    monthStartMs: number;
    top: number;
};

export function buildScreenshotTimelineMarks(
    rows: ReadonlyArray<{ top: number; section?: { key: string } }>
) {
    const marks: ScreenshotTimelineMark[] = [];
    for (const row of rows) {
        const monthKey = row.section?.key.slice(0, 7);
        if (!monthKey || marks.at(-1)?.monthKey === monthKey) {
            continue;
        }
        const [year, month] = monthKey.split('-').map(Number);
        marks.push({
            monthKey,
            year: String(year),
            monthStartMs: new Date(year, month - 1, 1).getTime(),
            top: row.top
        });
    }
    return marks;
}

export function findTimelineMarkAt(
    marks: readonly ScreenshotTimelineMark[],
    scrollTop: number
) {
    let current = marks[0] ?? null;
    for (const mark of marks) {
        if (mark.top > scrollTop + 1) {
            break;
        }
        current = mark;
    }
    return current;
}

export function findCurrentSection<
    T extends { top: number; section?: unknown }
>(rows: readonly T[], scrollTop: number) {
    let current: T | null = null;
    for (const row of rows) {
        if (row.top > scrollTop + 1) {
            break;
        }
        if (row.section) {
            current = row;
        }
    }
    return current;
}
