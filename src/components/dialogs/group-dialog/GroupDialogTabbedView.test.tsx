// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroupProfileRecord } from '@/domain/entities/group';

import type {
    GroupDialogControls,
    GroupDialogResource,
    GroupDialogTabCommands,
    GroupDialogTabModel,
    GroupDialogView
} from './groupDialogTypes';

const mocks = vi.hoisted(() => ({
    getFollowingGroupCalendars: vi.fn(),
    getGroupCalendar: vi.fn(),
    getAllGroupPosts: vi.fn(),
    navigate: vi.fn(),
    recordToolOpen: vi.fn()
}));

vi.mock('react-router', () => ({
    useNavigate: () => mocks.navigate
}));

vi.mock('@/services/telemetry/telemetryToolUsage', () => ({
    recordToolOpen: mocks.recordToolOpen
}));

vi.mock('@/repositories/vrchatToolsRepository', () => ({
    default: {
        followGroupEvent: vi.fn(),
        getFollowingGroupCalendars: mocks.getFollowingGroupCalendars,
        getGroupCalendar: mocks.getGroupCalendar
    }
}));

vi.mock('@/repositories/groupProfileRepository', () => ({
    default: {
        getAllGroupPosts: mocks.getAllGroupPosts
    }
}));

vi.mock('@/services/dialogService', () => ({
    openUserDialog: vi.fn()
}));

vi.mock('@/state/dialogStore', () => ({
    useDialogStore: <T,>(
        selector: (state: { closeDialog: () => void }) => T
    ): T => selector({ closeDialog: vi.fn() })
}));

vi.mock('../EntityDialogScaffold', () => ({
    EntityDialogScaffold: ({ children }: { children: ReactNode }) => (
        <div>{children}</div>
    ),
    EntityDialogTwoColumnLayout: ({
        children,
        rail
    }: {
        children: ReactNode;
        rail: ReactNode;
    }) => (
        <div>
            {rail}
            {children}
        </div>
    )
}));

vi.mock('./GroupDialogHeaderSection', () => ({
    GroupDialogHeaderSection: ({
        headerCommands,
        headerModel
    }: {
        headerCommands: {
            onEditProfile: () => void;
            onEditProfileMedia: () => void;
            onOpenModeration: () => void;
        };
        headerModel: { canEditProfile: boolean };
    }) =>
        headerModel.canEditProfile ? (
            <div>
                <button type="button" onClick={headerCommands.onEditProfile}>
                    Edit details
                </button>
                <button
                    type="button"
                    onClick={headerCommands.onEditProfileMedia}
                >
                    Edit banner and icon
                </button>
                <button type="button" onClick={headerCommands.onOpenModeration}>
                    Open moderation
                </button>
            </div>
        ) : null
}));

vi.mock('../ProfileMediaPanel', () => ({
    ProfileMediaPanel: ({
        onSetField
    }: {
        onSetField: (field: string, fileId: string) => void;
    }) => (
        <button type="button" onClick={() => onSetField('iconId', 'file_new')}>
            Pick new icon
        </button>
    )
}));

vi.mock('./GroupProfileEditDialog', () => ({
    GroupProfileEditDialog: ({ open }: { open: boolean }) =>
        open ? <div>Group details editor</div> : null
}));

vi.mock('./GroupDialogTabPanels', () => ({
    GroupDialogTabPanels: ({
        tabCommands,
        tabModel
    }: {
        tabCommands: GroupDialogTabCommands;
        tabModel: GroupDialogTabModel;
    }) => (
        <div>
            <span>{tabModel.activeTab}</span>
            <span>{tabModel.announcement?.title}</span>
            <span data-testid="posts-status">
                {tabModel.remoteStatus.posts}
            </span>
            <button
                type="button"
                onClick={() => tabCommands.onChangeTab('events')}
            >
                Open events
            </button>
            <button
                type="button"
                onClick={() => tabCommands.onChangeTab('posts')}
            >
                Open posts
            </button>
        </div>
    )
}));

