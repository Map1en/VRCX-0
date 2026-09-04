// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GameLogPage } from './GameLogPage';
import { getGameLogSessionKey } from './gameLogRows';
import type { GameLogSession, GameLogViewMode } from './gameLogTypes';

const mocks = vi.hoisted<{
    viewMode: GameLogViewMode;
    sessions: GameLogSession[];
}>(() => ({ viewMode: 'table', sessions: [] }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) =>
            ({
                'view.game_log.label.game_log_is_disabled':
                    'You have turned off GameLog writing',
                'view.game_log.action.enable_game_log_ingestion_in_settings_before_this_page_can_load_local_vrchat_activity':
                    'New records are not saved; history remains available.'
            })[key] ?? key
    })
}));

vi.mock('@/components/dialogs/PreviousInstancesTableDialog', () => ({
    PreviousInstancesTableDialog: () => null
}));

vi.mock('./components/GameLogToolbar', () => ({
    GameLogToolbar: ({
        refreshModel,
        filterModel,
        sessionControls
    }: {
        refreshModel: { canRefresh: boolean };
        filterModel: { viewMode: GameLogViewMode };
        sessionControls: {
            allOpen: boolean;
            canToggle: boolean;
            onToggle(): void;
        };
    }) => (
        <div data-testid="toolbar" data-can-refresh={refreshModel.canRefresh}>
            {filterModel.viewMode === 'sessions' ? (
                <button
                    disabled={!sessionControls.canToggle}
                    onClick={sessionControls.onToggle}
                >
                    {sessionControls.allOpen ? 'Collapse all' : 'Expand all'}
                </button>
            ) : null}
        </div>
    )
}));

vi.mock('./components/GameLogTableShell', () => ({
    GameLogTableShell: ({ rows }: { rows: unknown[] }) => (
        <div>History rows: {rows.length}</div>
    )
}));

vi.mock('./components/GameLogSessionsView', () => ({
    GameLogSessionsView: ({
        sessions,
        defaultOpen,
        sessionOpenOverrides,
        onSessionOpenChange
    }: {
        sessions: GameLogSession[];
        defaultOpen: boolean;
        sessionOpenOverrides: ReadonlyMap<string, boolean>;
        onSessionOpenChange(key: string, open: boolean): void;
    }) => (
        <div>
            {sessions.map((session) => {
                const key = getGameLogSessionKey(session);
                const open = sessionOpenOverrides.get(key) ?? defaultOpen;
                return (
                    <button
                        key={key}
                        data-open={open}
                        onClick={() => onSessionOpenChange(key, !open)}
                    >
                        {session.worldName}
                    </button>
                );
            })}
        </div>
    )
}));

vi.mock('./components/GameLogTableParts', () => ({
    GameLogEmptyState: ({ title }: { title: string }) => <div>{title}</div>
}));

vi.mock('./useGameLogPageController', () => ({
    useGameLogPageController: () => ({
        annotations: {
            annotatedRows: [{ id: 1 }],
            affinity: { favoriteIdSet: new Set(), friendIdSet: new Set() }
        },
        filters: {
            deferredSearchQuery: '',
            favoritesOnly: false,
            queryFilterTypes: [],
            refreshGameLog: vi.fn(),
            sessionDateFrom: '',
            sessionDateTo: '',
            viewMode: mocks.viewMode
        },
        hasMoreSessions: false,
        isError: false,
        isGameRunning: false,
        isLoading: false,
        isLoadingMoreSessions: false,
        pageCount: 1,
        previousInstancesDialog: {
            open: false,
            rows: [],
            setOpen: vi.fn(),
            setRows: vi.fn(),
            title: ''
        },
        rowsState: {
            currentUserId: 'usr_test',
            detail: '',
            gameLogDisabled: true,
            isFavoritesLoaded: true,
            loadStatus: 'ready',
            rows: [{ rowId: 1 }, { rowId: 2 }],
            sessions: mocks.sessions
        },
        table: {},
        tableState: {
            loadMoreSessions: vi.fn(),
            pageSizes: [10],
            setPagination: vi.fn(),
            setSessionLimit: vi.fn()
        }
    })
}));

describe('GameLogPage', () => {
    afterEach(() => {
        cleanup();
        mocks.viewMode = 'table';
        mocks.sessions = [];
    });

    it('keeps history and refresh available while showing the write warning', () => {
        render(<GameLogPage />);

        expect(
            screen.getByText('You have turned off GameLog writing')
        ).toBeTruthy();
        expect(
            screen.getByText(
                'New records are not saved; history remains available.'
            )
        ).toBeTruthy();
        expect(screen.getByText('History rows: 2')).toBeTruthy();
        expect(
            screen.getByTestId('toolbar').getAttribute('data-can-refresh')
        ).toBe('true');
    });

    it('shares expansion between toolbar and sessions without persisting it across modes', async () => {
        mocks.viewMode = 'sessions';
        mocks.sessions = [1, 2].map((id) => ({
            id,
            created_at: '2026-09-03T00:00:00.000Z',
            duration: 0,
            location: `wrld_test:${id}`,
            worldId: 'wrld_test',
            worldName: `World ${id}`,
            groupName: '',
            playerDurationRows: [],
            events: []
        }));
        const view = render(<GameLogPage />);
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Collapse all' }));
        expect(
            screen.getByRole('button', { name: 'World 1' }).dataset.open
        ).toBe('false');
        expect(
            screen.getByRole('button', { name: 'World 2' }).dataset.open
        ).toBe('false');

        await user.click(screen.getByRole('button', { name: 'World 1' }));
        expect(screen.getByRole('button', { name: 'Expand all' })).toBeTruthy();
        await user.click(screen.getByRole('button', { name: 'Expand all' }));
        expect(
            screen.getByRole('button', { name: 'World 2' }).dataset.open
        ).toBe('true');

        await user.click(screen.getByRole('button', { name: 'Collapse all' }));
        mocks.viewMode = 'table';
        view.rerender(<GameLogPage />);
        mocks.viewMode = 'sessions';
        view.rerender(<GameLogPage />);
        expect(
            screen.getByRole('button', { name: 'World 1' }).dataset.open
        ).toBe('true');
        expect(
            screen.getByRole('button', { name: 'Collapse all' })
        ).toBeTruthy();
    });
});
