// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getInviteMessages: vi.fn()
}));

vi.mock('@/repositories/vrchatToolsRepository', () => ({
    default: {
        editInviteMessage: vi.fn(),
        getInviteMessages: mocks.getInviteMessages
    }
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

vi.mock('./useFavoriteFriendGroupOptions', () => ({
    useFavoriteFriendGroupOptions: () => []
}));

vi.mock('../toolsDialogUtils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../toolsDialogUtils')>()),
    getCurrentUserId: () => 'usr_self',
    getEndpoint: () => ''
}));

import { InviteRulesTab, type InviteRulesTabValues } from './InviteRulesTab';

const ENABLED_VALUES: InviteRulesTabValues = {
    autoAcceptInviteRequests: 'All Favorites',
    autoAcceptInviteGroups: [],
    autoAcceptInviteStatuses: [],
    autoAcceptInviteMessageSlot: ''
};

describe('InviteRulesTab invite message', () => {
    beforeEach(() => {
        mocks.getInviteMessages.mockResolvedValue([
            { slot: 0, message: 'first' },
            { slot: 3, message: 'come join' }
        ]);
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('saves the slot picked from the invite message dropdown', async () => {
        const onSaveValue = vi.fn();
        render(
            <InviteRulesTab
                values={ENABLED_VALUES}
                loading={false}
                onSaveValue={onSaveValue}
            />
        );
        const user = userEvent.setup();

        await user.click(
            screen.getByRole('button', {
                name: 'dialog.invite_message.no_message'
            })
        );
        await user.click(
            await screen.findByRole('button', { name: /come join/ })
        );

        expect(onSaveValue).toHaveBeenCalledWith(
            'autoAcceptInviteMessageSlot',
            '3'
        );
    });

    it('shows the chosen message and clears it back to no message', async () => {
        const onSaveValue = vi.fn();
        render(
            <InviteRulesTab
                values={{ ...ENABLED_VALUES, autoAcceptInviteMessageSlot: '3' }}
                loading={false}
                onSaveValue={onSaveValue}
            />
        );
        const user = userEvent.setup();

        await user.click(
            await screen.findByRole('button', { name: /come join/ })
        );
        await user.click(
            await screen.findByRole('button', {
                name: 'dialog.invite_message.no_message'
            })
        );

        expect(onSaveValue).toHaveBeenCalledWith(
            'autoAcceptInviteMessageSlot',
            ''
        );
    });
});
