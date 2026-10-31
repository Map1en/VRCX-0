// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getUserMemoMap: vi.fn(),
    getProfileBioMap: vi.fn(),
    getMyAvatars: vi.fn(),
    t: (key: string) => key
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('@/repositories/myAvatarRepository', () => ({
    default: { getMyAvatars: mocks.getMyAvatars }
}));
vi.mock('./toolsDialogUtils', () => ({
    getUserMemoMap: mocks.getUserMemoMap,
    getProfileBioMap: mocks.getProfileBioMap,
    getFriendIds: (ids: string[]) => ids,
    csvEscape: (value: string) => value
}));
vi.mock('./ToolsDialogControls', () => ({
    ToolTextarea: ({ value }: { value: string }) => (
        <textarea readOnly value={value} />
    )
}));
vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({
        children,
        onOpenChangeComplete
    }: PropsWithChildren<{
        onOpenChangeComplete?: (open: boolean) => void;
    }>) => (
        <div>
            {children}
            <button onClick={() => onOpenChangeComplete?.(false)}>
                finish-close
            </button>
        </div>
    ),
    DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>,
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>
}));

import { useFriendRosterStore } from '@/state/friendRosterStore';

import {
    ExportAvatarsListDialog,
    ExportDiscordNamesDialog,
    ExportFriendsListDialog
} from './ExportListDialogs';

beforeEach(() => {
    mocks.getUserMemoMap.mockResolvedValue(new Map([['usr_one', 'memo']]));
    useFriendRosterStore
        .getState()
        .applyFriendPatch({ userId: 'usr_one', patch: { displayName: 'One' } });
});

afterEach(() => {
    cleanup();
    useFriendRosterStore.getState().resetRoster();
    vi.clearAllMocks();
});

describe('export dialog data lifetime', () => {
    it('switches export format without reloading the friend data', async () => {
        render(<ExportFriendsListDialog open onOpenChange={vi.fn()} />);
        const csv = 'UserID,DisplayName,LocalNote\nusr_one,One,memo';
        await screen.findByDisplayValue(csv, { normalizer: (value) => value });
        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.export_friends_list.json'
            })
        );
        expect(screen.getByRole('textbox')).toHaveProperty(
            'value',
            JSON.stringify({ friends: ['usr_one'] }, null, 4)
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.export_friends_list.csv'
            })
        );
        expect(screen.getByRole('textbox')).toHaveProperty('value', csv);
        expect(mocks.getUserMemoMap).toHaveBeenCalledTimes(1);
    });

    it('keeps export text during the close animation, releases it afterwards and reloads on reopen', async () => {
        const onOpenChange = vi.fn();
        const view = render(
            <ExportFriendsListDialog open onOpenChange={onOpenChange} />
        );
        const csv = 'UserID,DisplayName,LocalNote\nusr_one,One,memo';
        await screen.findByDisplayValue(csv, { normalizer: (value) => value });
        view.rerender(
            <ExportFriendsListDialog open={false} onOpenChange={onOpenChange} />
        );
        expect(
            screen.getByDisplayValue(csv, { normalizer: (value) => value })
        ).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'finish-close' }));
        expect(
            screen
                .getAllByRole('textbox')
                .every(
                    (element) =>
                        element instanceof HTMLTextAreaElement &&
                        element.value === ''
                )
        ).toBe(true);
        act(() =>
            useFriendRosterStore.getState().applyFriendPatch({
                userId: 'usr_one',
                patch: { displayName: 'Changed' }
            })
        );
        expect(mocks.getUserMemoMap).toHaveBeenCalledTimes(1);
        view.rerender(
            <ExportFriendsListDialog open onOpenChange={onOpenChange} />
        );
        await screen.findByDisplayValue(
            'UserID,DisplayName,LocalNote\nusr_one,Changed,memo',
            { normalizer: (value) => value }
        );
    });

    it('takes Discord names from the status first and the stored bio otherwise', async () => {
        const roster = useFriendRosterStore.getState();
        roster.applyFriendPatch({
            userId: 'usr_one',
            patch: { statusDescription: 'dc: status_one' }
        });
        roster.applyFriendPatch({
            userId: 'usr_two',
            patch: { displayName: 'Two', statusDescription: 'hello' }
        });
        roster.applyFriendPatch({
            userId: 'usr_three',
            patch: { displayName: 'Three' }
        });
        mocks.getProfileBioMap.mockResolvedValue(
            new Map([
                ['usr_one', 'discord: bio_one'],
                ['usr_two', 'Find me\nDiscord˸ bio_two'],
                ['usr_three', 'no handle here']
            ])
        );

        render(<ExportDiscordNamesDialog open onOpenChange={vi.fn()} />);

        const textbox = await screen.findByRole('textbox');
        await waitFor(() =>
            expect(textbox).toHaveProperty(
                'value',
                'DisplayName,DiscordName\nOne,status_one\nTwo,bio_two'
            )
        );
    });

    it('does not repopulate a closed dialog when an avatar request finishes late', async () => {
        let finish:
            | ((avatars: { id: string; name: string }[]) => void)
            | undefined;
        mocks.getMyAvatars.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        const onOpenChange = vi.fn();
        const view = render(
            <ExportAvatarsListDialog open onOpenChange={onOpenChange} />
        );
        view.rerender(
            <ExportAvatarsListDialog open={false} onOpenChange={onOpenChange} />
        );
        fireEvent.click(screen.getByRole('button', { name: 'finish-close' }));
        await act(async () => {
            finish?.([{ id: 'avtr_one', name: 'Late' }]);
        });
        await waitFor(() =>
            expect(screen.getByRole('textbox')).toHaveProperty('value', '')
        );
    });
});

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));
