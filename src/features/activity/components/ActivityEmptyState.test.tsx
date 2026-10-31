// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ActivityIcon } from 'lucide-react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActivityNoHistoryState } from './ActivityEmptyState';

const mocks = vi.hoisted(() => ({
    ingest: { supported: true, available: true }
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(
        selector: (state: {
            hostCapabilities: {
                runtimeGameLogIngest: {
                    supported: boolean;
                    available: boolean;
                };
            };
        }) => T
    ) => selector({ hostCapabilities: { runtimeGameLogIngest: mocks.ingest } })
}));

function CurrentLocation() {
    const location = useLocation();
    return <output>{`${location.pathname}${location.search}`}</output>;
}

function renderState() {
    render(
        <MemoryRouter initialEntries={['/activity']}>
            <ActivityNoHistoryState
                icon={ActivityIcon}
                title="view.activity.empty.title"
                description="view.activity.empty.description"
            />
            <CurrentLocation />
        </MemoryRouter>
    );
}

const importLabel =
    'view.settings.advanced.advanced_ui.import_recovery.game_log.label';

afterEach(cleanup);

describe('ActivityNoHistoryState', () => {
    it('asks to keep VRCX-0 running when game logs are being read', () => {
        mocks.ingest = { supported: true, available: true };
        renderState();

        expect(
            screen.getByText('view.activity.empty.description')
        ).toBeTruthy();
        expect(screen.getByRole('button', { name: importLabel })).toBeTruthy();
    });

    it('explains a missing log folder and links to the log import setting', () => {
        mocks.ingest = { supported: true, available: false };
        renderState();

        expect(
            screen.getByText('view.activity.empty.unavailable')
        ).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: importLabel }));

        expect(screen.getByRole('status').textContent).toBe(
            '/settings?tab=advanced&setting=advanced.import-recovery.gamelog-import'
        );
    });

    it('explains that this platform cannot record and offers no import', () => {
        mocks.ingest = { supported: false, available: false };
        renderState();

        expect(
            screen.getByText('view.activity.empty.unsupported')
        ).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
