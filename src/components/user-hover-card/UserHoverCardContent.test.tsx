import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoverCardData = vi.hoisted(() => {
    const createModel = () => ({
        variant: 'profile-only',
        displayName: 'Alice',
        avatarUrl: '',
        avatarPreviewUrl: '',
        userColour: '',
        trustSource: {},
        trustKey: '',
        statusKey: '',
        statusDotClassName: '',
        statusDescription: '',
        note: '',
        decorations: {
            iconFrame: '',
            profileEffect: '',
            nameplateEffect: ''
        },
        onlineForMs: 0,
        instanceEpoch: 0,
        lastOnlineAgoMs: 0,
        location: {
            effectiveLocation: '',
            worldId: '',
            instanceId: '',
            tag: '',
            accessTypeName: '',
            isRealInstance: false,
            isTraveling: false
        }
    });

    return {
        createModel,
        model: createModel()
    };
});

const STATUS_ONLINE_CLASS = 'border-[var(--status-online)]';

vi.mock('react-i18next', () => ({
    initReactI18next: {
        type: '3rdParty',
        init: () => {}
    },
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

vi.mock('@/services/dialogService', () => ({
    openUserDialog: vi.fn(),
    openWorldDialog: vi.fn()
}));

vi.mock('./useUserHoverCardData', () => ({
    useUserHoverCardData: () => ({
        model: hoverCardData.model,
        worldThumb: '',
        population: null,
        populationLoading: false,
        memo: '',
        trustColor: false,
        instanceEpoch: 0,
        profile: null,
        relationshipBadges: [],
        hasSeed: true,
        loading: false,
        loadFailed: false
    })
}));

vi.mock('./UserHoverCardMutuals', () => ({
    UserHoverCardMutuals: () => null
}));

vi.mock('@/components/ProfileDecorations', () => ({
    ProfileAvatarFrame: ({ templateId }: { templateId: string }) => (
        <span data-avatar-frame={templateId} />
    ),
    ProfileEffect: ({ templateId }: { templateId: string }) => (
        <span data-profile-effect={templateId} />
    ),
    ProfileNameplate: ({ templateId }: { templateId: string }) => (
        <span data-nameplate={templateId} />
    )
}));

const decorationPrefs = vi.hoisted(() => ({
    showHoverCardAvatarFrame: true,
    showHoverCardProfileEffect: true,
    showHoverCardNameplate: true
}));

vi.mock('@/state/preferencesStore', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@/state/preferencesStore')>();
    const usePreferencesStore = Object.assign(
        <T,>(
            selector: (
                state: ReturnType<typeof actual.usePreferencesStore.getState>
            ) => T
        ) =>
            selector({
                ...actual.usePreferencesStore.getState(),
                ...decorationPrefs
            }),
        actual.usePreferencesStore
    );
    return { ...actual, usePreferencesStore };
});

import { UserHoverCardContent } from './UserHoverCardContent';

function countOccurrences(text: string, needle: string): number {
    return text.split(needle).length - 1;
}

describe('UserHoverCardContent', () => {
    beforeEach(() => {
        Object.assign(hoverCardData.model, hoverCardData.createModel());
        Object.assign(decorationPrefs, {
            showHoverCardAvatarFrame: true,
            showHoverCardProfileEffect: true,
            showHoverCardNameplate: true
        });
    });

    it('does not render an online status dot for profile-only cards', () => {
        hoverCardData.model.statusKey = '';
        hoverCardData.model.statusDotClassName = '';
        const html = renderToStaticMarkup(
            <UserHoverCardContent userId="usr_1" />
        );

        expect(html).not.toContain('status-online');
    });

    it('shows the active status with avatar and inline status dots', () => {
        hoverCardData.model.statusKey = 'dialog.user.status.active';
        hoverCardData.model.statusDotClassName = `${STATUS_ONLINE_CLASS} bg-background`;

        const html = renderToStaticMarkup(
            <UserHoverCardContent userId="usr_1" />
        );

        expect(html).toContain('dialog.user.status.active');
        expect(countOccurrences(html, STATUS_ONLINE_CLASS)).toBe(2);
    });

    it('shows the signature without the inline active status when present', () => {
        hoverCardData.model.statusKey = 'dialog.user.status.active';
        hoverCardData.model.statusDotClassName = `${STATUS_ONLINE_CLASS} bg-background`;
        hoverCardData.model.statusDescription = 'Building worlds tonight';

        const html = renderToStaticMarkup(
            <UserHoverCardContent userId="usr_1" />
        );

        expect(html).toContain('Building worlds tonight');
        expect(html).not.toContain('dialog.user.status.active');
        expect(countOccurrences(html, STATUS_ONLINE_CLASS)).toBe(1);
    });

    it('keeps the offline signature above the last-online line', () => {
        hoverCardData.model.variant = 'offline';
        hoverCardData.model.statusDotClassName = 'bg-[var(--status-offline)]';
        hoverCardData.model.statusDescription = 'Back next week';
        hoverCardData.model.lastOnlineAgoMs = 120_000;

        const html = renderToStaticMarkup(
            <UserHoverCardContent userId="usr_1" />
        );

        expect(html).toContain('Back next week');
        expect(html).toContain('user_hover_card.last_online');
        expect(html.indexOf('Back next week')).toBeLessThan(
            html.indexOf('user_hover_card.last_online')
        );
    });

    it('renders each profile decoration only while its hover card toggle is on', () => {
        hoverCardData.model.decorations = {
            iconFrame: 'invt_frame',
            profileEffect: 'invt_effect',
            nameplateEffect: 'invt_plate'
        };
        const allOn = renderToStaticMarkup(
            <UserHoverCardContent userId="usr_1" />
        );
        Object.assign(decorationPrefs, {
            showHoverCardAvatarFrame: false,
            showHoverCardNameplate: false
        });
        const effectOnly = renderToStaticMarkup(
            <UserHoverCardContent userId="usr_1" />
        );

        expect(allOn).toContain('data-avatar-frame="invt_frame"');
        expect(allOn).toContain('data-profile-effect="invt_effect"');
        expect(allOn).toContain('data-nameplate="invt_plate"');
        expect(effectOnly).toContain('data-profile-effect="invt_effect"');
        expect(effectOnly).not.toContain('data-avatar-frame');
        expect(effectOnly).not.toContain('data-nameplate');
    });
});
