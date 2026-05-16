// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    getEventGroupId,
    getEventId
} from '@/components/hosts/tools-dialogs/toolsDialogUtils.js';
import {
    convertFileUrlToImageUrl,
    copyTextToClipboard,
    openExternalLink
} from '@/lib/entityMedia.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import {
    groupProfileRepository,
    toolsRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { replaceBioSymbols } from '@/shared/utils/base/string.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import {
    EntityDialogScaffold,
    EntityDialogTwoColumnLayout
} from './EntityDialogScaffold';
import { downloadJsonFile } from './group-dialog/groupDialogDownloads.js';
import {
    filterGroupMembers,
    filterGroupPosts,
    getGroupDialogTabs
} from './group-dialog/groupDialogFilters.js';
import { GroupDialogHeaderSection } from './group-dialog/GroupDialogHeaderSection';
import { GroupDialogTabPanels } from './group-dialog/GroupDialogTabPanels';
import {
    firstArray,
    hasGroupModerationPermission,
    hasGroupPermission
} from './group-dialog/groupDialogUtils.js';
import { shouldShowGroupBadgeValue } from './group-dialog/GroupDialogViewParts';
import { GroupModerationToolsDialog } from './group-dialog/GroupModerationToolsDialog';
import { GroupPostEditorDialog } from './group-dialog/GroupPostEditorDialog';
import { useGroupDialogLanguageRows } from './group-dialog/useGroupDialogLanguageRows.js';
import { useGroupDialogPosts } from './group-dialog/useGroupDialogPosts.js';
let lastGroupDialogTab = 'overview';

function resolveGroupDialogTab(tabs, preferred, fallback = 'overview') {
    return tabs.some((tab) => tab.value === preferred) ? preferred : fallback;
}

function extractGroupEventRows(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (Array.isArray(value?.results)) {
        return value.results;
    }
    if (Array.isArray(value?.json?.results)) {
        return value.json.results;
    }
    return [];
}

function followingEventIds(value) {
    return new Set(
        extractGroupEventRows(value).map(getEventId).filter(Boolean)
    );
}

function normalizeGroupEvent(
    event,
    fallbackGroupId = '',
    { followingIds = null, isFollowing = null } = {}
) {
    const eventId = getEventId(event);
    const resolvedFollowing =
        isFollowing ??
        (followingIds?.has(eventId) ? true : event?.userInterest?.isFollowing);

    return {
        ...event,
        groupId: event?.groupId || fallbackGroupId,
        ownerId: event?.ownerId || event?.groupId || fallbackGroupId,
        userInterest: {
            ...(event?.userInterest || {}),
            isFollowing: Boolean(resolvedFollowing)
        },
        title: replaceBioSymbols(event?.title || ''),
        description: replaceBioSymbols(event?.description || '')
    };
}

