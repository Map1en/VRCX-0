import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    getEventGroupId,
    getEventId
} from '@/components/hosts/tools-dialogs/toolsDialogUtils';
import type { UserProfileEntity } from '@/domain/entities/profileEntities';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import vrchatToolsRepository, {
    type GroupCalendarEventRecord
} from '@/repositories/vrchatToolsRepository';
import { copyTextToClipboard } from '@/services/clipboardService';
import { openUserDialog } from '@/services/dialogService';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/services/entityMediaService';
import { vrchatGroupUrl } from '@/shared/constants/vrchatWebUrls';

import {
    EntityDialogScaffold,
    EntityDialogTwoColumnLayout
} from '../EntityDialogScaffold';
import { downloadJsonFile } from './groupDialogDownloads';
import {
    filterGroupMembers,
    filterGroupPosts,
    getGroupDialogTabs
} from './groupDialogFilters';
import { GroupDialogHeaderSection } from './GroupDialogHeaderSection';
import { GroupDialogTabPanels } from './GroupDialogTabPanels';
import type {
    GroupDialogControls,
    GroupDialogResource,
    GroupDialogSearch,
    GroupDialogTabCommands,
    GroupDialogTabModel,
    GroupDialogView,
    GroupLoadContext,
    GroupRemoteData,
    GroupRemoteErrors,
    GroupRemoteStatus,
    GroupRemoteTab
} from './groupDialogTypes';
import {
    extractGroupEventRows,
    firstArray,
    followingEventIds,
    hasGroupModerationPermission,
    hasGroupPermission,
    normalizeGroupEvent,
    resolveGroupDialogTab
} from './groupDialogUtils';
import { shouldShowGroupBadgeValue } from './GroupDialogViewParts';
import { GroupModerationToolsDialog } from './GroupModerationToolsDialog';
import { GroupPostEditorDialog } from './GroupPostEditorDialog';
import { useGroupDialogLanguageRows } from './useGroupDialogLanguageRows';
import { useGroupDialogPosts } from './useGroupDialogPosts';
import type { GroupPostForm } from './useGroupDialogPosts';
import { useGroupDialogTabbedRuntimeState } from './useGroupDialogTabbedRuntimeState';

let lastGroupDialogTab = 'overview';

function isGroupRemoteTab(value: string): value is GroupRemoteTab {
    return value === 'posts' || value === 'members' || value === 'photos';
}

