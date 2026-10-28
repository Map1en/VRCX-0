// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    editInviteMessage: vi.fn(),
    getInviteMessages: vi.fn()
}));

vi.mock('@/repositories/vrchatToolsRepository', () => ({
    default: {
        editInviteMessage: mocks.editInviteMessage,
        getInviteMessages: mocks.getInviteMessages
    }
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

import { InviteMessageDialog } from './InviteMessageDialog';

describe('InviteMessageDialog', () => {
    beforeEach(() => {
        mocks.getInviteMessages.mockResolvedValue([
            { slot: 0, message: 'busy right now' },
            { slot: 1, message: 'give me five minutes' }
        ]);
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('sends only after a message is picked and closes on success', async () => {
        const onUse = vi.fn().mockResolvedValue(true);
        const onOpenChange = vi.fn();
        render(
            <InviteMessageDialog
                open
                onOpenChange={onOpenChange}
                currentUserId="usr_self"
                messageType="response"
                onUse={onUse}
            />
        );
        const user = userEvent.setup();
        const send = screen.getByRole('button', {
            name: 'dialog.edit_send_invite_message.send'
        });
        expect((send as HTMLButtonElement).disabled).toBe(true);

        await user.click(
            await screen.findByRole('button', { name: /give me five minutes/ })
        );
        await user.click(
            screen.getByRole('button', {
                name: /dialog\.edit_send_invite_message\.send/
            })
        );

        expect(onUse).toHaveBeenCalledWith(
            expect.objectContaining({
                messageType: 'response',
                row: expect.objectContaining({ slot: 1 })
            })
        );
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('selects a message right after editing it inline', async () => {
        mocks.editInviteMessage.mockResolvedValue([
            { slot: 0, message: 'back soon' }
        ]);
        render(
            <InviteMessageDialog
                open
                currentUserId="usr_self"
                messageType="response"
                allowEdit
                onUse={vi.fn()}
            />
        );
        const user = userEvent.setup();

        await user.click(
            (
                await screen.findAllByRole('button', {
                    name: 'dialog.invite_message.dynamic.edit_slot_value'
                })
            )[0]
        );
        const textarea = screen.getByRole('textbox');
        await user.clear(textarea);
        await user.type(textarea, 'back soon');
        await user.click(
            screen.getByRole('button', {
                name: 'dialog.edit_invite_message.save'
            })
        );

        expect(mocks.editInviteMessage).toHaveBeenCalledWith(
            expect.objectContaining({ slot: 0, message: 'back soon' })
        );
        expect(
            await screen.findByRole('button', {
                name: /dialog\.edit_send_invite_message\.send.*dialog\.invite_message\.slot_value/
            })
        ).toBeTruthy();
    });
});
