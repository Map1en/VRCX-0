// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { InviteMessagePanel } from './InviteMessagePanel';

describe('InviteMessagePanel respond mode', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('retries a failed response with the already edited slot instead of editing it again', async () => {
        mocks.getInviteMessages.mockResolvedValue([
            {
                slot: 0,
                message: 'old text',
                updatedAt: '2020-01-01T00:00:00.000Z'
            }
        ]);
        mocks.editInviteMessage.mockResolvedValue([
            { slot: 0, message: 'new text' }
        ]);
        const onUse = vi
            .fn()
            .mockRejectedValueOnce(new Error('send failed'))
            .mockResolvedValueOnce(undefined);
        const onClose = vi.fn();
        render(
            <InviteMessagePanel
                currentUserId="usr_self"
                messageType="requestResponse"
                mode="respond"
                allowEdit
                onUse={onUse}
                onClose={onClose}
            />
        );
        const user = userEvent.setup();

        await user.click(
            await screen.findByRole('button', {
                name: 'dialog.invite_message.dynamic.edit_slot_value'
            })
        );
        const textarea = screen.getByRole('textbox');
        await user.clear(textarea);
        await user.type(textarea, 'new text');
        const sendButtons = screen.getAllByRole('button', {
            name: 'dialog.edit_send_invite_message.send'
        });
        await user.click(sendButtons[sendButtons.length - 1]);

        expect(await screen.findByText('send failed')).toBeTruthy();
        expect(mocks.editInviteMessage).toHaveBeenCalledOnce();

        await user.click(
            screen.getByRole('button', { name: 'common.actions.confirm' })
        );

        expect(mocks.editInviteMessage).toHaveBeenCalledOnce();
        expect(onUse).toHaveBeenCalledTimes(2);
        expect(onUse).toHaveBeenLastCalledWith(
            expect.objectContaining({
                message: 'new text',
                row: expect.objectContaining({ slot: 0, message: 'new text' })
            })
        );
        expect(onClose).toHaveBeenCalledOnce();
    });
});
