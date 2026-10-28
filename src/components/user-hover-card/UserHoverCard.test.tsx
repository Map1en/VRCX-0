// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prefetch: vi.fn() }));

vi.mock('./UserHoverCardContent', () => ({
    UserHoverCardContent: () => <div>hover card content</div>
}));
vi.mock('./useUserHoverCardData', () => ({
    prefetchUserHoverCardProfile: mocks.prefetch
}));

import { UserHoverCard } from './UserHoverCard';

function renderTrigger() {
    render(
        <UserHoverCard userId="usr_alice" openDelay={500}>
            <button type="button">Alice</button>
        </UserHoverCard>
    );
    return screen.getByRole('button', { name: 'Alice' });
}

function pointer(clientX: number, clientY: number) {
    return { clientX, clientY, pointerType: 'mouse' };
}

describe('UserHoverCard intent', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.prefetch.mockReset();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('stays closed when the row slides under a resting pointer', () => {
        const trigger = renderTrigger();

        fireEvent.pointerEnter(trigger, pointer(40, 12));
        fireEvent.pointerMove(trigger, pointer(40, 12));
        act(() => {
            vi.advanceTimersByTime(2000);
        });

        expect(screen.queryByText('hover card content')).toBeNull();
        expect(mocks.prefetch).not.toHaveBeenCalled();
    });

    it('opens once the pointer rests after a real movement', () => {
        const trigger = renderTrigger();

        fireEvent.pointerEnter(trigger, pointer(40, 12));
        fireEvent.pointerMove(trigger, pointer(44, 13));
        act(() => {
            vi.advanceTimersByTime(250);
        });
        expect(mocks.prefetch).toHaveBeenCalledWith('usr_alice');

        fireEvent.pointerMove(trigger, pointer(48, 13));
        act(() => {
            vi.advanceTimersByTime(499);
        });
        expect(screen.queryByText('hover card content')).toBeNull();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(screen.getByText('hover card content')).toBeTruthy();
    });

    it('cancels the pending open when the pointer leaves', () => {
        const trigger = renderTrigger();

        fireEvent.pointerEnter(trigger, pointer(40, 12));
        fireEvent.pointerMove(trigger, pointer(44, 13));
        fireEvent.pointerLeave(trigger, pointer(90, 13));
        act(() => {
            vi.advanceTimersByTime(2000);
        });

        expect(screen.queryByText('hover card content')).toBeNull();
    });

    it('stays closed after a click until the pointer leaves and returns', () => {
        const trigger = renderTrigger();

        fireEvent.pointerEnter(trigger, pointer(40, 12));
        fireEvent.pointerDown(trigger, pointer(40, 12));
        fireEvent.pointerMove(trigger, pointer(44, 13));
        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(screen.queryByText('hover card content')).toBeNull();

        fireEvent.pointerLeave(trigger, pointer(90, 13));
        fireEvent.pointerEnter(trigger, pointer(40, 12));
        fireEvent.pointerMove(trigger, pointer(44, 13));
        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(screen.getByText('hover card content')).toBeTruthy();
    });
});
