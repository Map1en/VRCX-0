// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SelectionActionBar } from './SelectionActionBar';

describe('SelectionActionBar', () => {
    afterEach(cleanup);

    it('composes selection controls with feature actions', () => {
        const onSelectAll = vi.fn();
        const onClearSelection = vi.fn();

        render(
            <SelectionActionBar
                status="2 selected"
                selectAllLabel="Select all"
                clearLabel="Clear"
                onSelectAll={onSelectAll}
                onClearSelection={onClearSelection}
            >
                <button type="button">Delete</button>
            </SelectionActionBar>
        );

        expect(screen.getByText('2 selected')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

        expect(onSelectAll).toHaveBeenCalledOnce();
        expect(onClearSelection).toHaveBeenCalledOnce();
    });

    it('hides controls while a selection action is pending', () => {
        render(
            <SelectionActionBar
                status="Updating 1 of 2"
                selectAllLabel="Select all"
                clearLabel="Clear"
                pending
                onSelectAll={vi.fn()}
                onClearSelection={vi.fn()}
            >
                <button type="button">Delete</button>
            </SelectionActionBar>
        );

        expect(screen.getByText('Updating 1 of 2')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
