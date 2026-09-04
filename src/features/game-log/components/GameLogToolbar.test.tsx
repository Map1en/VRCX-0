// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAppTable } from '@/components/data-table/appTable';
import type { DateTimeRangePicker } from '@/components/date-time-range-picker/DateTimeRangePicker';

import type { GameLogRow } from '../gameLogTypes';
import { GameLogToolbar } from './GameLogToolbar';

const mocks = vi.hoisted(() => ({ picker: vi.fn() }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/components/data-table/TableColumnVisibilityMenu', () => ({
    TableColumnVisibilityMenu: () => <button>Columns</button>
}));

vi.mock('@/components/date-time-range-picker/DateTimeRangePicker', () => ({
    DateTimeRangePicker: (
        props: ComponentProps<typeof DateTimeRangePicker>
    ) => {
        mocks.picker(props);
        return props.renderTrigger?.({
            active: Boolean(props.value.from || props.value.to),
            label: props.value.from
                ? 'Sep 1 00:00 - Sep 2 23:59'
                : props.placeholder
        });
    }
}));

type ToolbarProps = Omit<ComponentProps<typeof GameLogToolbar>, 'table'>;
const dateRangeLabel = 'view.game_log.label.session_date_range';

function createProps(): ToolbarProps {
    return {
        filterModel: {
            availableFilterTypes: [
                'OnPlayerJoined',
                'OnPlayerLeft',
                'VideoPlay'
            ],
            favoritesOnly: false,
            queryFilterTypes: [],
            searchDraft: '',
            sessionDateRange: { from: null, to: null },
            todayDate: new Date('2026-09-03T00:00:00.000Z'),
            viewMode: 'sessions',
            changeViewMode: vi.fn(),
            clearSearch: vi.fn(),
            commitSearchDraft: vi.fn(),
            setActiveSelectedTypes: vi.fn(),
            setSearchDraft: vi.fn(),
            setSessionDateTimeRange: vi.fn(),
            toggleFavoritesOnly: vi.fn()
        },
        refreshModel: {
            canRefresh: true,
            loadStatus: 'ready',
            onRefresh: vi.fn()
        },
        sessionControls: {
            allOpen: true,
            canToggle: true,
            onToggle: vi.fn()
        }
    };
}

function ToolbarHarness(props: ToolbarProps) {
    const table = useAppTable<GameLogRow>({ columns: [], data: [] });
    return <GameLogToolbar {...props} table={table} />;
}

describe('GameLogToolbar', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('places the date filter inside search while retaining date-time constraints', () => {
        render(<ToolbarHarness {...createProps()} />);

        const inputGroup = screen
            .getByRole('textbox')
            .closest('[data-slot="input-group"]');
        expect(
            inputGroup?.contains(
                screen.getByRole('button', { name: dateRangeLabel })
            )
        ).toBe(true);
        expect(mocks.picker).toHaveBeenLastCalledWith(
            expect.objectContaining({
                maxDays: 7,
                minuteStep: 15,
                align: 'end'
            })
        );
        expect(
            screen.getByRole('button', {
                name: 'view.game_log.sessions.collapse_all'
            })
        ).toBeTruthy();
    });

    it('clears the keyword and date range independently', async () => {
        const props = createProps();
        props.filterModel.searchDraft = 'Alice';
        props.filterModel.sessionDateRange = {
            from: new Date('2026-09-01T00:00:00.000Z'),
            to: new Date('2026-09-02T23:59:59.999Z')
        };
        render(<ToolbarHarness {...props} />);
        const user = userEvent.setup();

        await user.click(
            screen.getByRole('button', { name: 'common.actions.clear' })
        );
        expect(props.filterModel.clearSearch).toHaveBeenCalledOnce();
        expect(
            props.filterModel.setSessionDateTimeRange
        ).not.toHaveBeenCalled();

        await user.click(
            screen.getByRole('button', {
                name: `${dateRangeLabel}: common.actions.clear`
            })
        );
        expect(props.filterModel.setSessionDateTimeRange).toHaveBeenCalledWith({
            from: null,
            to: null
        });
        expect(props.filterModel.clearSearch).toHaveBeenCalledOnce();
    });

    it('toggles session expansion from the toolbar and exposes the current action', async () => {
        const props = createProps();
        const view = render(<ToolbarHarness {...props} />);
        const user = userEvent.setup();
        await user.click(
            screen.getByRole('button', {
                name: 'view.game_log.sessions.collapse_all'
            })
        );
        expect(props.sessionControls.onToggle).toHaveBeenCalledOnce();

        view.rerender(
            <ToolbarHarness
                {...props}
                sessionControls={{ ...props.sessionControls, allOpen: false }}
            />
        );
        expect(
            screen.getByRole('button', {
                name: 'view.game_log.sessions.expand_all'
            })
        ).toBeTruthy();

        view.rerender(
            <ToolbarHarness
                {...props}
                sessionControls={{ ...props.sessionControls, canToggle: false }}
            />
        );
        expect(
            screen
                .getByRole('button', {
                    name: 'view.game_log.sessions.collapse_all'
                })
                .hasAttribute('disabled')
        ).toBe(true);
    });

    it('keeps table mode free of session-only actions', () => {
        const props = createProps();
        props.filterModel.viewMode = 'table';
        render(<ToolbarHarness {...props} />);

        expect(mocks.picker).not.toHaveBeenCalled();
        expect(
            screen.queryByRole('button', {
                name: 'view.game_log.sessions.collapse_all'
            })
        ).toBeNull();
        expect(screen.getByRole('button', { name: 'Columns' })).toBeTruthy();
    });

    it('keeps multi-select type filtering in the narrow menu', async () => {
        const props = createProps();
        render(<ToolbarHarness {...props} />);
        const user = userEvent.setup();
        await user.click(
            screen.getByRole('button', { name: 'table.gameLog.type' })
        );
        await user.click(
            within(await screen.findByRole('menu')).getByRole(
                'menuitemcheckbox',
                { name: 'view.game_log.filters.OnPlayerJoined' }
            )
        );
        expect(props.filterModel.setActiveSelectedTypes).toHaveBeenCalledWith([
            'OnPlayerJoined'
        ]);
        expect(screen.getByRole('menu')).toBeTruthy();
    });

    it('normalizes selecting every type to the existing all-types value', async () => {
        const props = createProps();
        props.filterModel.queryFilterTypes = ['OnPlayerJoined', 'OnPlayerLeft'];
        render(<ToolbarHarness {...props} />);
        const user = userEvent.setup();
        await user.click(
            screen.getByRole('button', { name: 'table.gameLog.type' })
        );
        await user.click(
            within(await screen.findByRole('menu')).getByRole(
                'menuitemcheckbox',
                { name: 'view.game_log.filters.VideoPlay' }
            )
        );
        expect(props.filterModel.setActiveSelectedTypes).toHaveBeenCalledWith(
            []
        );
    });
});
