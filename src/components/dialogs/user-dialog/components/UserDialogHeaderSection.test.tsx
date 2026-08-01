// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
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
        previousInstances: [],
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

        expect(
            screen.getByText(/dialog\.user\.label\.friend/).textContent
        ).toContain('42');
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

        expect(screen.queryByText(/dialog\.user\.label\.friend/)).toBeNull();
    });
});
