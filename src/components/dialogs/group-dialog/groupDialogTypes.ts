import type { Dispatch, ReactNode, SetStateAction } from 'react';

import type {
    GroupAnnouncementRecord,
    GroupDialogInstanceRow,
    GroupGalleryPhotoRow,
    GroupPostRecord,
    GroupProfileRecord
} from '@/domain/entities/group';
import type { LoadStatus, RemoteTabStatus } from '@/domain/shared/types';
import type { GroupMemberVisibility } from '@/platform/tauri/bindings';
import type { GroupCalendarEventRecord } from '@/repositories/vrchatToolsRepository';

import type { GroupDialogMembersModel } from './useGroupDialogMembers';
import type { GroupPreviousInstanceRow } from './useGroupDialogState';

export type GroupActionStatus =
    | 'idle'
    | 'join'
    | 'leave'
    | 'cancel-request'
    | 'refresh'
    | 'represent'
    | 'member-props'
    | 'block';

export type GroupRemoteTab = 'posts' | 'photos';
type GroupRemoteStatusValue = RemoteTabStatus;

export type GroupRemoteData = {
    posts: GroupPostRecord[];
    photos: GroupGalleryPhotoRow[];
};

export type GroupRemoteStatus = Partial<
    Record<GroupRemoteTab, GroupRemoteStatusValue>
>;
export type GroupRemoteErrors = Partial<Record<GroupRemoteTab, string>>;

export type GroupDialogSearch = {
    posts: string;
};

export type GroupLoadContext = {
    endpoint: string;
    groupId: string;
    gallerySignature: string;
    tab?: GroupRemoteTab;
};

export type GroupDialogResource = {
    group: GroupProfileRecord;
    detail: string;
    actionStatus: GroupActionStatus;
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
    onVisibility: (visibility: GroupMemberVisibility) => void;
    onBlock: (enabled: boolean) => void;
};

export type GroupDialogTabModel = {
    activeInstances: GroupDialogInstanceRow[];
    activeTab: string;
    announcement?: GroupAnnouncementRecord;
    bannerUrl: string;
    canManagePosts: boolean;
    currentUserId: string | null;
    filteredPosts: GroupPostRecord[];
    group: GroupProfileRecord;
    groupEvents: GroupCalendarEventRecord[];
    groupEventsError: string;
    groupEventsStatus: LoadStatus;
    groupTitle: string;
    groupUrl: string;
    joinState: string;
    members: GroupDialogMembersModel;
    memberStatus: string;
    ownerLabel: string;
    photos: GroupGalleryPhotoRow[];
    posts: GroupPostRecord[];
    previousInstances: GroupPreviousInstanceRow[];
    remoteErrors: GroupRemoteErrors;
    remoteStatus: GroupRemoteStatus;
    search: GroupDialogSearch;
    tabs: { value: string; label: ReactNode }[];
};

export type GroupDialogTabCommands = {
    onChangeTab: (tab: string) => void;
    onCopyGroupUrl: () => void;
    onDeletePost: (post: GroupPostRecord) => void;
    onEditPost: (post: GroupPostRecord) => void;
    onExportMembers: (scope: 'loaded' | 'all') => void;
    onLoadMoreMembers: () => void;
    onOpenLink: (url: string) => void;
    onOpenOwner: () => void;
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