vi.mock('./GroupPostEditorDialog', () => ({
    GroupPostEditorDialog: () => null
}));

vi.mock('./useGroupDialogLanguageRows', () => ({
    useGroupDialogLanguageRows: () => []
}));

vi.mock('./useGroupDialogPosts', () => ({
    useGroupDialogPosts: () => ({
        createGroupPost: vi.fn(),
        deleteGroupPost: vi.fn(),
        editGroupPost: vi.fn(),
        postEditor: null,
        postEditorSubmitting: false,
        setPostEditor: vi.fn(),
        submitGroupPost: vi.fn()
    })
}));

vi.mock('./useGroupDialogTabbedRuntimeState', () => ({
    useGroupDialogTabbedRuntimeState: () => ({
        confirm: vi.fn(),
        currentEndpoint: 'https://api.example.test',
        currentUserId: 'usr_current',
        openImagePreview: vi.fn(),
        prompt: vi.fn()
    })
}));

import { GroupDialogTabbedView } from './GroupDialogTabbedView';

const group: GroupProfileRecord = {
    bannerUrl: '',
    description: '',
    discriminator: '',
    displayName: 'Test Group',
    iconUrl: '',
    id: 'grp_test',
    languages: [],
    links: [],
    memberCount: 1,
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

const groupResource: GroupDialogResource = {
    actionStatus: 'idle',
    detail: '',
    group
};

const groupView: GroupDialogView = {
    bannerUrl: '',
    canDelete: false,
    canJoin: false,
    canLeave: true,
    iconUrl: '',
    isBlocked: false,
    isMember: true,
    isRepresenting: false,
    isSubscribedToAnnouncements: false,
    joinState: 'joined',
    memberStatus: 'member',
    memberVisibility: 'visible',
    ownerDisplayName: 'Owner'
};

const groupControls: GroupDialogControls = {
    onBlock: vi.fn(),
    onUpdateProfile: vi.fn(),
    onCancelRequest: vi.fn(),
    onJoin: vi.fn(),
    onDelete: vi.fn(),
    onLeave: vi.fn(),
    onPreviousInstancesChange: vi.fn(),
    onRefresh: vi.fn(),
    onReloadProfile: vi.fn(),
    onRepresent: vi.fn(),
    onSubscribe: vi.fn(),
    onVisibility: vi.fn()
};

const editableGroup: GroupProfileRecord = {
    ...group,
    description: 'About us',
    joinState: 'request',
    languages: ['eng'],
    links: ['https://example.com'],
    rules: 'Be kind',
    iconId: 'file_old_icon',
    bannerId: 'file_banner',
    allowGroupJoinPrompt: false,
    myMember: { permissions: ['group-data-manage'] }
};

describe('GroupDialogTabbedView profile editing', () => {
    afterEach(cleanup);

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllGroupPosts.mockResolvedValue([]);
        mocks.getGroupCalendar.mockResolvedValue({ results: [] });
        mocks.getFollowingGroupCalendars.mockResolvedValue({ results: [] });
    });

    it('replaces only the icon when a group data manager picks a new one', async () => {
        const onUpdateProfile = vi.fn().mockResolvedValue(true);
        render(
            <GroupDialogTabbedView
                groupControls={{ ...groupControls, onUpdateProfile }}
                groupResource={{ ...groupResource, group: editableGroup }}
                groupView={groupView}
            />
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'Edit banner and icon' })
        );
        fireEvent.click(screen.getByRole('button', { name: 'Pick new icon' }));

        await waitFor(() =>
            expect(onUpdateProfile).toHaveBeenCalledWith({
                name: 'Test Group',
                shortCode: 'TEST',
                description: 'About us',
                joinState: 'request',
                languages: ['eng'],
                rules: 'Be kind',
                links: ['https://example.com'],
                iconId: 'file_new',
                bannerId: 'file_banner',
                allowGroupJoinPrompt: false
            })
        );
    });

    it('opens the details editor for a group data manager', () => {
        render(
            <GroupDialogTabbedView
                groupControls={groupControls}
                groupResource={{ ...groupResource, group: editableGroup }}
                groupView={groupView}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));

        expect(screen.getByText('Group details editor')).not.toBeNull();
    });

    it('records a group moderation tool open when opening moderation from the dialog', () => {
        render(
            <GroupDialogTabbedView
                groupControls={groupControls}
                groupResource={{ ...groupResource, group: editableGroup }}
                groupView={groupView}
            />
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'Open moderation' })
        );

        expect(mocks.recordToolOpen).toHaveBeenCalledExactlyOnceWith(
            'group-moderation'
        );
        expect(mocks.navigate).toHaveBeenCalledWith(
            '/tools/group-moderation/grp_test'
        );
    });

    it('does not offer profile editing to moderators without group data permission', () => {
        render(
            <GroupDialogTabbedView
                groupControls={groupControls}
                groupResource={{
                    ...groupResource,
                    group: {
                        ...editableGroup,
                        myMember: { permissions: ['group-bans-manage'] }
                    }
                }}
                groupView={groupView}
            />
        );

        expect(
            screen.queryByRole('button', { name: 'Edit details' })
        ).toBeNull();
        expect(
            screen.queryByRole('button', { name: 'Edit banner and icon' })
        ).toBeNull();
    });
});

