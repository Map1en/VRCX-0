import { describe, expect, it } from 'vitest';

import {
    buildMyAvatarsGridRows,
    getMyAvatarsGridMetrics,
    getVisibleMyAvatarsGridRows
} from './myAvatarsGrid.js';

describe('myAvatarsGrid', () => {
    it('lays out more avatar cards per row when the grid has more horizontal space', () => {
        const narrow = getMyAvatarsGridMetrics({
            cardScale: 1,
            cardSpacing: 1,
            width: 320
        });
        const wide = getMyAvatarsGridMetrics({
            cardScale: 1,
            cardSpacing: 1,
            width: 980
        });

        expect(narrow.gridColumnCount).toBe(1);
        expect(wide.gridColumnCount).toBeGreaterThan(narrow.gridColumnCount);
        expect(wide.gridGap).toBe(12);
        expect(wide.gridMinWidth).toBe(320);
    });

    it('uses smaller cards to fit more columns while keeping a minimum row height', () => {
        const compact = getMyAvatarsGridMetrics({
            cardScale: 0.5,
            cardSpacing: 0.6,
            width: 640
        });

        expect(compact.gridColumnCount).toBeGreaterThan(1);
        expect(compact.gridMinWidth).toBe(200);
        expect(compact.gridRowHeight).toBeGreaterThanOrEqual(180);
    });

    it('groups avatars into stable virtual rows for the current column count', () => {
        const avatars = [
            { id: 'avtr_1' },
            { id: 'avtr_2' },
            { id: 'avtr_3' },
            { id: 'avtr_4' },
            { id: 'avtr_5' }
        ];

        expect(
            buildMyAvatarsGridRows({
                avatars,
                gridColumnCount: 2,
                gridRowHeight: 240
            })
        ).toEqual([
            {
                key: 'grid-row:0',
                avatars: [{ id: 'avtr_1' }, { id: 'avtr_2' }],
                top: 0,
                height: 240
            },
            {
                key: 'grid-row:2',
                avatars: [{ id: 'avtr_3' }, { id: 'avtr_4' }],
                top: 240,
                height: 240
            },
            {
                key: 'grid-row:4',
                avatars: [{ id: 'avtr_5' }],
                top: 480,
                height: 240
            }
        ]);
    });

    it('keeps nearby virtual rows mounted around the visible scroll window', () => {
        const gridRows = buildMyAvatarsGridRows({
            avatars: Array.from({ length: 20 }, (_, index) => ({
                id: `avtr_${index}`
            })),
            gridColumnCount: 2,
            gridRowHeight: 200
        });

        const visibleRows = getVisibleMyAvatarsGridRows({
            gridRows,
            scrollTop: 800,
            viewportHeight: 400
        });

        expect(visibleRows[0].top).toBeLessThanOrEqual(400);
        expect(visibleRows.at(-1).top).toBeGreaterThanOrEqual(1400);
        expect(visibleRows.length).toBeLessThan(gridRows.length);
    });

    it('returns no visible rows while grid rows are not ready yet', () => {
        expect(
            getVisibleMyAvatarsGridRows({
                gridRows: null,
                scrollTop: 0,
                viewportHeight: 400
            })
        ).toEqual([]);
    });
});
