import type { Dispatch, ReactNode, SetStateAction } from 'react';

import type {
    EntityRecord,
    GroupDialogInstanceRow,
    GroupMemberRow,
    GroupProfileRecord,
    UserProfileEntity
} from '@/domain/entities/profileEntities';
import type { GroupCalendarEventRecord } from '@/repositories/vrchatToolsRepository';

import type { GroupPreviousInstanceRow } from './useGroupDialogState';

export type GroupRemoteTab = 'posts' | 'members' | 'photos';
export type GroupRemoteStatusValue = '' | 'running' | 'ready' | 'error';

export type GroupRemoteData = {
    posts: EntityRecord[];
    members: GroupMemberRow[];
    photos: EntityRecord[];
};

export type GroupRemoteStatus = Partial<
    Record<GroupRemoteTab, GroupRemoteStatusValue>
>;
export type GroupRemoteErrors = Partial<Record<GroupRemoteTab, string>>;

export type GroupDialogSearch = {
    posts: string;
    members: string;
};

export type GroupLoadContext = {
    endpoint: string;
    groupId: string;
    gallerySignature: string;
    memberSort: string;
    memberRoleId: string;
    tab?: GroupRemoteTab;
};

export type GroupDialogResource = {
    group: GroupProfileRecord;
    detail: string;
    actionStatus: string;
    activeInstances?: GroupDialogInstanceRow[];
    previousInstances?: GroupPreviousInstanceRow[];
};

export type GroupDialogView = {
    bannerUrl: string;
    iconUrl: string;
    isMember: boolean;
    isBlocked: boolean;
    isRepresenting: boolean;
    isSubscribedToAnnouncements: boolean;
    ownerDisplayName?: string;
    memberVisibility: string;
    memberStatus: string;
    joinState: string;
    canJoin: boolean;
};

export type GroupDialogControls = {
    onPreviousInstancesChange: Dispatch<
        SetStateAction<GroupPreviousInstanceRow[]>
    >;
    onRefresh: () => void;
    onJoin: () => void;
    onLeave: () => void;
    onCancelRequest: () => void;
    onRepresent: (enabled: boolean) => void;
    onSubscribe: (enabled: boolean) => void;
    onVisibility: (visibility: string) => void;
    onBlock: (enabled: boolean) => void;
};

export type GroupDialogTabModel = {
    activeInstances: GroupDialogInstanceRow[];
    activeTab: string;
    bannerUrl: string;
    canManagePosts: boolean;
    currentUserId: string | null;
    filteredMembers: {
        rows: GroupMemberRow[];
        source: GroupMemberRow[];
    };
    filteredPosts: EntityRecord[];
    group: GroupProfileRecord;
    groupEvents: GroupCalendarEventRecord[];
    groupEventsError: string;
    groupEventsStatus: string;
    groupTitle: string;
    groupUrl: string;
    joinState: string;
    memberRoleId: string;
    memberSort: string;
    memberStatus: string;
    ownerLabel: string;
    photos: EntityRecord[];
    posts: EntityRecord[];
    previousInstances: GroupPreviousInstanceRow[];
    remoteErrors: GroupRemoteErrors;
    remoteStatus: GroupRemoteStatus;
    search: GroupDialogSearch;
    tabs: { value: string; label: ReactNode }[];
};

export type GroupDialogTabCommands = {
    onChangeTab: (tab: string) => void;
    onCopyGroupUrl: () => void;
    onDeletePost: (post: EntityRecord) => void;
    onDownloadMembersJson: () => void;
    onEditPost: (post: EntityRecord) => void;
    onLoadAllMembers: () => void;
    onMemberRoleChange: (value: string) => void;
    onMemberSortChange: (value: string) => void;
    onOpenLink: (url: string) => void;
    onOpenOwner: () => void;
    onOpenUser: (
        userId: string,
        title?: string,
        seedData?: UserProfileEntity | null
    ) => void;
    onPreviousInstancesChange: Dispatch<
        SetStateAction<GroupPreviousInstanceRow[]>
    >;
    onPreviewImage: (url: string, title: string) => void;
    onPreviewRowImage: (url: string, title: string) => void;
    onRefreshEvents: () => void;
    onRefreshMembers: () => void;
    onSearchMembersChange: (value: string) => void;
    onSearchPostsChange: (value: string) => void;
    onToggleEventFollow: (event: GroupCalendarEventRecord) => void;
};
