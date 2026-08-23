// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InventoryItemRecord } from '@/repositories/vrchatMediaRepository';

import {
    UserDialogHeaderSection,
    type UserHeaderCommands,
    type UserHeaderModel
} from './UserDialogHeaderSection';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

afterEach(cleanup);

const nameplateEffect: InventoryItemRecord = {
    id: 'invt_nameplate',
    metadata: {
        assets: [
            {
                type: 'base',
                url: 'https://example.test/nameplate.webp'
            }
        ]
    }
};

const gradientNameplateEffect: InventoryItemRecord = {
    id: 'invt_gradient_nameplate',
    metadata: {
        gradientEnd: '#2a0c88',
        gradientStart: '#672bd8'
    }
};

function createHeaderModel(effect?: InventoryItemRecord): UserHeaderModel {
    return {
        actionStatus: 'idle',
        avatarOverrideState: {
            hideAvatar: false,
            showAvatar: false
        },
        bannerFallbackUrl: '',
        canInviteFromCurrentLocation: false,
        currentAvatarTarget: '',
        currentUserBoopingEnabled: false,
        detail: '',
        extendedModerationState: {
            interactOff: false,
            muteChat: false
        },
        fallbackAvatarTarget: '',
        friendRequestState: {
            incoming: false,
            outgoing: false
        },
        imageUrl: '',
        isCurrentUser: true,
        isFriend: false,
        loadStatus: 'ready',
        moderationState: {
            block: false,
            mute: false
        },
        platform: {
            icon: null,
            label: 'PC'
        },
        PlatformIcon: null,
        previousDisplayNames: [],
        profile: {
            displayName: 'Map1en_',
            id: 'usr_test'
        },
        profileAppearance: effect ? { nameplateEffect: effect } : {},
        profileIconUrl: '',
        profileLanguages: [],
        profileTitle: 'Map1en_',
        recentDialogShortcut: () => null,
        statusDotClassName: '',
        statusStateText: '',
        username: '',
        userUrl: ''
    };
}

function createHeaderCommands(): UserHeaderCommands {
    const noop = () => undefined;

    return {
        onAvatarOverride: noop,
        onBoop: noop,
        onCopyDisplayName: noop,
        onCopyUserId: noop,
        onCopyUserUrl: noop,
        onEditMemo: noop,
        onEditSelfProfileDetails: noop,
        onEditSelfProfileMedia: noop,
        onEditSelfProfileDecorations: noop,
        onEditSelfStatus: noop,
        onExtendedModeration: noop,
        onFriendRequest: noop,
        onGroupModeration: noop,
        onImageClick: noop,
        onInvite: noop,
        onInviteMessage: noop,
        onInviteRequest: noop,
        onInviteRequestMessage: noop,
        onInviteToGroup: noop,
        onModeration: noop,
        onOpenDiscordProfile: noop,
        onOpenFallbackAvatar: noop,
        onOpenImagePreview: noop,
        onOpenUserIcon: noop,
        onOpenUserUrl: noop,
        onRefresh: noop,
        onReportHacking: noop,
        onShowAvatarAuthor: noop,
        onShowInstanceHistory: noop,
        onToggleBadgeShowcased: noop,
        onToggleBadgeVisibility: noop,
        onToggleSelfAvatarCopying: noop,
        onToggleSelfBooping: noop,
        onToggleSelfDiscordConnections: noop,
        onToggleSelfSharedConnections: noop,
        onUnfriend: noop
    };
}

describe('UserDialogHeaderSection nameplate', () => {
    it('copies the current display name from the title', () => {
        const headerCommands = createHeaderCommands();
        headerCommands.onCopyDisplayName = vi.fn();

        render(
            <UserDialogHeaderSection
                headerModel={createHeaderModel()}
                headerCommands={headerCommands}
            />
        );

        fireEvent.click(screen.getByTitle('Map1en_'));

        expect(headerCommands.onCopyDisplayName).toHaveBeenCalledOnce();
        expect(headerCommands.onCopyDisplayName).toHaveBeenCalledWith(
            'Map1en_'
        );
    });

    it('aligns a decorated nameplate with the action button', () => {
        render(
            <UserDialogHeaderSection
                headerModel={createHeaderModel(nameplateEffect)}
                headerCommands={createHeaderCommands()}
            />
        );

        const title = screen.getByText('Map1en_');
        const titleRow = title.closest('[data-slot="card-title"]');
        const nameplate = titleRow?.parentElement;
        const actionButton = screen.getByRole('button', {
            name: 'Open entity actions'
        });

        expect(nameplate?.classList.contains('min-h-9')).toBe(true);
        expect(titleRow?.classList.contains('min-h-9')).toBe(true);
        expect(actionButton.classList.contains('size-9')).toBe(true);
    });

    it.each([
        ['a static asset', nameplateEffect],
        ['a gradient', gradientNameplateEffect]
    ])('keeps the title readable over %s', (_kind, effect) => {
        render(
            <UserDialogHeaderSection
                headerModel={createHeaderModel(effect)}
                headerCommands={createHeaderCommands()}
            />
        );

        const title = screen.getByText('Map1en_');
        const titleRow = title.closest('[data-slot="card-title"]');

        expect(titleRow?.classList.contains('text-white')).toBe(true);
    });

    it.each([
        ['no item', undefined],
        ['an item without renderable appearance', { id: 'invt_empty' }]
    ])('keeps the theme foreground for %s', (_kind, effect) => {
        render(
            <UserDialogHeaderSection
                headerModel={createHeaderModel(effect)}
                headerCommands={createHeaderCommands()}
            />
        );

        const title = screen.getByText('Map1en_');
        const titleRow = title.closest('[data-slot="card-title"]');

        expect(titleRow?.classList.contains('text-white')).toBe(false);
    });
});

