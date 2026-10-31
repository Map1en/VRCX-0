import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
    getEventGroupId,
    getEventId
} from '@/components/hosts/tools-dialogs/toolsDialogUtils';
import type { LoadStatus } from '@/domain/shared/types';
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
import { recordToolOpen } from '@/services/telemetry/telemetryToolUsage';
import { toast } from '@/services/toastService';
import { vrchatGroupUrl } from '@/shared/constants/vrchatWebUrls';
import { useDialogStore } from '@/state/dialogStore';

import {
    EntityDialogScaffold,
    EntityDialogTwoColumnLayout
} from '../EntityDialogScaffold';
import { ProfileMediaPanel } from '../ProfileMediaPanel';
import { downloadJsonFile } from './groupDialogDownloads';
import { filterGroupPosts, getGroupDialogTabs } from './groupDialogFilters';
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
    GROUP_PROFILE_MEDIA_SECTIONS,
    groupProfileUpdateFromGroup,
    hasGroupModerationPermission,
    hasGroupPermission,
    normalizeGroupEvent,
    resolveGroupDialogTab
} from './groupDialogUtils';
import { shouldShowGroupBadgeValue } from './GroupDialogViewParts';
import { GroupEventEditorDialog } from './GroupEventEditorDialog';
import { staffRoleIdsOf } from './GroupMembersPanel';
import { GroupPostEditorDialog } from './GroupPostEditorDialog';
import { GroupProfileEditDialog } from './GroupProfileEditDialog';
import { GroupRolesDialog } from './GroupRolesDialog';
import { useGroupDialogLanguageRows } from './useGroupDialogLanguageRows';
import { useGroupDialogMembers } from './useGroupDialogMembers';
import { useGroupDialogPosts } from './useGroupDialogPosts';
import type { GroupPostForm } from './useGroupDialogPosts';
import { useGroupDialogTabbedRuntimeState } from './useGroupDialogTabbedRuntimeState';
import { useGroupEventEditor } from './useGroupEventEditor';

let lastGroupDialogTab = 'overview';

