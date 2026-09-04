// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: { count?: number }) =>
            values?.count === undefined ? key : `${key}:${values.count}`
    })
}));

import { MyGroupsSelectionBar } from './MyGroupsSelectionBar';

describe('MyGroupsSelectionBar', () => {
    afterEach(cleanup);

    it('offers select all before any group is selected', () => {
        const onSelectAll = vi.fn();

        render(
            <MyGroupsSelectionBar
                selectedCount={0}
                leavableCount={0}
                allSelected={false}
                busy={false}
                progress={null}
                onSelectAll={onSelectAll}
                onClearSelection={vi.fn()}
                onSetVisibility={vi.fn()}
                onLeave={vi.fn()}
            />
        );

        expect(
            screen.getByText('view.my_groups.selected_count:0')
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.gallery_selection.select_all'
            })
        );
        expect(onSelectAll).toHaveBeenCalledOnce();

        expect(
            screen
                .getByRole('button', {
                    name: 'dialog.group.actions.visibility'
                })
                .hasAttribute('disabled')
        ).toBe(true);
        expect(
            screen
                .getByRole('button', { name: 'view.my_groups.leave' })
                .hasAttribute('disabled')
        ).toBe(true);
        expect(
            screen
                .getByRole('button', { name: 'common.actions.clear' })
                .hasAttribute('disabled')
        ).toBe(true);
    });
});
