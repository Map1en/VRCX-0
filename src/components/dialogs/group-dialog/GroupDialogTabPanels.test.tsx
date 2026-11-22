// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renders = vi.hoisted(() => ({ members: 0, posts: 0 }));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/components/language/useLanguageNames', () => ({
    useLanguageNames: () => ({ languageName: (key: string) => key })
}));

vi.mock('./GroupMembersPanel', () => ({
    GroupMembersPanel: () => {
        renders.members += 1;
        return <div>members panel</div>;
    }
}));

vi.mock('./GroupRowList', () => ({
    GroupPostUserButton: () => null,
    RowList: () => {
        renders.posts += 1;
        return <div>posts panel</div>;
    }
}));

vi.mock('./GroupDialogEvents', () => ({
    GroupEventsTab: () => null,
    GroupEventSummary: () => null
}));

vi.mock('./GroupGalleryPanel', () => ({
    GroupGalleryPanel: () => null
}));

vi.mock('./GroupInstanceRows', () => ({
    GroupInstanceRows: () => null
}));

vi.mock('../PreviousInstancesTableDialog', () => ({
    PreviousInstancesPanel: () => null
}));

import type { GroupProfileRecord } from '@/domain/entities/group';

import { GroupDialogTabPanels } from './GroupDialogTabPanels';
import type {
    GroupDialogTabCommands,
    GroupDialogTabModel
} from './groupDialogTypes';

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

const noop = () => {};
const tabCommands: GroupDialogTabCommands = {
    onChangeTab: noop,
    onCreateEvent: noop,
    onDeleteEvent: noop,
    onDeletePost: noop,
    onEditEvent: noop,
    onEditPost: noop,
    onGalleriesChanged: noop,
    onPhotosChanged: noop,
    onExportMembers: noop,
    onLoadMoreMembers: noop,
    onPreviousInstancesChange: noop,
    onPreviewImage: noop,
    onPreviewRowImage: noop,
    onRefreshEvents: noop,
    onRefreshInstances: noop,
    onRefreshMembers: noop,
    onSearchMembersChange: noop,
    onSearchPostsChange: noop,
    onToggleEventFollow: noop
};

function tabModel(activeTab: string, postsSearch = ''): GroupDialogTabModel {
    return {
        activeInstances: [],
        activeTab,
        bannerUrl: '',
        canManageCalendar: false,
        canManagePosts: false,
        currentUserId: 'usr_me',
        filteredPosts: [],
        group,
        groupEvents: [],
        groupEventsError: '',
        groupEventsStatus: 'idle',
        groupTitle: 'Test Group',
        members: {
            rows: [],
            staffRows: [],
            status: '',
            error: '',
            loadedCount: 0,
            totalCount: null,
            hasMore: false,
            isLoadingMore: false,
            query: '',
            isSearching: false,
            searchStatus: ''
        },
        photos: [],
        posts: [],
        previousInstances: [],
        remoteErrors: {},
        remoteStatus: {},
        search: { posts: postsSearch },
        tabs: [
            { value: 'overview', label: 'Overview' },
            { value: 'posts', label: 'Posts' },
            { value: 'members', label: 'Members' }
        ]
    };
}

function renderPanels(model: GroupDialogTabModel) {
    return <GroupDialogTabPanels tabModel={model} tabCommands={tabCommands} />;
}

describe('GroupDialogTabPanels', () => {
    afterEach(() => {
        cleanup();
        renders.members = 0;
        renders.posts = 0;
    });

    it('keeps visited tabs mounted without re-rendering them while hidden', () => {
        const view = render(renderPanels(tabModel('members')));
        view.rerender(renderPanels(tabModel('posts')));
        screen.getByText('members panel');

        const membersRendersWhileHidden = renders.members;
        const postsRenders = renders.posts;
        view.rerender(renderPanels(tabModel('posts', 'query')));

        expect(renders.members).toBe(membersRendersWhileHidden);
        expect(renders.posts).toBeGreaterThan(postsRenders);
        screen.getByText('members panel');

        view.rerender(renderPanels(tabModel('members', 'query')));
        expect(renders.members).toBeGreaterThan(membersRendersWhileHidden);
    });

    it('drops kept tabs when the dialog switches to another group', () => {
        const view = render(renderPanels(tabModel('members')));
        view.rerender(renderPanels(tabModel('posts')));
        screen.getByText('members panel');

        view.rerender(
            renderPanels({
                ...tabModel('posts'),
                group: { ...group, id: 'grp_other' }
            })
        );

        expect(screen.queryByText('members panel')).toBeNull();
    });
});
