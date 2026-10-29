// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRuntimeStore } from '@/state/runtimeStore';

const mocks = vi.hoisted(() => ({
    getBool: vi.fn<(key: string, fallback?: boolean) => Promise<boolean>>(),
    setBool: vi.fn<(key: string, value: boolean) => Promise<null>>(),
    queryFeed: vi.fn<() => Promise<unknown[]>>()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: { getBool: mocks.getBool, setBool: mocks.setBool }
}));

vi.mock('@/repositories/feedRepository', () => ({
    default: { queryFeed: mocks.queryFeed }
}));

import { FeedFirstRunTip } from './FeedFirstRunTip';

function renderTip() {
    return render(
        <MemoryRouter>
            <FeedFirstRunTip />
        </MemoryRouter>
    );
}

describe('FeedFirstRunTip', () => {
    beforeEach(() => {
        mocks.getBool.mockResolvedValue(false);
        mocks.setBool.mockResolvedValue(null);
        mocks.queryFeed.mockResolvedValue([]);
        useRuntimeStore.setState((state) => ({
            auth: { ...state.auth, currentUserId: 'usr_new' }
        }));
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('greets an account without feed history and remembers the dismissal', async () => {
        renderTip();

        expect(
            await screen.findByText('view.feed.first_run_tip.title')
        ).not.toBeNull();
        expect(mocks.queryFeed).toHaveBeenCalledWith({
            userId: 'usr_new',
            maxEntries: 1
        });

        await userEvent.click(
            screen.getByRole('button', {
                name: 'view.feed.first_run_tip.dismiss'
            })
        );

        expect(screen.queryByText('view.feed.first_run_tip.title')).toBeNull();
        expect(mocks.setBool).toHaveBeenCalledWith(
            'onboarding_welcome_seen',
            true
        );
    });

    it('stays hidden for an account that already has feed history', async () => {
        mocks.queryFeed.mockResolvedValue([{ rowId: 1 }]);
        renderTip();

        await waitFor(() => expect(mocks.queryFeed).toHaveBeenCalled());
        expect(screen.queryByText('view.feed.first_run_tip.title')).toBeNull();
    });

    it('stays hidden once the tip was dismissed before', async () => {
        mocks.getBool.mockResolvedValue(true);
        renderTip();

        await waitFor(() =>
            expect(mocks.getBool).toHaveBeenCalledWith(
                'onboarding_welcome_seen',
                false
            )
        );
        expect(mocks.queryFeed).not.toHaveBeenCalled();
        expect(screen.queryByText('view.feed.first_run_tip.title')).toBeNull();
    });
});