describe('GroupDialogTabbedView remote loading', () => {
    afterEach(cleanup);

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllGroupPosts.mockResolvedValue([]);
        mocks.getGroupCalendar.mockResolvedValue({ results: [] });
        mocks.getFollowingGroupCalendars.mockResolvedValue({ results: [] });
    });

    it('loads the latest group post as the announcement from the overview', async () => {
        mocks.getAllGroupPosts.mockResolvedValue([
            {
                id: 'post_announcement',
                title: 'Weekly meetup',
                text: 'Meet on Friday.'
            }
        ]);

        render(
            <GroupDialogTabbedView
                groupControls={groupControls}
                groupResource={groupResource}
                groupView={groupView}
            />
        );

        await waitFor(() => {
            expect(mocks.getAllGroupPosts).toHaveBeenCalledWith({
                groupId: 'grp_test'
            });
        });
        expect(await screen.findByText('Weekly meetup')).not.toBeNull();
    });

    it('retries posts after the initial announcement load fails', async () => {
        mocks.getAllGroupPosts
            .mockRejectedValueOnce(new Error('Failed to load posts.'))
            .mockResolvedValueOnce([
                {
                    id: 'post_retried',
                    title: 'Recovered announcement',
                    text: 'Loaded after retry.'
                }
            ]);

        render(
            <GroupDialogTabbedView
                groupControls={groupControls}
                groupResource={groupResource}
                groupView={groupView}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId('posts-status').textContent).toBe(
                'error'
            );
        });
        fireEvent.click(screen.getByRole('button', { name: 'Open posts' }));

        await waitFor(() => {
            expect(mocks.getAllGroupPosts).toHaveBeenCalledTimes(2);
        });
        expect(
            await screen.findByText('Recovered announcement')
        ).not.toBeNull();
    });

    it('loads following calendars only after opening the Events tab', async () => {
        render(
            <GroupDialogTabbedView
                groupControls={groupControls}
                groupResource={groupResource}
                groupView={groupView}
            />
        );

        await waitFor(() => {
            expect(mocks.getGroupCalendar).toHaveBeenCalledOnce();
        });
        expect(mocks.getFollowingGroupCalendars).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Open events' }));

        await waitFor(() => {
            expect(mocks.getFollowingGroupCalendars).toHaveBeenCalledOnce();
        });
        expect(mocks.getGroupCalendar).toHaveBeenCalledOnce();
    });
});

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));