export function GroupDialogTabbedView({
    groupControls,
    groupResource,
    groupView
}: {
    groupControls: GroupDialogControls;
    groupResource: GroupDialogResource;
    groupView: GroupDialogView;
}) {
    const { t } = useTranslation();
    const {
        group,
        detail,
        actionStatus,
        activeInstances = [],
        previousInstances = []
    } = groupResource;
    const {
        bannerUrl,
        iconUrl,
        isMember,
        isBlocked,
        isRepresenting,
        isSubscribedToAnnouncements,
        ownerDisplayName = '',
        memberVisibility,
        memberStatus,
        joinState,
        canJoin
    } = groupView;
    const {
        onPreviousInstancesChange,
        onRefresh,
        onJoin,
        onLeave,
        onCancelRequest,
        onRepresent,
        onSubscribe,
        onVisibility,
        onBlock
    } = groupControls;

    const {
        confirm,
        currentEndpoint,
        currentUserId,
        openImagePreview,
        prompt
    } = useGroupDialogTabbedRuntimeState();
    const [activeTab, setActiveTab] = useState('overview');
    const [remoteData, setRemoteData] = useState<GroupRemoteData>({
        posts: [],
        members: [],
        photos: []
    });
    const [remoteStatus, setRemoteStatus] = useState<GroupRemoteStatus>({});
    const [remoteErrors, setRemoteErrors] = useState<GroupRemoteErrors>({});
    const [groupEvents, setGroupEvents] = useState<GroupCalendarEventRecord[]>(
        []
    );
    const [groupEventsStatus, setGroupEventsStatus] = useState('idle');
    const [groupEventsError, setGroupEventsError] = useState('');
    const [search, setSearch] = useState<GroupDialogSearch>({
        posts: '',
        members: ''
    });
    const [memberSort, setMemberSort] = useState('joinedAt:desc');
    const [memberRoleId, setMemberRoleId] = useState('');
    const [moderationOpen, setModerationOpen] = useState(false);
    const gallerySignature = Array.isArray(group.galleries)
        ? group.galleries
              .map((gallery) => gallery.id || '')
              .filter(Boolean)
              .join('|')
        : '';
    const loadContextRef = useRef<GroupLoadContext>({
        endpoint: currentEndpoint,
        groupId: group.id,
        gallerySignature,
        memberSort: 'joinedAt:desc',
        memberRoleId: ''
    });
    const groupEventsRequestRef = useRef(0);
    const tabs = getGroupDialogTabs(t);
    const posts =
        remoteStatus.posts === 'ready'
            ? remoteData.posts
            : firstArray(
                  group.posts,
                  group.announcement?.id ? [group.announcement] : []
              );
    const members =
        remoteStatus.members === 'ready'
            ? remoteData.members
            : firstArray(group.members);
    const photos =
        remoteStatus.photos === 'ready'
            ? remoteData.photos
            : firstArray(group.gallery, group.photos);
    const isPrivateGroup = group.privacy === 'private';
    const languageRows = useGroupDialogLanguageRows({
        currentEndpoint,
        group
    });
    const canSetVisibility = group.privacy === 'default';
    const isGroupOwner = group.ownerId === currentUserId;
    const canManagePosts =
        isGroupOwner || hasGroupPermission(group, 'group-announcement-manage');
    const canInviteToGroup =
        isGroupOwner || hasGroupPermission(group, 'group-invites-manage');
    const canModerateGroup = hasGroupModerationPermission(group);
    const filteredPosts = filterGroupPosts(posts, search.posts);
    const filteredMembers = filterGroupMembers(members, search.members);

    useEffect(() => {
        loadContextRef.current = {
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature,
            memberSort: 'joinedAt:desc',
            memberRoleId: ''
        };
        setRemoteData({ posts: [], members: [], photos: [] });
        setRemoteStatus({});
        setRemoteErrors({});
        groupEventsRequestRef.current += 1;
        setGroupEvents([]);
        setGroupEventsStatus('idle');
        setGroupEventsError('');
        setSearch({ posts: '', members: '' });
        setMemberSort('joinedAt:desc');
        setMemberRoleId('');
        const nextTab = resolveGroupDialogTab(tabs, lastGroupDialogTab);
        lastGroupDialogTab = nextTab;
        setActiveTab(nextTab);
    }, [currentEndpoint, group.id]);

    useEffect(() => {
        loadContextRef.current = {
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature,
            memberSort,
            memberRoleId
        };

        setRemoteData((current) => ({ ...current, photos: [] }));
        setRemoteStatus((current) => {
            if (!current.photos) {
                return current;
            }
            return { ...current, photos: '' };
        });
        if (activeTab === 'photos' && gallerySignature) {
            loadTab('photos', { force: true });
        }
    }, [currentEndpoint, gallerySignature, group.id]);

    function isCurrentLoadContext(context: GroupLoadContext) {
        return (
            loadContextRef.current.endpoint === context.endpoint &&
            loadContextRef.current.groupId === context.groupId &&
            (context.tab !== 'photos' ||
                loadContextRef.current.gallerySignature ===
                    context.gallerySignature) &&
            (context.tab !== 'members' ||
                (loadContextRef.current.memberSort === context.memberSort &&
                    loadContextRef.current.memberRoleId ===
                        context.memberRoleId))
        );
    }

    async function loadTab(
        tab: string,
        { force = false }: { force?: boolean } = {}
    ) {
        if (!isGroupRemoteTab(tab)) {
            return;
        }
        if (
            !group.id ||
            (!force &&
                (remoteStatus[tab] === 'running' ||
                    remoteStatus[tab] === 'ready'))
        ) {
            return;
        }
        const loadContext: GroupLoadContext = {
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature,
            memberSort,
            memberRoleId,
            tab
        };
        loadContextRef.current = {
            ...loadContextRef.current,
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature,
            memberSort,
            memberRoleId
        };
        setRemoteStatus((current) => ({ ...current, [tab]: 'running' }));
        setRemoteErrors((current) => ({ ...current, [tab]: '' }));
        try {
            if (tab === 'posts') {
                const rows = await groupProfileRepository.getAllGroupPosts({
                    groupId: group.id,
                    endpoint: currentEndpoint
                });
                if (!isCurrentLoadContext(loadContext)) {
                    return;
                }
                setRemoteData((current) => ({ ...current, posts: rows }));
            } else if (tab === 'members') {
                const rows = await groupProfileRepository.getGroupMembers({
                    groupId: group.id,
                    endpoint: currentEndpoint,
                    sort: memberSort,
                    roleId: memberRoleId,
                    force
                });
                if (!isCurrentLoadContext(loadContext)) {
                    return;
                }
                setRemoteData((current) => ({ ...current, members: rows }));
            } else if (tab === 'photos') {
                const galleries = Array.isArray(group.galleries)
                    ? group.galleries
                    : [];
                const galleryResults = await Promise.allSettled(
                    galleries.map(async (gallery) => {
                        if (!gallery.id) {
                            return [];
                        }
                        const entries =
                            await groupProfileRepository.getAllGroupGallery({
                                groupId: group.id,
                                galleryId: gallery.id,
                                endpoint: currentEndpoint,
                                force
                            });
                        return entries.map((entry) => ({
                            ...entry,
                            $galleryId: gallery.id,
                            $galleryName: gallery.name || gallery.id
                        }));
                    })
                );
                const rows = galleryResults.flatMap((result) =>
                    result.status === 'fulfilled' ? result.value : []
                );
                if (!isCurrentLoadContext(loadContext)) {
                    return;
                }
                setRemoteData((current) => ({ ...current, photos: rows }));
            }
            setRemoteStatus((current) => ({ ...current, [tab]: 'ready' }));
        } catch (error) {
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteStatus((current) => ({ ...current, [tab]: 'error' }));
            setRemoteErrors((current) => ({
                ...current,
                [tab]:
                    error instanceof Error
                        ? error.message
                        : 'Failed to load tab data.'
            }));
        }
    }

    async function loadGroupEvents({
        force = false
    }: { force?: boolean } = {}) {
        if (!group.id) {
            return;
        }

        const requestId = groupEventsRequestRef.current + 1;
        groupEventsRequestRef.current = requestId;
        setGroupEventsStatus('running');
        setGroupEventsError('');
        try {
            const [response, followingResponse] = await Promise.all([
                vrchatToolsRepository.getGroupCalendar(
                    { groupId: group.id },
                    { endpoint: currentEndpoint, force }
                ),
                vrchatToolsRepository
                    .getFollowingGroupCalendars(
                        { n: 100, offset: 0 },
                        { endpoint: currentEndpoint, force }
                    )
                    .catch((): never[] => [])
            ]);
            if (requestId !== groupEventsRequestRef.current) {
                return;
            }
            const followingIds = followingEventIds(followingResponse);
            setGroupEvents(
                extractGroupEventRows(response).map((event) =>
                    normalizeGroupEvent(event, group.id, { followingIds })
                )
            );
            setGroupEventsStatus('ready');
        } catch (error) {
            if (requestId !== groupEventsRequestRef.current) {
                return;
            }
            setGroupEventsStatus('error');
            setGroupEventsError(
                userFacingErrorMessage(
                    error,
                    t('dialog.group.events.failed_to_load')
                )
            );
        }
    }

    async function toggleGroupEventFollow(event: GroupCalendarEventRecord) {
        const eventId = getEventId(event);
        const eventGroupId = getEventGroupId(event) || group.id;
        if (!eventId || !eventGroupId) {
            return;
        }
        const nextFollowing = !event?.userInterest?.isFollowing;
        try {
            const nextEvent = await vrchatToolsRepository.followGroupEvent(
                {
                    groupId: eventGroupId,
                    eventId,
                    isFollowing: nextFollowing
                },
                { endpoint: currentEndpoint }
            );
            setGroupEvents((current) =>
                current.map((row) =>
                    getEventId(row) === eventId
                        ? normalizeGroupEvent(
                              {
                                  ...row,
                                  ...nextEvent,
                                  userInterest: {
                                      ...(row?.userInterest || {}),
                                      ...(nextEvent?.userInterest || {}),
                                      isFollowing: nextFollowing
                                  }
                              },
                              eventGroupId,
                              { isFollowing: nextFollowing }
                          )
                        : row
                )
            );
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t(
                        'host.tools_dialogs.toast.failed_to_update_group_event_follow_state'
                    )
                )
            );
        }
    }

    function changeTab(tab: string) {
        lastGroupDialogTab = resolveGroupDialogTab(tabs, tab);
        setActiveTab(lastGroupDialogTab);
    }

    useEffect(() => {
        loadTab(activeTab);
    }, [
        activeTab,
        currentEndpoint,
        gallerySignature,
        group.id,
        memberRoleId,
        memberSort
    ]);

    useEffect(() => {
        if (!group.id) {
            return;
        }
        loadGroupEvents();
    }, [currentEndpoint, group.id]);

    useEffect(() => {
        if (activeTab === 'members') {
            loadTab('members', { force: true });
        }
    }, [memberRoleId, memberSort]);

    async function loadAllMembers() {
        const loadContext: GroupLoadContext = {
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature,
            memberSort,
            memberRoleId,
            tab: 'members'
        };
        loadContextRef.current = {
            ...loadContextRef.current,
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature,
            memberSort,
            memberRoleId
        };
        setRemoteStatus((current) => ({ ...current, members: 'running' }));
        setRemoteErrors((current) => ({ ...current, members: '' }));
        try {
            const rows = await groupProfileRepository.getAllGroupMembers({
                groupId: group.id,
                endpoint: currentEndpoint,
                sort: memberSort,
                roleId: memberRoleId,
                force: true
            });
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteData((current) => ({
                ...current,
                members: rows
            }));
            setRemoteStatus((current) => ({
                ...current,
                members: 'ready'
            }));
        } catch (error) {
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteStatus((current) => ({
                ...current,
                members: 'error'
            }));
            setRemoteErrors((current) => ({
                ...current,
                members:
                    error instanceof Error
                        ? error.message
                        : 'Failed to load members.'
            }));
        }
    }

    const groupUrl = group.url || (group.id ? vrchatGroupUrl(group.id) : '');
    const groupTitle = group.name || 'Group';
    const ownerLabel =
        ownerDisplayName && ownerDisplayName !== group.ownerId
            ? ownerDisplayName
            : '';
    const ownerLinkLabel = isGroupOwner
        ? 'You'
        : ownerLabel || group.ownerId || 'Owner';
    const showPrivacyBadge = shouldShowGroupBadgeValue(group.privacy);
    const showMembershipBadge = shouldShowGroupBadgeValue(
        group.membershipStatus
    );

    function copyGroupText(text: string, label: string) {
        return copyTextToClipboard(text, {
            successMessage: t('dialog.group.dynamic.value_copied', {
                value: label
            })
        });
    }

    function openGroupOwner() {
        if (!group.ownerId) {
            return;
        }
        openUserDialog({
            userId: group.ownerId,
            title: ownerLabel || undefined,
            seedData: ownerLabel
                ? {
                      id: group.ownerId,
                      displayName: ownerLabel
                  }
                : null
        });
    }

    async function inviteUserToGroup() {
        const result = await prompt({
            title: t('dialog.group.modal.invite_to_group'),
            description: t(
                'dialog.group.modal.enter_the_vrchat_user_id_to_invite'
            ),
            inputValue: '',
            confirmText: t('dialog.invite_to_group.invite'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            await groupProfileRepository.sendGroupInvite({
                groupId: group.id,
                userId: result.value,
                endpoint: currentEndpoint
            });
            toast.success(t('dialog.group.success.group_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.group.toast.failed_to_send_group_invite')
            );
        }
    }

    function previewImage(url: string, title: string) {
        openImagePreview({ url, title });
    }

    function previewRowImage(url: string, title: string) {
        openImagePreview({
            url: convertFileUrlToImageUrl(url, 1024),
            title
        });
    }

    function handleSearchPostsChange(value: string) {
        setSearch((current) => ({
            ...current,
            posts: value
        }));
    }

    function handleSearchMembersChange(value: string) {
        setSearch((current) => ({
            ...current,
            members: value
        }));
    }

    function handleMemberRoleChange(value: string) {
        setMemberRoleId(value === 'all' ? '' : value);
    }

    function handleOpenUser(
        userId: string,
        title?: string,
        seedData: UserProfileEntity | null = null
    ) {
        if (!userId) {
            return;
        }
        openUserDialog({ userId, title, seedData });
    }
    const {
        createGroupPost,
        deleteGroupPost,
        editGroupPost,
        postEditor,
        postEditorSubmitting,
        setPostEditor,
        submitGroupPost
    } = useGroupDialogPosts({
        confirm,
        currentEndpoint,
        group,
        loadTab,
        onPostsSaved: () => {
            lastGroupDialogTab = 'posts';
            setActiveTab('posts');
        },
        setRemoteData,
        setRemoteStatus,
        t
    });

    const headerModel = {
        actionStatus,
        canInviteToGroup,
        canJoin,
        canManagePosts,
        canModerateGroup,
        canSetVisibility,
        detail,
        group,
        groupTitle,
        groupUrl,
        iconUrl,
        isBlocked,
        isMember,
        isPrivateGroup,
        isRepresenting,
        isSubscribedToAnnouncements,
        languageRows,
        joinState,
        memberStatus,
        memberVisibility,
        ownerLinkLabel,
        remoteStatus,
        showMembershipBadge,
        showPrivacyBadge
    };
    const headerCommands = {
        onBlockToggle: () => onBlock(!isBlocked),
        onCancelRequest,
        onCopyGroupId: () => copyGroupText(group.id, 'Group ID'),
        onCopyGroupName: () => copyGroupText(group.name, 'Group name'),
        onCopyGroupUrl: () => copyGroupText(groupUrl, 'Group URL'),
        onCreateGroupPost: createGroupPost,
        onJoin,
        onLeave,
        onOpenGroupPage: () => openExternalLink(groupUrl),
        onOpenModeration: () => setModerationOpen(true),
        onOpenOwner: openGroupOwner,
        onPreviewIcon: () => previewImage(iconUrl, groupTitle),
        onRefresh,
        onRepresentToggle: () => onRepresent(!isRepresenting),
        onSubscribeToggle: () => onSubscribe(!isSubscribedToAnnouncements),
        onInviteUserToGroup: inviteUserToGroup,
        onVisibilityChange: onVisibility
    };
    const tabModel: GroupDialogTabModel = {
        activeInstances,
        activeTab,
        bannerUrl,
        canManagePosts,
        currentUserId,
        filteredMembers: {
            rows: filteredMembers,
            source: members
        },
        filteredPosts,
        group,
        groupEvents,
        groupEventsError,
        groupEventsStatus,
        groupTitle,
        groupUrl,
        joinState,
        memberRoleId,
        memberSort,
        memberStatus,
        ownerLabel,
        photos,
        posts,
        previousInstances,
        remoteErrors,
        remoteStatus,
        search,
        tabs
    };
    const tabCommands: GroupDialogTabCommands = {
        onChangeTab: changeTab,
        onCopyGroupUrl: () => copyGroupText(groupUrl, 'Group URL'),
        onDeletePost: (post) => {
            deleteGroupPost(post);
        },
        onDownloadMembersJson: () =>
            downloadJsonFile(`${group.id}_members.json`, members),
        onEditPost: (post) => {
            editGroupPost(post);
        },
        onLoadAllMembers: () => {
            loadAllMembers();
        },
        onMemberRoleChange: handleMemberRoleChange,
        onMemberSortChange: setMemberSort,
        onOpenLink: openExternalLink,
        onOpenOwner: openGroupOwner,
        onOpenUser: handleOpenUser,
        onPreviousInstancesChange,
        onPreviewImage: previewImage,
        onPreviewRowImage: previewRowImage,
        onRefreshEvents: () => {
            loadGroupEvents({ force: true });
        },
        onRefreshMembers: () => {
            loadTab('members', { force: true });
        },
        onSearchMembersChange: handleSearchMembersChange,
        onSearchPostsChange: handleSearchPostsChange,
        onToggleEventFollow: (event) => {
            toggleGroupEventFollow(event);
        }
    };

    return (
        <EntityDialogScaffold className="gap-3">
            <EntityDialogTwoColumnLayout
                railWidth="19rem"
                rail={
                    <GroupDialogHeaderSection
                        headerModel={headerModel}
                        headerCommands={headerCommands}
                    />
                }
            >
                <GroupDialogTabPanels
                    tabModel={tabModel}
                    tabCommands={tabCommands}
                />
            </EntityDialogTwoColumnLayout>
            <GroupPostEditorDialog
                open={Boolean(postEditor)}
                onOpenChange={(open: boolean) => {
                    if (!open && !postEditorSubmitting) {
                        setPostEditor(null);
                    }
                }}
                form={postEditor}
                onFormChange={setPostEditor}
                group={group}
                endpoint={currentEndpoint}
                submitting={postEditorSubmitting}
                onSubmit={(form: GroupPostForm) => {
                    submitGroupPost(form);
                }}
            />
            <GroupModerationToolsDialog
                open={moderationOpen}
                onOpenChange={setModerationOpen}
                group={group}
                endpoint={currentEndpoint}
            />
        </EntityDialogScaffold>
    );
}