describe('UserDialogHeaderSection friend number', () => {
    it('shows the stored friend number for a current friend', () => {
        const headerModel = createHeaderModel();
        headerModel.friendNumber = 42;
        headerModel.isCurrentUser = false;
        headerModel.isFriend = true;

        render(
            <UserDialogHeaderSection
                headerModel={headerModel}
                headerCommands={createHeaderCommands()}
            />
        );

        expect(screen.getByText('#42')).toBeTruthy();
    });

    it('hides the stored friend number for a former friend', () => {
        const headerModel = createHeaderModel();
        headerModel.friendNumber = 42;
        headerModel.isCurrentUser = false;
        headerModel.isFriend = false;

        render(
            <UserDialogHeaderSection
                headerModel={headerModel}
                headerCommands={createHeaderCommands()}
            />
        );

        expect(screen.queryByText('#42')).toBeNull();
    });
});

describe('UserDialogHeaderSection friend actions', () => {
    it('opens instance history before its rows have been loaded', async () => {
        const headerModel = createHeaderModel();
        headerModel.isCurrentUser = false;
        const headerCommands = createHeaderCommands();
        headerCommands.onShowInstanceHistory = vi.fn();

        render(
            <UserDialogHeaderSection
                headerModel={headerModel}
                headerCommands={headerCommands}
            />
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'Open entity actions' })
        );

        const label = await screen.findByText(
            'dialog.user.actions.show_previous_instances'
        );
        fireEvent.click(label);

        expect(headerCommands.onShowInstanceHistory).toHaveBeenCalledOnce();
    });

    it('offers cancellation for an outgoing friend request', async () => {
        const headerModel = createHeaderModel();
        headerModel.isCurrentUser = false;
        headerModel.friendRequestState.outgoing = true;

        render(
            <UserDialogHeaderSection
                headerModel={headerModel}
                headerCommands={createHeaderCommands()}
            />
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'Open entity actions' })
        );

        expect(
            await screen.findByText('dialog.user.actions.cancel_friend_request')
        ).toBeTruthy();
        expect(
            screen.queryByText('dialog.user.actions.send_friend_request')
        ).toBeNull();
    });

    it('marks unfriend as destructive', async () => {
        const headerModel = createHeaderModel();
        headerModel.isCurrentUser = false;
        headerModel.isFriend = true;

        render(
            <UserDialogHeaderSection
                headerModel={headerModel}
                headerCommands={createHeaderCommands()}
            />
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'Open entity actions' })
        );

        const label = await screen.findByText('dialog.user.actions.unfriend');
        expect(
            label
                .closest('[data-slot="dropdown-menu-item"]')
                ?.getAttribute('data-variant')
        ).toBe('destructive');
        expect(
            label.closest('[data-slot="dropdown-menu-content"]')?.className
        ).toContain('**:data-[variant=destructive]:text-destructive!');
    });
});

describe('UserDialogHeaderSection creator badge', () => {
    it('shows the economy creator fact when the profile provides it', () => {
        const headerModel = createHeaderModel();
        headerModel.profile.isEconomyCreator = true;

        render(
            <UserDialogHeaderSection
                headerModel={headerModel}
                headerCommands={createHeaderCommands()}
            />
        );

        expect(
            screen.getByText('dialog.user.label.economy_creator')
        ).toBeTruthy();
    });

    it('hides the economy creator fact when the profile omits it', () => {
        render(
            <UserDialogHeaderSection
                headerModel={createHeaderModel()}
                headerCommands={createHeaderCommands()}
            />
        );

        expect(
            screen.queryByText('dialog.user.label.economy_creator')
        ).toBeNull();
    });
});
