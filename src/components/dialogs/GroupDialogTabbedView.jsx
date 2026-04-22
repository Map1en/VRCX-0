import {
    BadgeCheckIcon,
    BellIcon,
    BellOffIcon,
    CopyIcon,
    DownloadIcon,
    EyeIcon,
    ExternalLinkIcon,
    LogInIcon,
    LogOutIcon,
    MessageSquareIcon,
    RefreshCwIcon,
    Share2Icon,
    SettingsIcon,
    ShieldIcon,
    ShieldOffIcon,
    TicketIcon,
    UserIcon,
    UsersIcon,
    XIcon
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { formatDateFilter } from '@/lib/dateTime.js';
import {
    convertFileUrlToImageUrl,
    copyTextToClipboard,
    openExternalLink
} from '@/lib/entityMedia.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import {
    groupProfileRepository,
    vrchatAuthRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityDialogHeader,
    EntityDialogScaffold,
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityRawJson
} from './EntityDialogScaffold.jsx';
import { PreviousInstancesPanel } from './PreviousInstancesTableDialog.jsx';
import {
    normalizeLanguageOptionsFromConfig
} from './user-dialog/userProfileFields.js';
import { appI18n } from '@/services/i18nService.js';

import {
    GroupInstanceRows,
    GroupModerationToolsDialog,
    GroupPostEditorDialog,
    GroupTitleLanguages,
    RowList,
    announcementRoleNames,
    announcementTimestamp,
    announcementUserId,
    announcementUserLabel,
    downloadJsonFile,
    firstArray,
    hasGroupModerationPermission,
    hasGroupPermission,
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

    return (
        <EntityDialogScaffold>
            <EntityDialogHeader
                imageUrl={iconUrl}
                imageAlt={group.name || 'Group'}
                imageClassName="size-32"
                imagePlaceholder={
                    <UsersIcon className="text-muted-foreground size-8" />
                }
                onImageClick={
                    iconUrl
                        ? () =>
                              openImagePreview({
                                  url: iconUrl,
                                  title: groupTitle
                              })
                        : null
                }
                title={groupTitle}
                onTitleClick={
                    group.name
                        ? () => void copyGroupText(group.name, 'Group name')
                        : undefined
                }
                titleMeta={<GroupTitleLanguages languages={languageRows} />}
                subtitle={
                    group.shortCode && group.discriminator
                        ? `${group.shortCode}.${group.discriminator}`
                        : group.url || ''
                }
                description={group.description}
                detail={
                    group.ownerId || detail ? (
                        <div className="flex flex-col items-start gap-1">
                            {group.ownerId ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="text-muted-foreground hover:text-primary h-auto justify-start gap-1 p-0 text-xs font-normal"
                                    title={appI18n.t('dialog.group.generated.open_group_owner_profile')}
                                    onClick={openGroupOwner}
                                >
                                    <UserIcon data-icon="inline-start" />
                                    {appI18n.t('dialog.group.generated.owner')} {ownerLinkLabel}
                                </Button>
                            ) : null}
                            {detail ? (
                                <span>
                                    {userFacingErrorMessage(
                                        detail,
                                        'Failed to load group details.'
                                    )}
                                </span>
                            ) : null}
                        </div>
                    ) : null
                }
                badges={
                    <>
                        {showPrivacyBadge ? (
                            <Badge variant="outline">
                                <ShieldIcon data-icon="inline-start" />
                                {group.privacy}
                            </Badge>
                        ) : null}
                        {showMembershipBadge ? (
                            <Badge variant="secondary">
                                {group.membershipStatus}
                            </Badge>
                        ) : null}
                        {group.isVerified ? (
                            <Badge>
                                <BadgeCheckIcon data-icon="inline-start" />
                                {appI18n.t('dialog.group.tags.verified')}
                            </Badge>
                        ) : null}
                        <Badge variant="outline">
                            <UsersIcon data-icon="inline-start" />
                            {group.memberCount} {appI18n.t('dialog.group.generated.members')}
                        </Badge>
                        {group.onlineMemberCount > 0 ? (
                            <Badge variant="outline">
                                <UsersIcon data-icon="inline-start" />
                                {group.onlineMemberCount} {appI18n.t('dashboard.widget.feed_online')}
                            </Badge>
                        ) : null}
                    </>
                }
                actions={
                    <>
                        {memberStatus === 'requested' ? (
                            <Button
                                type="button"
                                size="icon-lg"
                                variant="outline"
                                className="rounded-full"
                                aria-label={"Cancel join request"}
                                disabled={actionStatus === 'cancel-request'}
                                onClick={onCancelRequest}
                            >
                                <XIcon data-icon="inline-start" />
                            </Button>
                        ) : !isMember ? (
                            <Button
                                type="button"
                                size="icon-lg"
                                className="rounded-full"
                                aria-label={"Join group"}
                                disabled={!canJoin || actionStatus === 'join'}
                                onClick={onJoin}
                            >
                                <LogInIcon data-icon="inline-start" />
                            </Button>
                        ) : null}
                        <EntityActionDropdown busy={actionStatus !== 'idle'}>
                            <EntityActionItem
                                icon={RefreshCwIcon}
                                disabled={actionStatus === 'refresh'}
                                onSelect={onRefresh}
                            >
                                {appI18n.t('common.actions.refresh')}
                            </EntityActionItem>
                            {groupUrl ? (
                                <>
                                    <EntityActionItem
                                        icon={Share2Icon}
                                        onSelect={() =>
                                            void copyGroupText(
                                                groupUrl,
                                                'Group URL'
                                            )
                                        }
                                    >
                                        {appI18n.t('dialog.group.generated.share_copy_url')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={ExternalLinkIcon}
                                        onSelect={() =>
                                            openExternalLink(groupUrl)
                                        }
                                    >
                                        {appI18n.t('dialog.group.generated.open_group_page')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={CopyIcon}
                                        onSelect={() =>
                                            void copyGroupText(
                                                group.id,
                                                'Group ID'
                                            )
                                        }
                                    >
                                        {appI18n.t('dialog.group.generated.copy_group_id')}
                                    </EntityActionItem>
                                </>
                            ) : null}
                            {isMember ? (
                                <>
                                    <EntityActionSeparator />
                                    <EntityActionItem
                                        icon={ShieldIcon}
                                        disabled={
                                            actionStatus === 'represent' ||
                                            isPrivateGroup
                                        }
                                        onSelect={() =>
                                            onRepresent(!isRepresenting)
                                        }
                                    >
                                        {isRepresenting
                                            ? 'Unrepresent Group'
                                            : 'Represent Group'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={
                                            isSubscribedToAnnouncements
                                                ? BellOffIcon
                                                : BellIcon
                                        }
                                        disabled={
                                            actionStatus === 'member-props'
                                        }
                                        onSelect={() =>
                                            onSubscribe(
                                                !isSubscribedToAnnouncements
                                            )
                                        }
                                    >
                                        {isSubscribedToAnnouncements
                                            ? 'Unsubscribe Announcements'
                                            : 'Subscribe Announcements'}
                                    </EntityActionItem>
                                    {canInviteToGroup ? (
                                        <EntityActionItem
                                            icon={MessageSquareIcon}
                                            disabled={
                                                remoteStatus.members ===
                                                'running'
                                            }
                                            onSelect={() =>
                                                void inviteUserToGroup()
                                            }
                                        >
                                            {appI18n.t('dialog.group.generated.invite_to_group')}
                                        </EntityActionItem>
                                    ) : null}
                                    {canManagePosts ? (
                                        <EntityActionItem
                                            icon={TicketIcon}
                                            disabled={
                                                remoteStatus.posts === 'running'
                                            }
                                            onSelect={() =>
                                                void createGroupPost()
                                            }
                                        >
                                            {appI18n.t('dialog.group.generated.create_post')}
                                        </EntityActionItem>
                                    ) : null}
                                    {canModerateGroup ? (
                                        <EntityActionItem
                                            icon={SettingsIcon}
                                            onSelect={() =>
                                                setModerationOpen(true)
                                            }
                                        >
                                            {appI18n.t('dialog.group.generated.moderation_tools')}
                                        </EntityActionItem>
                                    ) : null}
                                    {canSetVisibility ? (
                                        <>
                                            <EntityActionSeparator />
                                            <EntityActionItem
                                                icon={UserIcon}
                                                disabled={
                                                    actionStatus ===
                                                    'member-props'
                                                }
                                                onSelect={() =>
                                                    onVisibility('visible')
                                                }
                                            >
                                                {memberVisibility === 'visible'
                                                    ? 'Selected: '
                                                    : ''}
                                                {appI18n.t('dialog.group.actions.visibility_everyone')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={UserIcon}
                                                disabled={
                                                    actionStatus ===
                                                    'member-props'
                                                }
                                                onSelect={() =>
                                                    onVisibility('friends')
                                                }
                                            >
                                                {memberVisibility === 'friends'
                                                    ? 'Selected: '
                                                    : ''}
                                                {appI18n.t('dialog.group.actions.visibility_friends')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={UserIcon}
                                                disabled={
                                                    actionStatus ===
                                                    'member-props'
                                                }
                                                onSelect={() =>
                                                    onVisibility('hidden')
                                                }
                                            >
                                                {memberVisibility === 'hidden'
                                                    ? 'Selected: '
                                                    : ''}
                                                {appI18n.t('dialog.group.actions.visibility_hidden')}
                                            </EntityActionItem>
                                        </>
                                    ) : null}
                                    <EntityActionSeparator />
                                    <EntityActionItem
                                        icon={LogOutIcon}
                                        destructive
                                        disabled={actionStatus === 'leave'}
                                        onSelect={onLeave}
                                    >
                                        {appI18n.t('dialog.group.generated.leave_group')}
                                    </EntityActionItem>
                                </>
                            ) : (
                                <>
                                    <EntityActionSeparator />
                                    <EntityActionItem
                                        icon={
                                            isBlocked
                                                ? ShieldIcon
                                                : ShieldOffIcon
                                        }
                                        destructive={isBlocked}
                                        disabled={actionStatus === 'block'}
                                        onSelect={() => onBlock(!isBlocked)}
                                    >
                                        {isBlocked
                                            ? 'Unblock Group'
                                            : 'Block Group'}
                                    </EntityActionItem>
                                </>
                            )}
                        </EntityActionDropdown>
                    </>
                }
            />
            <EntityDialogTabs
                value={activeTab}
                onValueChange={changeTab}
                tabs={tabs}
            >
                <EntityDialogTabContent value="info">
                    {bannerUrl ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="bg-muted mb-3 h-auto w-full overflow-hidden rounded-md p-0"
                            aria-label={`Preview ${groupTitle} banner`}
                            onClick={() =>
                                openImagePreview({
                                    url: bannerUrl,
                                    title: groupTitle
                                })
                            }
                        >
                            <img
                                src={bannerUrl}
                                alt={group.name || 'Group banner'}
                                className="aspect-[6/1] w-full object-cover"
                            />
                        </Button>
                    ) : null}
                    <EntityInfoGrid>
                        <GroupInstanceRows
                            instances={activeInstances}
                            currentUserId={currentUserId}
                            endpoint={currentEndpoint}
                        />
                        {group.announcement?.id || group.announcement?.title ? (
                            <EntityInfoBlock label={appI18n.t('dialog.group.info.announcement')} full>
                                <span className="block truncate text-sm">
                                    {group.announcement.title || 'Announcement'}
                                </span>
                                {group.announcement.imageUrl ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="mt-1.5 mr-1.5 h-auto p-0 align-top"
                                        aria-label={`Preview ${group.announcement.title || 'announcement'} image`}
                                        onClick={() =>
                                            openImagePreview({
                                                url: convertFileUrlToImageUrl(
                                                    group.announcement.imageUrl,
                                                    1024
                                                ),
                                                title:
                                                    group.announcement.title ||
                                                    'Announcement'
                                            })
                                        }
                                    >
                                        <img
                                            src={convertFileUrlToImageUrl(
                                                group.announcement.imageUrl,
                                                128
                                            )}
                                            alt=""
                                            className="size-16 rounded-md object-cover"
                                        />
                                    </Button>
                                ) : null}
                                <pre className="text-muted-foreground inline-block align-top font-sans text-xs whitespace-pre-wrap">
                                    {group.announcement.text || '—'}
                                </pre>
                                <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                    {announcementRoleNames(
                                        group.announcement,
                                        group
                                    ).length ? (
                                        <Badge
                                            variant="outline"
                                            className="max-w-full"
                                            title={announcementRoleNames(
                                                group.announcement,
                                                group
                                            ).join(', ')}
                                        >
                                            <EyeIcon data-icon="inline-start" />
                                            <span className="truncate">
                                                {announcementRoleNames(
                                                    group.announcement,
                                                    group
                                                ).join(', ')}
                                            </span>
                                        </Badge>
                                    ) : null}
                                    {announcementUserId(
                                        group.announcement,
                                        'author'
                                    ) ||
                                    announcementUserLabel(
                                        group.announcement,
                                        'author'
                                    ) ? (
                                        announcementUserId(
                                            group.announcement,
                                            'author'
                                        ) ? (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="hover:text-primary h-auto gap-1 p-0 text-xs font-normal"
                                                onClick={() =>
                                                    openUserDialog({
                                                        userId: announcementUserId(
                                                            group.announcement,
                                                            'author'
                                                        ),
                                                        title:
                                                            announcementUserLabel(
                                                                group.announcement,
                                                                'author'
                                                            ) || undefined
                                                    })
                                                }
                                            >
                                                <span>{appI18n.t('dialog.group.generated.author')}</span>
                                                <span className="text-foreground font-medium">
                                                    {announcementUserLabel(
                                                        group.announcement,
                                                        'author'
                                                    ) ||
                                                        announcementUserId(
                                                            group.announcement,
                                                            'author'
                                                        )}
                                                </span>
                                            </Button>
                                        ) : (
                                            <span className="inline-flex items-center gap-1">
                                                <span>{appI18n.t('dialog.group.generated.author')}</span>
                                                <span className="text-foreground font-medium">
                                                    {announcementUserLabel(
                                                        group.announcement,
                                                        'author'
                                                    )}
                                                </span>
                                            </span>
                                        )
                                    ) : null}
                                    {announcementUserId(
                                        group.announcement,
                                        'editor'
                                    ) ||
                                    announcementUserLabel(
                                        group.announcement,
                                        'editor'
                                    ) ? (
                                        announcementUserId(
                                            group.announcement,
                                            'editor'
                                        ) ? (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="hover:text-primary h-auto gap-1 p-0 text-xs font-normal"
                                                onClick={() =>
                                                    openUserDialog({
                                                        userId: announcementUserId(
                                                            group.announcement,
                                                            'editor'
                                                        ),
                                                        title:
                                                            announcementUserLabel(
                                                                group.announcement,
                                                                'editor'
                                                            ) || undefined
                                                    })
                                                }
                                            >
                                                <span>{appI18n.t('dialog.group.posts.edited_by')}</span>
                                                <span className="text-foreground font-medium">
                                                    {announcementUserLabel(
                                                        group.announcement,
                                                        'editor'
                                                    ) ||
                                                        announcementUserId(
                                                            group.announcement,
                                                            'editor'
                                                        )}
                                                </span>
                                            </Button>
                                        ) : (
                                            <span className="inline-flex items-center gap-1">
                                                <span>{appI18n.t('dialog.group.posts.edited_by')}</span>
                                                <span className="text-foreground font-medium">
                                                    {announcementUserLabel(
                                                        group.announcement,
                                                        'editor'
                                                    )}
                                                </span>
                                            </span>
                                        )
                                    ) : null}
                                    {group.announcement.createdAt ? (
                                        <span className="inline-flex items-center gap-1">
                                            <span>{appI18n.t('dialog.group.generated.created')}</span>
                                            <span className="text-foreground font-medium">
                                                {announcementTimestamp(
                                                    group.announcement.createdAt
                                                )}
                                            </span>
                                        </span>
                                    ) : null}
                                    {group.announcement.updatedAt ? (
                                        <span className="inline-flex items-center gap-1">
                                            <span>{appI18n.t('dialog.group.generated.updated')}</span>
                                            <span className="text-foreground font-medium">
                                                {announcementTimestamp(
                                                    group.announcement.updatedAt
                                                )}
                                            </span>
                                        </span>
                                    ) : null}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                        {group.rules ? (
                            <EntityInfoBlock label={appI18n.t('dialog.group.info.rules')} full>
                                <pre className="text-muted-foreground font-sans text-xs whitespace-pre-wrap">
                                    {group.rules}
                                </pre>
                            </EntityInfoBlock>
                        ) : null}
                        <EntityInfoBlock
                            label={appI18n.t('dialog.group.generated.members_2')}
                            value={`${group.memberCount || 0} (${group.onlineMemberCount || 0})`}
                        />
                        <EntityInfoBlock
                            label={appI18n.t('dialog.group.generated.created_at')}
                            value={
                                group.createdAt || group.created_at
                                    ? formatDateFilter(
                                          group.createdAt || group.created_at,
                                          'long'
                                      )
                                    : '—'
                            }
                        />
                        <EntityInfoBlock
                            label={appI18n.t('dialog.group.generated.last_visited')}
                            value={
                                previousInstances[0]?.created_at ||
                                previousInstances[0]?.createdAt
                                    ? formatDateFilter(
                                          previousInstances[0]?.created_at ||
                                              previousInstances[0]?.createdAt,
                                          'long'
                                      )
                                    : '—'
                            }
                            onClick={
                                previousInstances.length
                                    ? () => changeTab('instance-history')
                                    : undefined
                            }
                        />
                        <EntityInfoBlock
                            label={appI18n.t('dialog.group.generated.join_state')}
                            value={joinState || '—'}
                        />
                        <EntityInfoBlock
                            label={appI18n.t('dialog.group.generated.membership')}
                            value={
                                memberStatus || group.membershipStatus || '—'
                            }
                        />
                        <EntityInfoBlock
                            label={appI18n.t('dialog.group.generated.languages')}
                            value={group.languages.join(', ') || '—'}
                        />
                        <EntityInfoBlock
                            label={appI18n.t('dialog.group.generated.privacy')}
                            value={group.privacy || '—'}
                        />
                        {group.links.length ? (
                            <EntityInfoBlock label={appI18n.t('dialog.group.info.links')} full>
                                <div className="flex flex-wrap gap-1.5">
                                    {group.links.map((link) => (
                                        <Button
                                            key={link}
                                            type="button"
                                            variant="link"
                                            size="xs"
                                            className="h-auto max-w-full min-w-0 justify-start p-0 text-left break-all whitespace-normal"
                                            onClick={() =>
                                                openExternalLink(link)
                                            }
                                        >
                                            <ExternalLinkIcon data-icon="inline-start" />
                                            <span className="min-w-0 break-all">
                                                {link}
                                            </span>
                                        </Button>
                                    ))}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                        <EntityInfoBlock
                            label="URL"
                            value={groupUrl || '—'}
                            mono
                            wide
                            onClick={
                                groupUrl
                                    ? () =>
                                          void copyGroupText(
                                              groupUrl,
                                              'Group URL'
                                          )
                                    : undefined
                            }
                        />
                        <EntityInfoBlock
                            label={appI18n.t('dialog.group.info.id')}
                            value={group.id}
                            mono
                            wide
                        />
                        <EntityInfoBlock
                            label={appI18n.t('dialog.group.generated.owner_2')}
                            value={ownerLabel || '—'}
                            wide
                            onClick={
                                group.ownerId
                                    ? () =>
                                          openUserDialog({
                                              userId: group.ownerId,
                                              title: ownerLabel || undefined,
                                              seedData: ownerLabel
                                                  ? {
                                                        id: group.ownerId,
                                                        displayName: ownerLabel
                                                    }
                                                  : null
                                          })
                                    : undefined
                            }
                        />
                        {group.tags.length ? (
                            <EntityInfoBlock label={appI18n.t('dialog.avatar.info.tags')} full>
                                <div className="flex flex-wrap gap-1.5">
                                    {group.tags.map((tag) => (
                                        <Badge key={tag} variant="outline">
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                        {group.roles.length ? (
                            <EntityInfoBlock label={appI18n.t('dialog.group.generated.roles')} full>
                                <div className="flex flex-wrap gap-1.5">
                                    {group.roles.map((role) => (
                                        <Badge
                                            key={role.id || role.name}
                                            variant="outline"
                                        >
                                            {role.name || 'Role'}
                                        </Badge>
                                    ))}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                    </EntityInfoGrid>
                </EntityDialogTabContent>
                <EntityDialogTabContent
                    value="instance-history"
                    className="flex min-h-0 flex-col"
                >
                    <PreviousInstancesPanel
                        title={appI18n.t('dialog.previous_instances.header')}
                        instances={previousInstances}
                        variant="group"
                        targetRef={group}
                        onRowsChange={onPreviousInstancesChange}
                        className="flex-1"
                    />
                </EntityDialogTabContent>
                <EntityDialogTabContent
                    value="posts"
                    className="flex flex-col gap-2"
                >
                    <div className="flex items-center gap-2">
                        <div className="text-muted-foreground text-sm">
                            {filteredPosts.length}/{posts.length} {appI18n.t('dialog.group.generated.posts')}
                        </div>
                        <Input
                            value={search.posts}
                            onChange={(event) =>
                                setSearch((current) => ({
                                    ...current,
                                    posts: event.target.value
                                }))
                            }
                            placeholder={appI18n.t('dialog.group.generated.search_posts')}
                            className="ml-auto h-8 max-w-64"
                        />
                    </div>
                    <RowList
                        rows={filteredPosts}
                        group={group}
                        kind="posts"
                        loading={remoteStatus.posts === 'running'}
                        error={remoteErrors.posts}
                        canManagePosts={canManagePosts}
                        onPreviewImage={(url, title) =>
                            openImagePreview({
                                url: convertFileUrlToImageUrl(url, 1024),
                                title
                            })
                        }
                        onEditPost={(post) => void editGroupPost(post)}
                        onDeletePost={(post) => void deleteGroupPost(post)}
                    />
                </EntityDialogTabContent>
                <EntityDialogTabContent
                    value="members"
                    className="flex flex-col gap-2"
                >
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="text-muted-foreground text-sm">
                            {filteredMembers.length}/
                            {group.memberCount || members.length} {appI18n.t('dialog.group.generated.members')}
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={remoteStatus.members === 'running'}
                            onClick={() =>
                                void loadTab('members', { force: true })
                            }
                        >
                            {appI18n.t('common.actions.refresh')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={remoteStatus.members === 'running'}
                            onClick={() => void loadAllMembers()}
                        >
                            {appI18n.t('dialog.group.generated.load_all')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!members.length}
                            onClick={() =>
                                downloadJsonFile(
                                    `${group.id}_members.json`,
                                    members
                                )
                            }
                        >
                            <DownloadIcon data-icon="inline-start" />
                            JSON
                        </Button>
                        <Select
                            value={memberSort}
                            onValueChange={setMemberSort}
                            disabled={remoteStatus.members === 'running'}
                        >
                            <SelectTrigger size="sm" className="w-44">
                                <SelectValue placeholder={appI18n.t('side_panel.settings.sort')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="joinedAt:desc">
                                        {appI18n.t('dialog.group.generated.joined_newest')}
                                    </SelectItem>
                                    <SelectItem value="joinedAt:asc">
                                        {appI18n.t('dialog.group.generated.joined_oldest')}
                                    </SelectItem>
                                    <SelectItem value="user.displayName:asc">
                                        {appI18n.t('dialog.group.generated.name_a_z')}
                                    </SelectItem>
                                    <SelectItem value="user.displayName:desc">
                                        {appI18n.t('dialog.group.generated.name_z_a')}
                                    </SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <Select
                            value={memberRoleId || 'all'}
                            onValueChange={(value) =>
                                setMemberRoleId(value === 'all' ? '' : value)
                            }
                            disabled={remoteStatus.members === 'running'}
                        >
                            <SelectTrigger size="sm" className="w-48">
                                <SelectValue placeholder={appI18n.t('dialog.group.generated.role')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="all">
                                        {appI18n.t('dialog.group.generated.all_roles')}
                                    </SelectItem>
                                    {group.roles.map((role) => (
                                        <SelectItem
                                            key={role.id || role.name}
                                            value={role.id || role.name}
                                        >
                                            {role.name || 'Role'}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <Input
                            value={search.members}
                            onChange={(event) =>
                                setSearch((current) => ({
                                    ...current,
                                    members: event.target.value
                                }))
                            }
                            placeholder={appI18n.t('dialog.group.generated.search_members')}
                            className="ml-auto h-8 max-w-64"
                        />
                    </div>
                    <RowList
                        rows={filteredMembers}
                        group={group}
                        kind="members"
                        loading={remoteStatus.members === 'running'}
                        error={remoteErrors.members}
                    />
                </EntityDialogTabContent>
                <EntityDialogTabContent
                    value="photos"
                    className="flex flex-col gap-2"
                >
                    <RowList
                        rows={photos}
                        group={group}
                        kind="photos"
                        loading={remoteStatus.photos === 'running'}
                        error={remoteErrors.photos}
                        onPreviewImage={(url, title) =>
                            openImagePreview({
                                url: convertFileUrlToImageUrl(url, 1024),
                                title
                            })
                        }
                    />
                </EntityDialogTabContent>
                <EntityDialogTabContent value="json">
                    <EntityRawJson
                        value={{
                            group,
                            posts,
                            instances: activeInstances,
                            members,
                            galleries: firstArray(group.galleries),
                            photos,
                            activeInstances
                        }}
                    />
                </EntityDialogTabContent>
            </EntityDialogTabs>
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