export function GroupDialogTabbedView({
    group,
    detail,
    bannerUrl,
    iconUrl,
    actionStatus,
    isMember,
    isBlocked,
    isRepresenting,
    isSubscribedToAnnouncements,
    ownerDisplayName = '',
    memberVisibility,
    memberStatus,
    joinState,
    canJoin,
    activeInstances = [],
    previousInstances = [],
    onPreviousInstancesChange,
    onRefresh,
    onJoin,
    onLeave,
    onCancelRequest,
    onRepresent,
    onSubscribe,
    onVisibility,
    onBlock
}) {
    const { t } = useTranslation();

    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);
    const [activeTab, setActiveTab] = useState('overview');
    const [remoteData, setRemoteData] = useState({
        posts: [],
        members: [],
        photos: []
    });
    const [remoteStatus, setRemoteStatus] = useState({});
    const [remoteErrors, setRemoteErrors] = useState({});
    const [groupEvents, setGroupEvents] = useState([]);
    const [groupEventsStatus, setGroupEventsStatus] = useState('idle');
    const [groupEventsError, setGroupEventsError] = useState('');
    const [search, setSearch] = useState({ posts: '', members: '' });
    const [memberSort, setMemberSort] = useState('joinedAt:desc');
    const [memberRoleId, setMemberRoleId] = useState('');
    const [moderationOpen, setModerationOpen] = useState(false);
    const gallerySignature = Array.isArray(group.galleries)
        ? group.galleries
              .map((gallery) => gallery?.id || '')
              .filter(Boolean)
              .join('|')
        : '';
    const loadContextRef = useRef({
        endpoint: currentEndpoint,
        groupId: group.id,
        gallerySignature
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
            void loadTab('photos', { force: true });
        }
    }, [currentEndpoint, gallerySignature, group.id]);

    function isCurrentLoadContext(context) {
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

    async function loadTab(tab, { force = false } = {}) {
        if (
            !group.id ||
            (!force &&
                (remoteStatus[tab] === 'running' ||
                    remoteStatus[tab] === 'ready'))
        ) {
            return;
        }
        if (!['posts', 'members', 'photos'].includes(tab)) {
            return;
        }

        const loadContext = {
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
            let rows = [];
            if (tab === 'posts') {
                rows = await groupProfileRepository.getAllGroupPosts({
                    groupId: group.id,
                    endpoint: currentEndpoint
                });
            } else if (tab === 'members') {
                rows = await groupProfileRepository.getGroupMembers({
                    groupId: group.id,
                    endpoint: currentEndpoint,
                    sort: memberSort,
                    roleId: memberRoleId,
                    force
                });
            } else if (tab === 'photos') {
                const galleries = Array.isArray(group.galleries)
                    ? group.galleries
                    : [];
                const galleryResults = await Promise.allSettled(
                    galleries.map(async (gallery) => {
                        if (!gallery?.id) {
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
                rows = galleryResults
                    .filter((result) => result.status === 'fulfilled')
                    .flatMap((result) => result.value);
            }
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteData((current) => ({ ...current, [tab]: rows }));
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

    async function loadGroupEvents({ force = false } = {}) {
        if (!group.id) {
            return;
        }

        const requestId = groupEventsRequestRef.current + 1;
        groupEventsRequestRef.current = requestId;
        setGroupEventsStatus('running');
        setGroupEventsError('');
        try {
            const [response, followingResponse] = await Promise.all([
                toolsRepository.getGroupCalendar(
                    { groupId: group.id },
                    { endpoint: currentEndpoint, force }
                ),
                toolsRepository
                    .getFollowingGroupCalendars(
                        { n: 100, offset: 0 },
                        { endpoint: currentEndpoint, force }
                    )
                    .catch(() => [])
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

    async function toggleGroupEventFollow(event) {
        const eventId = getEventId(event);
        const eventGroupId = getEventGroupId(event) || group.id;
        if (!eventId || !eventGroupId) {
            return;
        }
        const nextFollowing = !event?.userInterest?.isFollowing;
        try {
            const nextEvent = await toolsRepository.followGroupEvent(
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

    function changeTab(tab) {
        lastGroupDialogTab = resolveGroupDialogTab(tabs, tab);
        setActiveTab(lastGroupDialogTab);
    }

    useEffect(() => {
        void loadTab(activeTab);
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
        void loadGroupEvents();
    }, [currentEndpoint, group.id]);

    useEffect(() => {
        if (activeTab === 'members') {
            void loadTab('members', { force: true });
        }
    }, [memberRoleId, memberSort]);

    async function loadAllMembers() {
        const loadContext = {
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
            setRemoteData((current) => ({ ...current, members: rows }));
            setRemoteStatus((current) => ({ ...current, members: 'ready' }));
        } catch (error) {
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteStatus((current) => ({ ...current, members: 'error' }));
            setRemoteErrors((current) => ({
                ...current,
                members:
                    error instanceof Error
                        ? error.message
                        : 'Failed to load members.'
            }));
        }
    }

    const groupUrl =
        group.url ||
        (group.id ? `https://vrchat.com/home/group/${group.id}` : '');
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

    async function copyGroupText(text, label) {
        await copyTextToClipboard(text);
        toast.success(
            t('dialog.group.dynamic.value_copied', { value: label })
        );
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
                    : t(
                          'dialog.group.toast.failed_to_send_group_invite'
                      )
            );
        }
    }

    function previewImage(url, title) {
        openImagePreview({ url, title });
    }

    function previewRowImage(url, title) {
        openImagePreview({
            url: convertFileUrlToImageUrl(url, 1024),
            title
        });
    }

    function handleSearchPostsChange(value) {
        setSearch((current) => ({
            ...current,
            posts: value
        }));
    }

    function handleSearchMembersChange(value) {
        setSearch((current) => ({
            ...current,
            members: value
        }));
    }

    function handleMemberRoleChange(value) {
        setMemberRoleId(value === 'all' ? '' : value);
    }

    function handleOpenUser(userId, title, seedData = null) {
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

    const headerState = {
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
    const headerHandlers = {
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
    const tabState = {
        activeInstances,
        activeTab,
        bannerUrl,
        canManagePosts,
        currentEndpoint,
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
    const tabHandlers = {
        onChangeTab: changeTab,
        onCopyGroupUrl: () => copyGroupText(groupUrl, 'Group URL'),
        onDeletePost: (post) => void deleteGroupPost(post),
        onDownloadMembersJson: () =>
            downloadJsonFile(`${group.id}_members.json`, members),
        onEditPost: (post) => void editGroupPost(post),
        onLoadAllMembers: () => void loadAllMembers(),
        onMemberRoleChange: handleMemberRoleChange,
        onMemberSortChange: setMemberSort,
        onOpenLink: openExternalLink,
        onOpenOwner: openGroupOwner,
        onOpenUser: handleOpenUser,
        onPreviousInstancesChange,
        onPreviewImage: previewImage,
        onPreviewRowImage: previewRowImage,
        onRefreshEvents: () => void loadGroupEvents({ force: true }),
        onRefreshMembers: () => void loadTab('members', { force: true }),
        onSearchMembersChange: handleSearchMembersChange,
        onSearchPostsChange: handleSearchPostsChange,
        onToggleEventFollow: (event) => void toggleGroupEventFollow(event)
    };

    return (
        <EntityDialogScaffold className="gap-3">
            <EntityDialogTwoColumnLayout
                railWidth="19rem"
                rail={
                    <GroupDialogHeaderSection
                        state={headerState}
                        handlers={headerHandlers}
                    />
                }
            >
                <GroupDialogTabPanels state={tabState} handlers={tabHandlers} />
            </EntityDialogTwoColumnLayout>
            <GroupPostEditorDialog
                open={Boolean(postEditor)}
                onOpenChange={(open) => {
                    if (!open && !postEditorSubmitting) {
                        setPostEditor(null);
                    }
                }}
                form={postEditor}
                onFormChange={setPostEditor}
                group={group}
                endpoint={currentEndpoint}
                submitting={postEditorSubmitting}
                onSubmit={(form) => void submitGroupPost(form)}
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
