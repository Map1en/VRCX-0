// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroupCalendarEventRecord } from '@/repositories/vrchatToolsRepository';

const mocks = vi.hoisted(() => ({
    discover: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appVrchatToolsCalendarDiscoverGet: mocks.discover
    }
}));

vi.mock('@/services/dialogService', () => ({
    openGroupDialog: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

vi.mock('@/ui/shadcn/scroll-area', () => ({
    ScrollArea: ({ children }: PropsWithChildren) => <div>{children}</div>
}));

vi.mock('./GroupEventRow', () => ({
    GroupEventRow: ({
        events,
        groupName
    }: {
        events: GroupCalendarEventRecord[];
        groupName: string;
    }) => (
        <div data-testid="event-row">
            {events[0]?.title} / {groupName}
        </div>
    )
}));

import { GroupCalendarDiscoverView } from './GroupCalendarDiscoverView';

function page(results: unknown[], nextCursor?: string) {
    return {
        status: 200,
        data: JSON.stringify({ results, nextCursor })
    };
}

function renderView(onFollowedEvents = vi.fn()) {
    render(
        <GroupCalendarDiscoverView
            followingIds={new Set()}
            groupNames={{}}
            groupProfiles={{}}
            onFollowedEvents={onFollowedEvents}
            onToggleFollow={vi.fn()}
        />
    );
    return onFollowedEvents;
}

describe('GroupCalendarDiscoverView', () => {
    beforeEach(() => {
        mocks.discover.mockReset();
    });

    afterEach(() => {
        cleanup();
    });

    it('loads upcoming events by start time and reports the ones already followed', async () => {
        mocks.discover.mockResolvedValueOnce(
            page([
                {
                    id: 'evt_1',
                    ownerId: 'grp_1',
                    ownerName: 'Group One',
                    title: 'Movie night',
                    userInterest: { isFollowing: true }
                },
                { id: 'evt_2', ownerId: 'grp_2', title: 'Dance' }
            ])
        );

        const onFollowedEvents = renderView();

        expect(await screen.findByText('Movie night / Group One')).toBeTruthy();
        expect(mocks.discover).toHaveBeenCalledWith({
            params: {
                scope: 'upcoming',
                n: 30,
                upcomingSort: 'startTime_ascending',
                requireLinkedInstance: null,
                nextCursor: null
            }
        });
        expect(onFollowedEvents).toHaveBeenCalledWith(['evt_1']);
    });

    it('appends the next cursor page and restarts without a sort for live events', async () => {
        mocks.discover
            .mockResolvedValueOnce(
                page([{ id: 'evt_1', ownerId: 'grp_1', title: 'First' }], 'c1')
            )
            .mockResolvedValueOnce(
                page([{ id: 'evt_2', ownerId: 'grp_1', title: 'Second' }])
            )
            .mockResolvedValueOnce(
                page([{ id: 'evt_3', ownerId: 'grp_1', title: 'Live' }])
            );

        renderView();
        fireEvent.click(await screen.findByText('common.load_more'));

        await waitFor(() => {
            expect(screen.getAllByTestId('event-row')).toHaveLength(2);
        });
        expect(mocks.discover).toHaveBeenLastCalledWith({
            params: expect.objectContaining({ nextCursor: 'c1' })
        });
        expect(screen.queryByText('common.load_more')).toBeNull();

        fireEvent.click(
            screen.getByText('dialog.group_calendar.discover.live')
        );

        await waitFor(() => {
            expect(screen.getAllByTestId('event-row')).toHaveLength(1);
        });
        expect(screen.getByText('Live / grp_1')).toBeTruthy();
        expect(mocks.discover).toHaveBeenLastCalledWith({
            params: {
                scope: 'live',
                n: 30,
                upcomingSort: null,
                requireLinkedInstance: null,
                nextCursor: null
            }
        });
    });
});
