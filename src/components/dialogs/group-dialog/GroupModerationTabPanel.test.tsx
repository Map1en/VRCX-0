// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renders = vi.hoisted(() => ({ count: 0 }));
const translation = vi.hoisted(() => ({ t: (key: string) => key }));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => translation
}));

vi.mock('./ModerationStatusBadge', () => ({
    ModerationStatusBadge: () => {
        renders.count += 1;
        return null;
    }
}));

import type { GroupProfileRecord } from '@/domain/entities/group';
import type { EntityRecord } from '@/domain/entities/shared';
import { Tabs } from '@/ui/shadcn/tabs';

import { GroupModerationTabPanel } from './GroupModerationTabPanel';

const group: GroupProfileRecord = {
    bannerUrl: '',
    description: '',
    discriminator: '',
    displayName: 'Test Group',
    iconUrl: '',
    id: 'grp_test',
    languages: [],
    links: [],
    memberCount: 3,
    membershipStatus: 'member',
    name: 'Test Group',
    onlineMemberCount: 0,
    ownerDisplayName: 'Owner',
    ownerId: 'usr_owner',
    privacy: 'default',
    roles: [],
    rules: '',
    shortCode: 'TEST',
    tags: [],
    url: ''
};

const rows: EntityRecord[] = ['usr_1', 'usr_2', 'usr_3'].map((userId) => ({
    userId,
    displayName: userId,
    membershipStatus: 'banned'
}));
const noop = () => {};

function renderPanel(selectedIds: ReadonlySet<string>, actionKey = '') {
    return (
        <Tabs value="bans">
            <GroupModerationTabPanel
                actionKey={actionKey}
                error=""
                group={group}
                loading={false}
                onOpenUser={noop}
                onReload={noop}
                onRunAction={noop}
                onToggleAllVisible={noop}
                onToggleRow={noop}
                rows={rows}
                selectable
                selectedIds={selectedIds}
                tab={{ disabled: false, label: 'Bans', value: 'bans' }}
            />
        </Tabs>
    );
}

describe('GroupModerationTabPanel', () => {
    afterEach(() => {
        cleanup();
        renders.count = 0;
    });

    it('re-renders only the row whose selection changed', () => {
        const view = render(renderPanel(new Set()));
        expect(renders.count).toBeGreaterThan(0);
        renders.count = 0;

        view.rerender(renderPanel(new Set(['usr_2'])));

        expect(renders.count).toBe(1);
        expect(
            screen
                .getByRole('checkbox', { name: 'usr_2' })
                .getAttribute('aria-checked')
        ).toBe('true');
        expect(
            screen
                .getByRole('checkbox', {
                    name: 'dialog.group_member_moderation.select_all'
                })
                .getAttribute('aria-checked')
        ).toBe('false');

        view.rerender(renderPanel(new Set(['usr_1', 'usr_2', 'usr_3'])));

        expect(
            screen
                .getByRole('checkbox', {
                    name: 'dialog.group_member_moderation.select_all'
                })
                .getAttribute('aria-checked')
        ).toBe('true');
    });

    it('disables every row action while one action runs', () => {
        render(renderPanel(new Set(), 'bans:unban:usr_1'));

        const buttons = screen.getAllByRole('button', {
            name: /dialog.group_member_moderation.unban|\.\.\./
        });
        expect(buttons).toHaveLength(3);
        expect(buttons.every((button) => button.hasAttribute('disabled'))).toBe(
            true
        );
        expect(screen.getAllByText('...')).toHaveLength(1);
    });
});