function isGroupRemoteTab(value: string): value is GroupRemoteTab {
    return value === 'posts' || value === 'photos';
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
    const navigate = useNavigate();
    const closeDialog = useDialogStore((state) => state.closeDialog);
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
        canJoin,
        canLeave,
        canDelete
    } = groupView;
    const {
        onPreviousInstancesChange,
        onRefresh,
        onReloadProfile,
        onJoin,
        onLeave,
        onDelete,
        onCancelRequest,
        onRepresent,
        onSubscribe,
        onVisibility,
        onBlock,
        onUpdateProfile
    } = groupControls;

    const {
        confirm,
        currentEndpoint,
        currentUserId,
        openImagePreview,
        prompt
    } = useGroupDialogTabbedRuntimeState();
    const [activeTab, setActiveTab] = useState('overview');
    const [profileEditorOpen, setProfileEditorOpen] = useState(false);
    const [profileMediaOpen, setProfileMediaOpen] = useState(false);
    const [remoteData, setRemoteData] = useState<GroupRemoteData>({
        posts: [],
        photos: []
    });
    const [remoteStatus, setRemoteStatus] = useState<GroupRemoteStatus>({});
    const [remoteErrors, setRemoteErrors] = useState<GroupRemoteErrors>({});
    const [groupEvents, setGroupEvents] = useState<GroupCalendarEventRecord[]>(
        []
    );
    const [groupEventsStatus, setGroupEventsStatus] =
        useState<LoadStatus>('idle');
    const [groupEventsError, setGroupEventsError] = useState('');
    const [search, setSearch] = useState<GroupDialogSearch>({
        posts: ''
    });
    const gallerySignature = Array.isArray(group.galleries)
        ? group.galleries
              .map((gallery) => gallery.id || '')
              .filter(Boolean)
              .join('|')
        : '';
    const loadContextRef = useRef<GroupLoadContext>({
        endpoint: currentEndpoint,
        groupId: group.id,
        gallerySignature
    });
    const groupEventsRequestRef = useRef(0);
    const groupFollowingRequestRef = useRef(0);
    const followingEventIdsRef = useRef<Set<string>>(new Set());
    const tabs = getGroupDialogTabs(t, Boolean(group.storeId));
    const posts =
        remoteStatus.posts === 'ready'
            ? remoteData.posts
            : firstArray(
                  group.posts,
                  group.announcement?.id ? [group.announcement] : []
              );
    const announcement =
        remoteStatus.posts === 'ready'
            ? remoteData.posts[0]
            : (posts[0] ?? group.announcement);
    const groupMembers = useGroupDialogMembers({
        endpoint: currentEndpoint,
        groupId: group.id,
        active: activeTab === 'members',
        totalCount:
            typeof group.memberCount === 'number' ? group.memberCount : null,
        staffRoleIds: staffRoleIdsOf(group),
        seedRows: firstArray(group.members)
    });
    const photos =
        remoteStatus.photos === 'ready'
            ? remoteData.photos
            : firstArray(group.gallery, group.photos);
    const isPrivateGroup = group.privacy === 'private';
    const languageRows = useGroupDialogLanguageRows({
        group
    });
    const canSetVisibility = group.privacy === 'default';
    const isGroupOwner = group.ownerId === currentUserId;
    const canManagePosts =
        isGroupOwner || hasGroupPermission(group, 'group-announcement-manage');
    const canInviteToGroup =
        isGroupOwner || hasGroupPermission(group, 'group-invites-manage');
    const canManageCalendar =
        isGroupOwner || hasGroupPermission(group, 'group-calendar-manage');
    const canManageRoles =
        hasGroupPermission(group, 'group-roles-manage') ||
        hasGroupPermission(group, 'group-default-role-manage');
    const [rolesOpen, setRolesOpen] = useState(false);
    const canModerateGroup = hasGroupModerationPermission(group);
    const profileUpdate = groupProfileUpdateFromGroup(group);
    const canEditProfile =
        profileUpdate !== null &&
        (isGroupOwner || hasGroupPermission(group, 'group-data-manage'));
    const filteredPosts = filterGroupPosts(posts, search.posts);

    const resetForTarget = useEffectEvent(() => {
        loadContextRef.current = {
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature
        };
        setRemoteData({ posts: [], photos: [] });
        setRemoteStatus({});
        setRemoteErrors({});
        groupEventsRequestRef.current += 1;
        groupFollowingRequestRef.current += 1;
        followingEventIdsRef.current = new Set();
        setGroupEvents([]);
        setGroupEventsStatus('idle');
        setGroupEventsError('');
        setSearch({ posts: '' });
        setProfileEditorOpen(false);
        setProfileMediaOpen(false);
        setRolesOpen(false);
        const nextTab = resolveGroupDialogTab(tabs, lastGroupDialogTab);
        lastGroupDialogTab = nextTab;
        setActiveTab(nextTab);
    });

    useEffect(() => {
        resetForTarget();
    }, [currentEndpoint, group.id]);

    const syncGalleryContext = useEffectEvent(() => {
        loadContextRef.current = {
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature
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
    });

    useEffect(() => {
        syncGalleryContext();
    }, [currentEndpoint, gallerySignature, group.id]);

    function isCurrentLoadContext(context: GroupLoadContext) {
        return (
            loadContextRef.current.endpoint === context.endpoint &&
            loadContextRef.current.groupId === context.groupId &&
            (context.tab !== 'photos' ||
                loadContextRef.current.gallerySignature ===
                    context.gallerySignature)
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
            tab
        };
        loadContextRef.current = {
            ...loadContextRef.current,
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature
        };
        setRemoteStatus((current) => ({ ...current, [tab]: 'running' }));
        setRemoteErrors((current) => ({ ...current, [tab]: '' }));
        try {
            if (tab === 'posts') {
                const rows = await groupProfileRepository.getAllGroupPosts({
                    groupId: group.id
                });
                if (!isCurrentLoadContext(loadContext)) {
                    return;
                }
                setRemoteData((current) => ({ ...current, posts: rows }));
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
            const response = await vrchatToolsRepository.getGroupCalendar(
                { groupId: group.id },
                { force }
            );
            if (requestId !== groupEventsRequestRef.current) {
                return;
            }
            setGroupEvents(
                extractGroupEventRows(response).map((event) =>
                    normalizeGroupEvent(event, group.id, {
                        followingIds: followingEventIdsRef.current
                    })
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

    async function loadFollowingGroupEvents({
        force = false
    }: { force?: boolean } = {}) {
        if (!group.id) {
            return;
        }

        const requestId = groupFollowingRequestRef.current + 1;
        groupFollowingRequestRef.current = requestId;
        try {
            const response =
                await vrchatToolsRepository.getFollowingGroupCalendars(
                    { n: 100, offset: 0 },
                    { force }
                );
            if (requestId !== groupFollowingRequestRef.current) {
                return;
            }
            const nextFollowingEventIds = followingEventIds(response);
            followingEventIdsRef.current = nextFollowingEventIds;
            setGroupEvents((current) =>
                current.map((event) =>
                    normalizeGroupEvent(event, group.id, {
                        followingIds: nextFollowingEventIds
                    })
                )
            );
        } catch {
            return;
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
            const nextEvent = await vrchatToolsRepository.followGroupEvent({
                groupId: eventGroupId,
                eventId,
                isFollowing: nextFollowing
            });
            if (nextFollowing) {
                followingEventIdsRef.current.add(eventId);
            } else {
                followingEventIdsRef.current.delete(eventId);
            }
            setGroupEvents((current) =>
                current.map((row) =>
                    getEventId(row) === eventId
                        ? normalizeGroupEvent(
                              {
                                  ...row,
                                  ...nextEvent,
                                  userInterest: {
                                      ...row?.userInterest,
                                      ...nextEvent?.userInterest,
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
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t(
                        'host.tools_dialogs.toast.failed_to_update_group_event_follow_state'
                    )
                )
            });
        }
    }

    function changeTab(tab: string) {
        lastGroupDialogTab = resolveGroupDialogTab(tabs, tab);
        setActiveTab(lastGroupDialogTab);
    }

    const loadPostsForTarget = useEffectEvent(() => {
        loadTab('posts', { force: true });
    });

    useEffect(() => {
        loadPostsForTarget();
    }, [currentEndpoint, group.id]);

    const loadActiveTab = useEffectEvent(() => {
        if (activeTab !== 'posts' || remoteStatus.posts === 'error') {
            loadTab(activeTab);
        }
    });

    useEffect(() => {
        loadActiveTab();
    }, [activeTab, currentEndpoint, gallerySignature, group.id]);

    const loadEventsForTarget = useEffectEvent(() => {
        if (!group.id) {
            return;
        }
        loadGroupEvents();
    });

    useEffect(() => {
        loadEventsForTarget();
    }, [currentEndpoint, group.id]);

    const loadFollowingEventsForActiveTab = useEffectEvent(() => {
        if (activeTab === 'events') {
            loadFollowingGroupEvents();
        }
    });

    useEffect(() => {
        loadFollowingEventsForActiveTab();
    }, [activeTab, currentEndpoint, group.id]);

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
                userId: result.value
            });
            toast.add({
                type: 'success',
                title: t('dialog.group.success.group_invite_sent')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('dialog.group.toast.failed_to_send_group_invite')
            });
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

    async function exportMembers(scope: 'loaded' | 'all') {
        const rows =
            scope === 'all'
                ? await groupMembers.loadAll().catch((error: unknown) => {
                      toast.add({
                          type: 'error',
                          title: userFacingErrorMessage(
                              error,
                              t('dialog.group.members.failed_to_load')
                          )
                      });
                      return null;
                  })
                : groupMembers.model.rows;
        if (rows) {
            downloadJsonFile(`${group.id}_members.json`, rows);
        }
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
        group,
        loadTab,
        onPostsSaved: () => {
            lastGroupDialogTab = 'posts';
            setActiveTab('posts');
        },
        setRemoteData,
        setRemoteStatus
    });

    const eventEditor = useGroupEventEditor({
        group,
        confirm,
        onChanged: () => {
            loadGroupEvents({ force: true });
        }
    });

    const headerModel = {
        actionStatus,
        canDelete,
        canInviteToGroup,
        canEditProfile,
        canJoin,
        canLeave,
        canManageCalendar,
        canManagePosts,
        canManageRoles,
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
        onCopyGroupId: () => copyGroupText(group.id, t('dialog.group.info.id')),
        onCopyGroupName: () =>
            copyGroupText(group.name, t('dialog.group.info.name')),
        onCopyGroupUrl: () =>
            copyGroupText(groupUrl, t('dialog.group.info.url')),
        onCreateGroupEvent: eventEditor.openCreate,
        onOpenRoles: () => setRolesOpen(true),
        onCreateGroupPost: createGroupPost,
        onEditProfile: () => setProfileEditorOpen(true),
        onEditProfileMedia: () => setProfileMediaOpen(true),
        onDelete,
        onJoin,
        onLeave,
        onOpenGroupPage: () => openExternalLink(groupUrl),
        onOpenModeration: () => {
            recordToolOpen('group-moderation');
            closeDialog();
            navigate(`/tools/group-moderation/${group.id}`);
        },
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
        announcement,
        bannerUrl,
        canManageCalendar,
        canManagePosts,
        currentUserId,
        filteredPosts,
        group,
        groupEvents,
        groupEventsError,
        groupEventsStatus,
        groupTitle,
        groupUrl,
        joinState,
        members: groupMembers.model,
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
        onCopyGroupUrl: () =>
            copyGroupText(groupUrl, t('dialog.group.info.url')),
        onCreateEvent: eventEditor.openCreate,
        onDeleteEvent: (event) => {
            void eventEditor.remove(getEventId(event), event.title || '');
        },
        onEditEvent: eventEditor.openEdit,
        onDeletePost: (post) => {
            deleteGroupPost(post);
        },
        onEditPost: (post) => {
            editGroupPost(post);
        },
        onExportMembers: (scope) => {
            void exportMembers(scope);
        },
        onLoadMoreMembers: () => {
            void groupMembers.loadMore();
        },
        onOpenLink: openExternalLink,
        onOpenOwner: openGroupOwner,
        onPreviousInstancesChange,
        onPreviewImage: previewImage,
        onPreviewRowImage: previewRowImage,
        onGalleriesChanged: onReloadProfile,
        onPhotosChanged: () => {
            loadTab('photos', { force: true });
        },
        onRefreshEvents: () => {
            loadGroupEvents({ force: true });
            loadFollowingGroupEvents({ force: true });
        },
        onRefreshMembers: () => {
            void groupMembers.refresh();
        },
        onSearchMembersChange: groupMembers.setQuery,
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
                {canEditProfile && profileMediaOpen ? (
                    <ProfileMediaPanel
                        title={t('dialog.group.actions.edit_profile_media')}
                        sections={GROUP_PROFILE_MEDIA_SECTIONS}
                        currentFileIds={{
                            bannerId: profileUpdate.bannerId ?? '',
                            iconId: profileUpdate.iconId ?? ''
                        }}
                        actionStatus={actionStatus}
                        onBack={() => setProfileMediaOpen(false)}
                        onSetField={(field, fileId) =>
                            onUpdateProfile({
                                ...profileUpdate,
                                [field]: fileId
                            })
                        }
                    />
                ) : (
                    <GroupDialogTabPanels
                        tabModel={tabModel}
                        tabCommands={tabCommands}
                    />
                )}
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
                submitting={postEditorSubmitting}
                onSubmit={(form: GroupPostForm) => {
                    submitGroupPost(form);
                }}
            />
            <GroupEventEditorDialog
                open={canManageCalendar && Boolean(eventEditor.form)}
                initialForm={eventEditor.form}
                group={group}
                saving={eventEditor.saving}
                onOpenChange={(open) => {
                    if (!open) {
                        eventEditor.close();
                    }
                }}
                onSubmit={(form) => {
                    void eventEditor.submit(form);
                }}
                onDelete={() => {
                    const form = eventEditor.form;
                    if (form) {
                        void eventEditor.remove(form.eventId, form.title);
                    }
                }}
            />
            <GroupRolesDialog
                open={isMember && rolesOpen}
                group={group}
                currentUserId={currentUserId}
                onOpenChange={setRolesOpen}
                onChanged={onRefresh}
            />
            <GroupProfileEditDialog
                open={canEditProfile && profileEditorOpen}
                onOpenChange={setProfileEditorOpen}
                group={group}
                saving={actionStatus === 'profile'}
                onSave={async (params) => {
                    if (await onUpdateProfile(params)) {
                        setProfileEditorOpen(false);
                    }
                }}
            />
        </EntityDialogScaffold>
    );
}
