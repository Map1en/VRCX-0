import { describe, expect, it } from 'vitest';

import {
    buildScreenshotTimelineMarks,
    findCurrentSection,
    findTimelineMarkAt,
    screenshotDayKey
} from './screenshotTimeline';

const rows = [
    { top: 0, section: { key: '2026-07-04' } },
    { top: 40 },
    { top: 200, section: { key: '2026-07-01' } },
    { top: 240 },
    { top: 400, section: { key: '2026-06-30' } },
    { top: 440 }
];

describe('screenshot timeline', () => {
    it('keys days in local time and skips unknown capture times', () => {
        expect(screenshotDayKey(new Date(2026, 6, 4, 23, 59).getTime())).toBe(
            '2026-07-04'
        );
        expect(screenshotDayKey(0)).toBe('');
    });

    it('marks the first day of each month for the scrubber', () => {
        const marks = buildScreenshotTimelineMarks(rows);

        expect(marks.map((mark) => [mark.monthKey, mark.top])).toEqual([
            ['2026-07', 0],
            ['2026-06', 400]
        ]);
        expect(marks[1].monthStartMs).toBe(new Date(2026, 5, 1).getTime());
        expect(findTimelineMarkAt(marks, 300)?.monthKey).toBe('2026-07');
        expect(findTimelineMarkAt(marks, 400)?.monthKey).toBe('2026-06');
    });

    it('finds the day header that the viewport has scrolled past', () => {
        expect(findCurrentSection(rows, 0)?.section?.key).toBe('2026-07-04');
        expect(findCurrentSection(rows, 260)?.section?.key).toBe('2026-07-01');
    });
});
