import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
    convertFileUrlToImageUrl,
    copyTextToClipboard,
    openExternalLink
} from '@/lib/entityMedia.js';
import {
    groupProfileRepository,
    vrchatAuthRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { appI18n } from '@/services/i18nService.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { EntityDialogScaffold } from './EntityDialogScaffold.jsx';
import { GroupDialogHeaderSection } from './group-dialog/GroupDialogHeaderSection.jsx';
import { GroupDialogTabPanels } from './group-dialog/GroupDialogTabPanels.jsx';
import { GroupModerationToolsDialog } from './group-dialog/GroupModerationToolsDialog.jsx';
import { GroupPostEditorDialog } from './group-dialog/GroupPostEditorDialog.jsx';
import {
    downloadJsonFile,
    firstArray,
    hasGroupModerationPermission,
    hasGroupPermission
} from './group-dialog/groupDialogUtils.js';
import {
    normalizeLanguageOptionsFromConfig
} from './user-dialog/userProfileFields.js';
import {
    normalizeGroupLanguages,
    shouldShowGroupBadgeValue
} from './group-dialog/GroupDialogViewParts.jsx';
let lastGroupDialogTab = 'info';

function resolveGroupDialogTab(tabs, preferred, fallback = 'info') {
    return tabs.some((tab) => tab.value === preferred) ? preferred : fallback;
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
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);
    const [activeTab, setActiveTab] = useState('info');
    const [remoteData, setRemoteData] = useState({
        posts: [],
        members: [],
        photos: []
    });
    const [remoteStatus, setRemoteStatus] = useState({});
    const [remoteErrors, setRemoteErrors] = useState({});
    const [search, setSearch] = useState({ posts: '', members: '' });
    const [memberSort, setMemberSort] = useState('joinedAt:desc');
    const [memberRoleId, setMemberRoleId] = useState('');
    const [moderationOpen, setModerationOpen] = useState(false);
    const [postEditor, setPostEditor] = useState(null);
    const [postEditorSubmitting, setPostEditorSubmitting] = useState(false);
    const [vrchatConfigConstants, setVrchatConfigConstants] = useState(null);
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
    const tabs = [
        { value: 'info', label: appI18n.t('dialog.group.moderation_tabs.info') },
        { value: 'instance-history', label: appI18n.t('dialog.group.moderation_tabs.instance_history') },
        { value: 'posts', label: appI18n.t('dialog.group.moderation_tabs.posts') },
        { value: 'members', label: appI18n.t('dialog.group.moderation_tabs.members') },
        { value: 'photos', label: appI18n.t('dialog.group.moderation_tabs.photos') },
        { value: 'json', label: appI18n.t('dialog.group.moderation_tabs.json') }
    ];
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
    const languageOptions = normalizeLanguageOptionsFromConfig({
        constants: vrchatConfigConstants
    });
    const languageOptionsMap = new Map(
        languageOptions.map((option) => [option.key, option])
    );
    const languageRows = normalizeGroupLanguages(group, languageOptionsMap);
    const canSetVisibility = group.privacy === 'default';
    const isGroupOwner = group.ownerId === currentUserId;
    const canManagePosts =
        isGroupOwner || hasGroupPermission(group, 'group-announcement-manage');
    const canInviteToGroup =
        isGroupOwner || hasGroupPermission(group, 'group-invites-manage');
    const canModerateGroup = hasGroupModerationPermission(group);
    const filteredPosts = posts.filter((post) => {
        const query = search.posts.trim().toLowerCase();
        if (!query) {
            return true;
        }
        return [post?.title, post?.text, post?.authorId].some((value) =>
            String(value || '')
                .toLowerCase()
                .includes(query)
        );
    });
    const filteredMembers = members.filter((member) => {
        const query = search.members.trim().toLowerCase();
        if (!query) {
            return true;
        }
        return [
            member?.user?.displayName,
            member?.displayName,
            member?.userId,
            member?.user?.id
        ].some((value) =>
            String(value || '')
                .toLowerCase()
                .includes(query)
        );
    });

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
        setSearch({ posts: '', members: '' });
        setMemberSort('joinedAt:desc');
        setMemberRoleId('');
        const nextTab = resolveGroupDialogTab(tabs, lastGroupDialogTab);
        lastGroupDialogTab = nextTab;
        setActiveTab(nextTab);
    }, [currentEndpoint, group.id]);

    useEffect(() => {
        let active = true;
        vrchatAuthRepository
            .getConfig({ endpoint: currentEndpoint })
            .then((response) => {
                if (active) {
                    setVrchatConfigConstants(response?.json?.constants || null);
                }
            })
            .catch(() => {
                if (active) {
                    setVrchatConfigConstants(null);
                }
            });
        return () => {
            active = false;
        };
    }, [currentEndpoint]);

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
        toast.success(appI18n.t('dialog.group.generated_dynamic.value_copied', { value: label }));
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

    function createGroupPost() {
        setPostEditor({
            mode: 'create',
            post: null,
            title: '',
            text: '',
            sendNotification: true,
            visibility: 'group',
            roleIds: [],
            imageId: ''
        });
    }

    async function submitGroupPost(form) {
        if (!form || postEditorSubmitting) {
            return;
        }
        const title = String(form.title || '').trim();
        const text = String(form.text || '').trim();
        if (!title || !text) {
            toast.warning(appI18n.t('dialog.group.generated.title_and_text_are_required'));
            return;
        }

        setPostEditorSubmitting(true);
        try {
            const roleIds =
                form.visibility === 'group' && Array.isArray(form.roleIds)
                    ? form.roleIds
                    : [];
            if (form.mode === 'edit') {
                await groupProfileRepository.editGroupPost({
                    groupId: group.id,
                    postId: form.post?.id,
                    endpoint: currentEndpoint,
                    params: {
                        title,
                        text,
                        visibility: form.visibility || 'group',
                        roleIds,
                        sendNotification: Boolean(form.sendNotification),
                        imageId: form.imageId || null
                    }
                });
            } else {
                await groupProfileRepository.createGroupPost({
                    groupId: group.id,
                    endpoint: currentEndpoint,
                    params: {
                        title,
                        text,
                        sendNotification: Boolean(form.sendNotification),
                        visibility: form.visibility || 'group',
                        roleIds,
                        imageId: form.imageId || null
                    }
                });
            }
            setRemoteStatus((current) => ({ ...current, posts: '' }));
            await loadTab('posts', { force: true });
            lastGroupDialogTab = 'posts';
            setActiveTab('posts');
            setPostEditor(null);
            toast.success(
                form.mode === 'edit'
                    ? appI18n.t('dialog.group.generated_toast.group_post_updated')
                    : appI18n.t('dialog.group.generated_toast.group_post_created')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.group.generated_toast.failed_to_save_group_post')
            );
        } finally {
            setPostEditorSubmitting(false);
        }
    }

    async function inviteUserToGroup() {
        const result = await prompt({
            title: appI18n.t('dialog.group.generated_modal.invite_to_group'),
            description: appI18n.t('dialog.group.generated_modal.enter_the_vrchat_user_id_to_invite'),
            inputValue: '',
            confirmText: appI18n.t('dialog.group.generated_modal.invite'),
            cancelText: appI18n.t('common.actions.cancel')
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
            toast.success(appI18n.t('dialog.group.generated.group_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.group.generated_toast.failed_to_send_group_invite')
            );
        }
    }

    function editGroupPost(post) {
        setPostEditor({
            mode: 'edit',
            post,
            title: post?.title || '',
            text: post?.text || '',
            sendNotification: Boolean(post?.sendNotification),
            visibility: post?.visibility || 'group',
            roleIds: Array.isArray(post?.roleIds) ? post.roleIds : [],
            imageId: post?.imageId || ''
        });
    }

    async function deleteGroupPost(post) {
        const result = await confirm({
            title: appI18n.t('dialog.group.generated_modal.delete_group_post'),
            description: post?.title || group.name || 'Group',
            confirmText: appI18n.t('common.actions.delete'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        try {
            await groupProfileRepository.deleteGroupPost({
                groupId: group.id,
                postId: post.id,
                endpoint: currentEndpoint
            });
            setRemoteData((current) => ({
                ...current,
                posts: current.posts.filter((row) => row.id !== post.id)
            }));
            toast.success(appI18n.t('dialog.group.generated.group_post_deleted'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.group.generated_toast.failed_to_delete_group_post')
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
        onSubscribeToggle: () =>
            onSubscribe(!isSubscribedToAnnouncements),
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
        onRefreshMembers: () => void loadTab('members', { force: true }),
        onSearchMembersChange: handleSearchMembersChange,
        onSearchPostsChange: handleSearchPostsChange
    };

    return (
        <EntityDialogScaffold>
            <GroupDialogHeaderSection
                state={headerState}
                handlers={headerHandlers}
            />
            <GroupDialogTabPanels state={tabState} handlers={tabHandlers} />
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
