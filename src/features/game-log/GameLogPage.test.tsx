// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createUnavailableHostCapabilities,
    useRuntimeStore
} from '@/state/runtimeStore';

import { GameLogPage } from './GameLogPage';
import { getGameLogSessionKey } from './gameLogRows';
import type { GameLogSession, GameLogViewMode } from './gameLogTypes';

const mocks = vi.hoisted<{
    viewMode: GameLogViewMode;
    sessions: GameLogSession[];
    rows: Array<{ rowId: number }>;
    gameLogDisabled: boolean;
    isLoading: boolean;
}>(() => ({
    viewMode: 'table',
    sessions: [],
    rows: [{ rowId: 1 }, { rowId: 2 }],
    gameLogDisabled: true,
    isLoading: false
}));

const availableCapability = {
    supported: true,
    enabled: true,
    available: true
};

function setGameLogIngest(supported: boolean, available: boolean) {
    useRuntimeStore.setState({
        hostCapabilities: {
            ...createUnavailableHostCapabilities(),
            runtimeGameLogIngest: {
                ...availableCapability,
                supported,
                available
            }
        }
    });
}

function SettingsLocation() {
    const location = useLocation();
    return <div>{`settings:${location.search}`}</div>;
}

function pageTree() {
    return (
        <MemoryRouter initialEntries={['/game-log']}>
            <Routes>
                <Route path="/game-log" element={<GameLogPage />} />
                <Route path="/settings" element={<SettingsLocation />} />
            </Routes>
        </MemoryRouter>
    );
}

function renderPage() {
    return render(pageTree());
}

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
        isLoading: mocks.isLoading,
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
            gameLogDisabled: mocks.gameLogDisabled,
            isFavoritesLoaded: true,
            loadStatus: 'ready',
            rows: mocks.rows,
            sessions: mocks.sessions
        },
        table: {},
        tableState: {
            loadMoreSessions: vi.fn(),
            pageSizes: [10],
            setPagination: vi.fn()
        }
    })
}));

describe('GameLogPage', () => {
    afterEach(() => {
        cleanup();
        mocks.viewMode = 'table';
        mocks.sessions = [];
        mocks.rows = [{ rowId: 1 }, { rowId: 2 }];
        mocks.gameLogDisabled = true;
        mocks.isLoading = false;
        useRuntimeStore.setState({
            hostCapabilities: createUnavailableHostCapabilities()
        });
    });

    it('asks to keep VRCX-0 running and offers the log backfill when there is no history', async () => {
        setGameLogIngest(true, true);
        mocks.rows = [];
        mocks.gameLogDisabled = false;
        renderPage();

        expect(
            screen.getByText('empty_state.game_log_description')
        ).toBeTruthy();
        await userEvent.click(
            screen.getByRole('button', {
                name: 'view.settings.advanced.advanced_ui.import_recovery.game_log.label'
            })
        );
        expect(
            screen.getByText(
                'settings:?tab=advanced&setting=advanced.import-recovery.gamelog-import'
            )
        ).toBeTruthy();
    });

    it('points to the recording setting instead of the warning when recording is off and nothing is saved', async () => {
        setGameLogIngest(true, true);
        mocks.rows = [];
        renderPage();

        expect(
            screen.queryByText('view.game_log.label.game_log_is_disabled')
        ).toBeNull();
        expect(
            screen.getByText('empty_state.game_log_disabled_description')
        ).toBeTruthy();
        await userEvent.click(
            screen.getByRole('button', {
                name: 'empty_state.game_log_enable_action'
            })
        );
        expect(
            screen.getByText(
                'settings:?tab=advanced&setting=advanced.storage.gamelog'
            )
        ).toBeTruthy();
    });

    it('keeps the recording warning hidden while a history-less game log reloads', () => {
        setGameLogIngest(true, true);
        mocks.rows = [];
        mocks.isLoading = true;
        renderPage();

        expect(
            screen.getByText(
                'view.game_log.loading.loading_the_game_log_snapshot'
            )
        ).toBeTruthy();
        expect(
            screen.queryByText('view.game_log.label.game_log_is_disabled')
        ).toBeNull();
    });

    it('offers manual log import when the VRChat log folder is not found', () => {
        setGameLogIngest(true, false);
        mocks.rows = [];
        mocks.gameLogDisabled = false;
        renderPage();

        expect(
            screen.getByText('empty_state.game_log_unavailable_description')
        ).toBeTruthy();
        expect(
            screen.getByRole('button', {
                name: 'view.settings.advanced.advanced_ui.import_recovery.game_log.label'
            })
        ).toBeTruthy();
    });

    it('explains that game activity cannot be recorded on unsupported platforms', () => {
        setGameLogIngest(false, false);
        mocks.rows = [];
        mocks.gameLogDisabled = false;
        renderPage();

        expect(
            screen.getByText('empty_state.game_log_unsupported_description')
        ).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('keeps history and refresh available while showing the write warning', () => {
        renderPage();

        expect(
            screen.getByText('view.game_log.label.game_log_is_disabled')
        ).toBeTruthy();
        expect(
            screen.getByText(
                'view.game_log.action.enable_game_log_ingestion_in_settings_before_this_page_can_load_local_vrchat_activity'
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
        const view = renderPage();
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
        view.rerender(pageTree());
        mocks.viewMode = 'sessions';
        view.rerender(pageTree());
        expect(
            screen.getByRole('button', { name: 'World 1' }).dataset.open
        ).toBe('true');
        expect(
            screen.getByRole('button', { name: 'Collapse all' })
        ).toBeTruthy();
    });
});
