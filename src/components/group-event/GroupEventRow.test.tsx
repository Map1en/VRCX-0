// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/dialogService', () => ({
    openGroupDialog: vi.fn()
}));

import { GroupEventRow } from '@/components/group-event/GroupEventRow';

const DAY_MS = 24 * 60 * 60 * 1000;

function occurrence(id: string, offsetDays: number) {
    const start = Date.now() + offsetDays * DAY_MS;
    return {
        id,
        ownerId: 'grp_a',
        title: 'Weekly meetup',
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + 2 * 60 * 60 * 1000).toISOString()
    };
}

describe('GroupEventRow', () => {
    it('acts on the next upcoming occurrence and switches when another date chip is picked', () => {
        const past = occurrence('evt_past', -7);
        const upcoming = occurrence('evt_upcoming', 7);
        const onToggleFollow = vi.fn();
        render(
            <GroupEventRow
                events={[past, upcoming]}
                groupName="Group A"
                followingIds={new Set(['evt_past'])}
                variant="series"
                onToggleFollow={onToggleFollow}
            />
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.tools.label.follow_event'
            })
        );
        expect(onToggleFollow).toHaveBeenLastCalledWith(upcoming);

        const [pastChip] = screen
            .getAllByRole('button', { pressed: false })
            .filter((button) => button.textContent?.trim());
        fireEvent.click(pastChip);

        const unfollowButton = screen.getByRole('button', {
            name: 'dialog.tools.label.unfollow_event'
        });
        expect(unfollowButton.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(unfollowButton);
        expect(onToggleFollow).toHaveBeenLastCalledWith(past);
    });
});
