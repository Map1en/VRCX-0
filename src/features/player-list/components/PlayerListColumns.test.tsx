// @vitest-environment jsdom

import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { AppRow } from '@/components/data-table/appTable';

import type { PlayerListRow } from '../playerListTypes';
import { usePlayerListColumns } from './PlayerListColumns';

function renderRankCell(row: Partial<PlayerListRow>) {
    const { result } = renderHook(() => usePlayerListColumns());
    const rank = result.current.find((column) => column.id === 'rank');
    if (typeof rank?.cell !== 'function') {
        throw new Error('missing rank cell');
    }
    const cell = rank.cell as (context: {
        row: AppRow<PlayerListRow>;
    }) => ReactNode;
    render(<>{cell({ row: { original: row } as AppRow<PlayerListRow> })}</>);
}

describe('usePlayerListColumns rank', () => {
    it('shows the localized trust rank instead of the raw API label', () => {
        renderRankCell({
            trustClass: 'x-tag-veteran',
            trustLevel: 'Trusted User'
        });

        expect(
            screen.getByText(
                'view.settings.appearance.user_colors.trust_levels.trusted_user'
            )
        ).toBeTruthy();
    });

    it('falls back to the raw label for an unknown trust class', () => {
        renderRankCell({ trustClass: 'x-tag-other', trustLevel: 'Legend' });

        expect(screen.getByText('Legend')).toBeTruthy();
    });
});
