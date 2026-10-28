// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('saves the slot picked from the invite message list', async () => {
        mocks.getInviteMessages.mockResolvedValue([
            { slot: 0, message: 'first' },
            { slot: 3, message: 'come join' }
        ]);
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
            screen.getByRole('button', { name: 'common.actions.select' })
        );
        const row = (await screen.findByText('come join')).closest('tr');
        await user.click(
            within(row as HTMLElement).getByRole('button', {
                name: 'common.actions.select'
            })
        );

        expect(onSaveValue).toHaveBeenCalledWith(
            'autoAcceptInviteMessageSlot',
            '3'
        );
    });

    it('clears a chosen slot back to no message', async () => {
        const onSaveValue = vi.fn();
        render(
            <InviteRulesTab
                values={{ ...ENABLED_VALUES, autoAcceptInviteMessageSlot: '0' }}
                loading={false}
                onSaveValue={onSaveValue}
            />
        );

        await userEvent
            .setup()
            .click(
                screen.getByRole('button', { name: 'common.actions.clear' })
            );

        expect(onSaveValue).toHaveBeenCalledWith(
            'autoAcceptInviteMessageSlot',
            ''
        );
    });
});
