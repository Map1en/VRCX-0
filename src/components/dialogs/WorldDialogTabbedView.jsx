import {
    CopyIcon,
    DownloadIcon,
    EyeIcon,
    ExternalLinkIcon,
    FlagIcon,
    GlobeIcon,
    HeartIcon,
    HomeIcon,
    ImageIcon,
    LineChartIcon,
    MessageSquareIcon,
    PencilIcon,
    RefreshCwIcon,
    Share2Icon,
    Trash2Icon,
    UploadIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu.jsx';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar.jsx';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import { timeToText } from '@/lib/dateTime.js';
import {
    convertFileUrlToImageUrl,
    copyTextToClipboard,
    openExternalLink
} from '@/lib/entityMedia.js';
import {
    groupProfileRepository,
    instanceRepository,
    playerListRepository,
    userProfileRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { parseLocation } from '@/shared/utils/location.js';
import { replaceVrcPackageUrl } from '@/shared/utils/urlUtils.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

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
    EntityMemoTextarea,
    EntityRawJson
} from './EntityDialogScaffold.jsx';
import { PreviousInstancesPanel } from './PreviousInstancesTableDialog.jsx';
import { appI18n } from '@/services/i18nService.js';

import {
    InstanceUserTiles,
    PlatformBadge,
    WorldInstancesEmptyState,
    fileAnalysisSizeForPlatform,
    firstText,
    friendIsInInstance,
    groupSeed,
    isGroupId,
    mergeInstanceUsers,
    normalizeInstanceGroup,
    resolveLaunchLocation,
    resolveInstanceRows,
    sameLocationTag,
    sameInstanceLocation
} from './world-dialog/WorldDialogViewParts.jsx';
function formatDate(value) {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

let lastWorldDialogTab = 'instances';

function resolveWorldDialogTab(tabs, preferred, fallback = 'instances') {
    return tabs.some((tab) => tab.value === preferred) ? preferred : fallback;
}

function authorWorldTags(tags = []) {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags
        .filter((tag) => String(tag).startsWith('author_tag_'))
        .map((tag) => String(tag).replace(/^author_tag_/, ''))
        .filter(Boolean);
}

const visibleWorldFeatureTags = [
    [
        'feature_avatar_scaling_disabled',
        'dialog.world.tags.avatar_scaling_disabled',
        'Avatar scaling disabled'
    ],
    [
        'feature_focus_view_disabled',
        'dialog.world.tags.focus_view_disabled',
        'Focus view disabled'
    ],
    [
        'feature_emoji_disabled',
        'dialog.world.tags.emoji_disabled',
        'Emoji disabled'
    ],
    [
        'feature_stickers_disabled',
        'dialog.world.tags.stickers_disabled',
        'Stickers disabled'
    ],
    [
        'feature_pedestals_disabled',
        'dialog.world.tags.pedestals_disabled',
        'Pedestals disabled'
    ],
    [
        'feature_prints_disabled',
        'dialog.world.tags.prints_disabled',
        'Prints disabled'
    ],
    [
        'feature_drones_disabled',
        'dialog.world.tags.drones_disabled',
        'Drones disabled'
    ],
    [
        'feature_props_disabled',
        'dialog.world.tags.props_disabled',
        'Items disabled'
    ],
    [
        'feature_third_person_view_disabled',
        'dialog.world.tags.third_person_view_disabled',
        'Third person disabled'
    ]
];

function visibleWorldTags(world, t) {
    const tags = Array.isArray(world?.tags) ? world.tags : [];
    const entries = [];
    const seen = new Set();
    const pushTag = (key, label) => {
        if (!key || seen.has(key)) {
            return;
        }
        seen.add(key);
        entries.push({ key, label: label || key });
    };

    for (const [tag, localeKey, fallbackLabel] of visibleWorldFeatureTags) {
        if (!tags.includes(tag)) {
            continue;
        }
        const localized = t(localeKey);
        pushTag(tag, localized === localeKey ? fallbackLabel : localized);
    }

    if (tags.includes('debug_allowed')) {
        pushTag('debug_allowed', 'Debug allowed');
    }
    if (world?.unityPackageUrl || world?.unityPackage?.url) {
        pushTag('future_proofing', t('dialog.world.tags.future_proofing'));
    }
    for (const tag of tags) {
        if (String(tag).startsWith('content_')) {
            const localeKey = `dialog.world.tags.${tag}`;
            const localized = t(localeKey);
            pushTag(
                tag,
                localized === localeKey
                    ? String(tag).replace(/^content_/, '')
                    : localized
            );
        }
    }

    return entries;
}

export function WorldDialogTabbedView({
    world,
    memo,
    detail,
    imageUrl,
    actionStatus,
    normalizedWorldId,
    isInstanceLocation,
    worldDialogShortName = '',
    isHomeWorld,
    canUpdateHome,
    canManageWorld,
    onRefresh,
    onHome,
    onRename,
    onChangeDescription,
    onChangeCapacity,
    onChangeRecommendedCapacity,
    onChangePreview,
    onChangeTags,
    onChangeAllowedDomains,
    onChangeImage,
    onNewInstance,
    onNewInstanceSelfInvite,
    onPublication,
    onSaveMemo,
    onOpenCache,
    onDeleteCache,
    onDeletePersistentData,
    onDelete,
    previousInstances = [],
    onPreviousInstancesChange,
    hasPersistData = false
}) {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentGameLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const currentGameDestination = useRuntimeStore(
        (state) => state.gameState.currentDestination
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const [activeTab, setActiveTab] = useState(() => lastWorldDialogTab);
    const [currentInstanceDetails, setCurrentInstanceDetails] = useState({
        location: '',
        instance: null,
        ownerUser: null,
        ownerGroup: null,
        playerSnapshot: null
    });
    const [creatorGroupsById, setCreatorGroupsById] = useState({});
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const instanceRows = resolveInstanceRows(world);
    const parsedCurrentInstanceLocation = isInstanceLocation
        ? parseLocation(normalizedWorldId)
        : null;
    const currentResolvedLocation =
        currentGameLocation === 'traveling'
            ? currentGameDestination
            : currentGameLocation;
    const currentInstanceDetailsForLocation = sameLocationTag(
        currentInstanceDetails.location,
        normalizedWorldId
    )
        ? currentInstanceDetails
        : {
              instance: null,
              ownerUser: null,
              ownerGroup: null,
              playerSnapshot: null
          };
    const currentInstanceOwnerId =
        parsedCurrentInstanceLocation?.worldId &&
        parsedCurrentInstanceLocation?.instanceId
            ? firstText(
                  parsedCurrentInstanceLocation.userId,
                  currentInstanceDetailsForLocation.instance?.ownerId,
                  currentInstanceDetailsForLocation.instance?.owner_id,
                  currentInstanceDetailsForLocation.instance?.ownerUserId,
                  currentInstanceDetailsForLocation.instance?.owner_user_id,
                  currentInstanceDetailsForLocation.instance?.userId,
                  currentInstanceDetailsForLocation.instance?.user_id,
                  currentInstanceDetailsForLocation.instance?.creatorUserId,
                  currentInstanceDetailsForLocation.instance?.creator_user_id,
                  currentInstanceDetailsForLocation.instance?.ownerUser?.id,
                  currentInstanceDetailsForLocation.instance?.ownerUser?.userId,
                  currentInstanceDetailsForLocation.instance?.owner?.id,
                  currentInstanceDetailsForLocation.instance?.owner?.userId,
                  currentInstanceDetailsForLocation.instance?.creatorUser?.id,
                  currentInstanceDetailsForLocation.instance?.creatorUser
                      ?.userId,
                  currentInstanceDetailsForLocation.instance?.user?.id,
                  currentInstanceDetailsForLocation.instance?.user?.userId,
                  currentInstanceDetailsForLocation.instance?.groupId,
                  currentInstanceDetailsForLocation.instance?.group_id,
                  currentInstanceDetailsForLocation.instance?.group?.id,
                  parsedCurrentInstanceLocation.groupId
              )
            : '';
    const currentInstanceOwnerIsGroup = isGroupId(currentInstanceOwnerId);
    const currentInstanceRow =
        parsedCurrentInstanceLocation?.worldId &&
        parsedCurrentInstanceLocation?.instanceId
            ? {
                  id: parsedCurrentInstanceLocation.instanceId,
                  location: normalizedWorldId,
                  shortName:
                      parsedCurrentInstanceLocation.shortName ||
                      worldDialogShortName,
                  occupants:
                      currentInstanceDetailsForLocation.instance?.userCount ??
                      currentInstanceDetailsForLocation.instance?.occupants ??
                      currentInstanceDetailsForLocation.playerSnapshot?.context
                          ?.playerCount,
                  playerCount:
                      currentInstanceDetailsForLocation.instance?.userCount ??
                      currentInstanceDetailsForLocation.instance?.occupants ??
                      currentInstanceDetailsForLocation.playerSnapshot?.context
                          ?.playerCount,
                  capacity:
                      currentInstanceDetailsForLocation.instance?.capacity ??
                      currentInstanceDetailsForLocation.instance?.world
                          ?.capacity ??
                      world.capacity,
                  users: mergeInstanceUsers(
                      currentInstanceDetailsForLocation.instance?.users,
                      currentInstanceDetailsForLocation.instance?.players,
                      currentInstanceDetailsForLocation.instance?.playerList,
                      currentInstanceDetailsForLocation.instance?.userList,
                      currentInstanceDetailsForLocation.instance?.userIds,
                      currentInstanceDetailsForLocation.instance?.usersById,
                      currentInstanceDetailsForLocation.playerSnapshot?.players
                  ),
                  ref: currentInstanceDetailsForLocation.instance || null,
                  creatorUserId: currentInstanceOwnerIsGroup
                      ? ''
                      : currentInstanceOwnerId,
                  creatorUser: currentInstanceOwnerIsGroup
                      ? null
                      : currentInstanceDetailsForLocation.ownerUser ||
                        currentInstanceDetailsForLocation.instance?.ownerUser ||
                        currentInstanceDetailsForLocation.instance?.owner ||
                        currentInstanceDetailsForLocation.instance
                            ?.creatorUser ||
                        currentInstanceDetailsForLocation.instance?.user ||
                        null,
                  creatorGroupId: currentInstanceOwnerIsGroup
                      ? currentInstanceOwnerId
                      : '',
                  creatorGroup: currentInstanceOwnerIsGroup
                      ? normalizeInstanceGroup(
                            currentInstanceDetailsForLocation.ownerGroup ||
                                currentInstanceDetailsForLocation.instance
                                    ?.group ||
                                currentInstanceDetailsForLocation.instance
                                    ?.ownerGroup ||
                                groupSeed(
                                    currentInstanceDetailsForLocation.instance
                                        ?.owner
                                ),
                            currentInstanceOwnerId
                        )
                      : null
              }
            : null;
    const hasLiveCurrentInstanceDetails = Boolean(
        currentInstanceDetailsForLocation.instance ||
        currentInstanceDetailsForLocation.playerSnapshot ||
        currentInstanceDetailsForLocation.ownerUser ||
        currentInstanceDetailsForLocation.ownerGroup
    );
    const baseDisplayInstanceRows =
        currentInstanceRow && hasLiveCurrentInstanceDetails
            ? instanceRows.some((instance) =>
                  sameInstanceLocation(world, instance, normalizedWorldId)
              )
                ? instanceRows.map((instance) =>
                      sameInstanceLocation(world, instance, normalizedWorldId)
                          ? {
                                ...instance,
                                ...currentInstanceRow,
                                shortName: firstText(
                                    currentInstanceRow.shortName,
                                    instance.shortName
                                ),
                                occupants:
                                    currentInstanceRow.occupants ??
                                    instance.occupants,
                                playerCount:
                                    currentInstanceRow.playerCount ??
                                    instance.playerCount ??
                                    instance.occupants,
                                capacity:
                                    currentInstanceRow.capacity ??
                                    instance.capacity,
                                users: currentInstanceRow.users.length
                                    ? currentInstanceRow.users
                                    : instance.users,
                                ref: currentInstanceRow.ref ?? instance.ref,
                                creatorUserId: firstText(
                                    currentInstanceRow.creatorUserId,
                                    instance.creatorUserId
                                ),
                                creatorUser:
                                    currentInstanceRow.creatorUser ||
                                    instance.creatorUser,
                                creatorGroupId: firstText(
                                    currentInstanceRow.creatorGroupId,
                                    instance.creatorGroupId
                                ),
                                creatorGroup:
                                    currentInstanceRow.creatorGroup ||
                                    instance.creatorGroup
                            }
                          : instance
                  )
                : [currentInstanceRow, ...instanceRows]
            : instanceRows;
    const creatorGroupKey = Array.from(
        new Set(
            baseDisplayInstanceRows
                .map((instance) =>
                    firstText(
                        instance.creatorGroupId,
                        isGroupId(instance.creatorUserId)
                            ? instance.creatorUserId
                            : ''
                    )
                )
                .filter(Boolean)
        )
    )
        .sort()
        .join('|');
    const friendRows = Object.values(friendsById || {});
    const displayInstanceRows = baseDisplayInstanceRows.map((instance) => {
        const location = resolveLaunchLocation(world, instance);
        const friendsInInstance = location
            ? friendRows.filter((friend) =>
                  friendIsInInstance(friend, location)
              )
            : [];
        const creatorGroupId = firstText(
            instance.creatorGroupId,
            isGroupId(instance.creatorUserId) ? instance.creatorUserId : ''
        );
        const creatorGroupProfile = creatorGroupId
            ? creatorGroupsById[creatorGroupId]
            : null;
        const instanceWithFriends = {
            ...instance,
            users: mergeInstanceUsers(instance.users, friendsInInstance)
        };
        return creatorGroupProfile
            ? {
                  ...instanceWithFriends,
                  creatorGroupId,
                  creatorGroup: normalizeInstanceGroup(
                      creatorGroupProfile,
                      creatorGroupId
                  )
              }
            : instanceWithFriends;
    });
    const tabs = [
        { value: 'instances', label: 'Instances' },
        { value: 'visit-history', label: 'Visit History' },
        { value: 'info', label: 'Info' },
        { value: 'json', label: 'JSON' }
    ];

    function changeTab(tab) {
        lastWorldDialogTab = resolveWorldDialogTab(tabs, tab);
        setActiveTab(lastWorldDialogTab);
    }

    useEffect(() => {
        const groupIds = creatorGroupKey
            ? creatorGroupKey.split('|').filter(Boolean)
            : [];
        if (!groupIds.length) {
            return undefined;
        }

        let active = true;
        Promise.all(
            groupIds.map((groupId) =>
                groupProfileRepository
                    .getGroupProfile({
                        groupId,
                        endpoint: currentEndpoint,
                        includeRoles: false
                    })
                    .then((groupProfile) => [groupId, groupProfile])
                    .catch(() => null)
            )
        ).then((entries) => {
            if (!active) {
                return;
            }
            setCreatorGroupsById((current) => {
                const next = { ...current };
                let changed = false;
                for (const entry of entries) {
                    if (!entry) {
                        continue;
                    }
                    const [groupId, groupProfile] = entry;
                    next[groupId] = groupProfile;
                    changed = true;
                }
                return changed ? next : current;
            });
        });

        return () => {
            active = false;
        };
    }, [creatorGroupKey, currentEndpoint]);

    useEffect(() => {
        if (!isInstanceLocation) {
            setCurrentInstanceDetails({
                location: '',
                instance: null,
                ownerUser: null,
                ownerGroup: null,
                playerSnapshot: null
            });
            return undefined;
        }

        const parsedLocation = parseLocation(normalizedWorldId);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            setCurrentInstanceDetails({
                location: normalizedWorldId,
                instance: null,
                ownerUser: null,
                ownerGroup: null,
                playerSnapshot: null
            });
            return undefined;
        }

        let active = true;
        const isCurrentLiveInstance = sameLocationTag(
            currentResolvedLocation,
            normalizedWorldId
        );
        Promise.all([
            instanceRepository
                .getInstance({
                    worldId: parsedLocation.worldId,
                    instanceId: parsedLocation.instanceId,
                    endpoint: currentEndpoint
                })
                .then((response) => response.json)
                .catch(() => null),
            isCurrentLiveInstance
                ? playerListRepository
                      .getCurrentInstanceSnapshot({
                          currentUserId,
                          currentLocation: normalizedWorldId
                      })
                      .catch(() => null)
                : Promise.resolve(null)
        ])
            .then(async ([instance, playerSnapshot]) => {
                const ownerId = firstText(
                    parsedLocation.userId,
                    instance?.ownerUserId,
                    instance?.owner_user_id,
                    instance?.ownerId,
                    instance?.owner_id,
                    instance?.userId,
                    instance?.user_id,
                    instance?.creatorUserId,
                    instance?.creator_user_id,
                    instance?.ownerUser?.id,
                    instance?.ownerUser?.userId,
                    instance?.owner?.id,
                    instance?.owner?.userId,
                    instance?.creatorUser?.id,
                    instance?.creatorUser?.userId,
                    instance?.user?.id,
                    instance?.user?.userId,
                    instance?.groupId,
                    instance?.group_id,
                    instance?.group?.id,
                    parsedLocation.groupId
                );
                const ownerIsGroup = isGroupId(ownerId);
                const ownerSeed = ownerIsGroup
                    ? instance?.group ||
                      instance?.ownerGroup ||
                      instance?.owner_group ||
                      groupSeed(instance?.owner) ||
                      instance?.creatorGroup ||
                      instance?.creator_group ||
                      null
                    : instance?.ownerUser ||
                      instance?.owner ||
                      instance?.creatorUser ||
                      instance?.user ||
                      null;
                let ownerUser = null;
                let ownerGroup = null;
                if (ownerIsGroup) {
                    ownerGroup = ownerSeed
                        ? normalizeInstanceGroup(ownerSeed, ownerId)
                        : ownerId
                          ? await groupProfileRepository
                                .getGroupProfile({
                                    groupId: ownerId,
                                    endpoint: currentEndpoint,
                                    includeRoles: false
                                })
                                .catch(() => ({
                                    id: ownerId,
                                    groupId: ownerId,
                                    name: ownerId
                                }))
                          : null;
                } else {
                    ownerUser = ownerSeed
                        ? ownerSeed
                        : ownerId
                          ? await userProfileRepository
                                .getUserProfile({
                                    userId: ownerId,
                                    endpoint: currentEndpoint
                                })
                                .catch(() => ({
                                    id: ownerId,
                                    userId: ownerId,
                                    displayName: ownerId
                                }))
                          : null;
                }

                if (!active) {
                    return;
                }
                setCurrentInstanceDetails({
                    location: normalizedWorldId,
                    instance,
                    ownerUser,
                    ownerGroup,
                    playerSnapshot
                });
            })
            .catch(() => {
                if (active) {
                    setCurrentInstanceDetails({
                        location: normalizedWorldId,
                        instance: null,
                        ownerUser: null,
                        ownerGroup: null,
                        playerSnapshot: null
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [
        currentEndpoint,
        currentResolvedLocation,
        currentUserId,
        isInstanceLocation,
        normalizedWorldId
    ]);

    const worldUrl = world.id
        ? `https://vrchat.com/home/world/${world.id}`
        : '';
    const packageUrl = replaceVrcPackageUrl(
        world.unityPackageUrl || world.unityPackage?.url || ''
    );
    const isPublished =
        Array.isArray(world.tags) &&
        (world.tags.includes('system_approved') ||
            world.tags.includes('system_labs'));
    const authorTags = authorWorldTags(world.tags);
    const visibleTags = visibleWorldTags(world, t);
    const platformRows = Array.isArray(world.platforms) ? world.platforms : [];
    const previewUrl = world.previewYoutubeId
        ? `https://www.youtube.com/watch?v=${world.previewYoutubeId}`
        : '';
    const lastVisitedInstance = previousInstances[0];
    const totalVisitTime = previousInstances.reduce(
        (total, instance) => total + (Number(instance?.time) || 0),
        0
    );
    const favoriteRate =
        Number(world.visits) > 0 && Number(world.favorites) > 0
            ? Math.round((Number(world.favorites) / Number(world.visits)) * 100)
            : 0;

    async function copyWorldText(text, label) {
        await copyTextToClipboard(text);
        toast.success(appI18n.t('dialog.world.generated_dynamic.value_copied', { value: label }));
    }

    return (
        <EntityDialogScaffold>
            <EntityDialogHeader
                imageUrl={imageUrl}
                imageAlt={world.name || world.id || 'World'}
                imagePlaceholder={
                    <GlobeIcon className="text-muted-foreground size-8" />
                }
                onImageClick={
                    imageUrl
                        ? () =>
                              openImagePreview({
                                  url: convertFileUrlToImageUrl(
                                      world.imageUrl || imageUrl,
                                      1024
                                  ),
                                  title: world.name || 'World'
                              })
                        : null
                }
                titlePrefix={
                    isHomeWorld ? (
                        <HomeIcon className="size-5 shrink-0" />
                    ) : null
                }
                title={world.name || 'World'}
                onTitleClick={
                    world.name
                        ? () => void copyWorldText(world.name, 'World name')
                        : undefined
                }
                subtitle={world.authorName || ''}
                onSubtitleClick={
                    world.authorId
                        ? () =>
                              openUserDialog({
                                  userId: world.authorId,
                                  title: world.authorName || undefined
                              })
                        : undefined
                }
                description={world.description}
                detail={detail}
                badges={
                    <>
                        <Badge
                            variant={
                                world.releaseStatus === 'public'
                                    ? 'default'
                                    : 'outline'
                            }
                        >
                            {world.isLabs
                                ? 'Labs'
                                : world.releaseStatus || 'Unknown'}
                        </Badge>
                        {world.capacity > 0 ? (
                            <Badge variant="outline">
                                <UsersIcon data-icon="inline-start" />
                                {t('dialog.world.info.capacity')} {world.capacity}
                            </Badge>
                        ) : null}
                        {world.occupants > 0 ? (
                            <Badge variant="outline">
                                <UsersIcon data-icon="inline-start" />
                                {t('dialog.world.generated.occupants')} {world.occupants}
                            </Badge>
                        ) : null}
                        {world.favorites > 0 ? (
                            <Badge variant="outline">
                                <HeartIcon data-icon="inline-start" />
                                {t('dialog.world.generated.favorites')} {world.favorites}
                            </Badge>
                        ) : null}
                        {world.$isCached ? (
                            <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                className="rounded-full"
                                onClick={onOpenCache}
                            >
                                {world.$cacheSize
                                    ? `${world.$cacheSize} Cache`
                                    : 'Local cache'}
                            </Button>
                        ) : null}
                        {platformRows.map((platform) => (
                            <PlatformBadge
                                key={platform}
                                name={platform}
                                fileSize={fileAnalysisSizeForPlatform(
                                    world.fileAnalysis,
                                    platform
                                )}
                            />
                        ))}
                        {visibleTags.map((tag) => (
                            <Badge key={tag.key} variant="outline">
                                {tag.label}
                            </Badge>
                        ))}
                    </>
                }
                actions={
                    <>
                        {world.$isCached ? (
                            <Button
                                type="button"
                                size="icon-lg"
                                variant="outline"
                                aria-label={"Delete cached world"}
                                disabled={actionStatus === 'cache'}
                                onClick={onDeleteCache}
                            >
                                <Trash2Icon data-icon="inline-start" />
                            </Button>
                        ) : null}
                        <FavoriteActionMenu
                            kind="world"
                            entityId={world.id}
                            entity={world}
                        />
                        <EntityActionDropdown busy={actionStatus !== 'idle'}>
                            <EntityActionItem
                                icon={RefreshCwIcon}
                                disabled={actionStatus === 'refresh'}
                                onSelect={onRefresh}
                            >
                                {t('common.actions.refresh')}
                            </EntityActionItem>
                            {worldUrl ? (
                                <>
                                    <EntityActionItem
                                        icon={Share2Icon}
                                        onSelect={() =>
                                            void copyWorldText(
                                                worldUrl,
                                                'World URL'
                                            )
                                        }
                                    >
                                        {t('dialog.world.generated.share_copy_url')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={ExternalLinkIcon}
                                        onSelect={() =>
                                            openExternalLink(worldUrl)
                                        }
                                    >
                                        {t('dialog.world.generated.open_vrchat_page')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={CopyIcon}
                                        onSelect={() =>
                                            void copyWorldText(
                                                world.id,
                                                'World ID'
                                            )
                                        }
                                    >
                                        {t('dialog.world.generated.copy_world_id')}
                                    </EntityActionItem>
                                </>
                            ) : null}
                            <EntityActionSeparator />
                            <EntityActionItem
                                icon={FlagIcon}
                                disabled={actionStatus === 'new-instance'}
                                onSelect={onNewInstance}
                            >
                                {t('dialog.world.generated.new_instance')}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={MessageSquareIcon}
                                disabled={actionStatus === 'new-instance'}
                                onSelect={onNewInstanceSelfInvite}
                            >
                                {t('dialog.world.actions.new_instance_and_self_invite')}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={HomeIcon}
                                disabled={
                                    !canUpdateHome || actionStatus === 'home'
                                }
                                onSelect={onHome}
                            >
                                {isHomeWorld ? 'Reset Home' : 'Make Home'}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={LineChartIcon}
                                disabled={!previousInstances.length}
                                onSelect={() => changeTab('visit-history')}
                            >
                                {t('dialog.world.generated.visit_history')}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={UploadIcon}
                                disabled={
                                    !hasPersistData ||
                                    actionStatus === 'persistent-data'
                                }
                                onSelect={onDeletePersistentData}
                            >
                                {t('dialog.world.actions.delete_persistent_data')}
                            </EntityActionItem>
                            <EntityActionSeparator />
                            {canManageWorld ? (
                                <>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus === 'save-world'}
                                        onSelect={onRename}
                                    >
                                        {t('dialog.world.generated.rename')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus === 'save-world'}
                                        onSelect={onChangeDescription}
                                    >
                                        {t('dialog.world.generated.change_description')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus === 'save-world'}
                                        onSelect={onChangeCapacity}
                                    >
                                        {t('dialog.world.generated.change_capacity')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus === 'save-world'}
                                        onSelect={onChangeRecommendedCapacity}
                                    >
                                        {t('dialog.world.generated.change_recommended_capacity')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus === 'save-world'}
                                        onSelect={onChangePreview}
                                    >
                                        {t('prompt.change_world_preview.header')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus === 'save-world'}
                                        onSelect={onChangeTags}
                                    >
                                        {t('dialog.world.generated.change_tags')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus === 'save-world'}
                                        onSelect={onChangeAllowedDomains}
                                    >
                                        {t('dialog.world.generated.change_allowed_domains')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={ImageIcon}
                                        disabled={
                                            actionStatus === 'image-upload'
                                        }
                                        onSelect={onChangeImage}
                                    >
                                        {t('dialog.world.generated.change_image')}
                                    </EntityActionItem>
                                    {packageUrl ? (
                                        <EntityActionItem
                                            icon={DownloadIcon}
                                            onSelect={() =>
                                                openExternalLink(packageUrl)
                                            }
                                        >
                                            {t('dialog.world.generated.download_unity_package')}
                                        </EntityActionItem>
                                    ) : null}
                                    <EntityActionSeparator />
                                    <EntityActionItem
                                        icon={EyeIcon}
                                        disabled={
                                            actionStatus === 'publish-world'
                                        }
                                        onSelect={() =>
                                            onPublication(!isPublished)
                                        }
                                    >
                                        {isPublished
                                            ? 'Unpublish'
                                            : 'Publish to Labs'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={Trash2Icon}
                                        destructive
                                        disabled={actionStatus === 'delete'}
                                        onSelect={onDelete}
                                    >
                                        {t('common.actions.delete')}
                                    </EntityActionItem>
                                </>
                            ) : null}
                        </EntityActionDropdown>
                    </>
                }
            />
            <EntityDialogTabs
                value={activeTab}
                onValueChange={changeTab}
                tabs={tabs}
            >
                <EntityDialogTabContent
                    value="instances"
                    className="flex flex-col gap-4"
                >
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="inline-flex items-center gap-1">
                            <UserIcon className="size-4" />
                            {t('dialog.world.generated.public')} {world.publicOccupants ?? 0}
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <UserIcon className="size-4" />
                            {t('dialog.world.generated.private')} {world.privateOccupants ?? 0}
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <UsersIcon className="size-4" />
                            {t('dialog.world.info.capacity')} {world.recommendedCapacity || '—'} /{' '}
                            {world.capacity || '—'}
                        </span>
                    </div>
                    <div className="flex flex-col gap-2">
                        {displayInstanceRows.length ? (
                            displayInstanceRows.map((instance) => {
                                const location = resolveLaunchLocation(
                                    world,
                                    instance
                                );
                                const shortName = instance.shortName || '';
                                const launchToken =
                                    instance.shortName ||
                                    instance.secureName ||
                                    '';
                                return (
                                    <div
                                        key={instance.id}
                                        className="rounded-md border px-3 py-2 text-sm"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <LocationWorld
                                                locationObject={{
                                                    ...(instance.ref || {}),
                                                    ...instance,
                                                    tag: location,
                                                    location,
                                                    shortName,
                                                    launchToken
                                                }}
                                                currentUserId={currentUserId}
                                                worldDialogShortName={
                                                    worldDialogShortName
                                                }
                                                grouphint={
                                                    instance.groupName ||
                                                    instance.group?.name ||
                                                    ''
                                                }
                                                hint={
                                                    world.name ||
                                                    instance.worldName ||
                                                    instance.world?.name ||
                                                    ''
                                                }
                                            />
                                            <InstanceActionBar
                                                location={location}
                                                launchLocation={location}
                                                inviteLocation={location}
                                                instanceLocation={location}
                                                shortName={launchToken}
                                                worldName={
                                                    world.name ||
                                                    instance.worldName ||
                                                    instance.world?.name ||
                                                    ''
                                                }
                                                instance={instance}
                                                friendCount={
                                                    Number(
                                                        instance.friendCount
                                                    ) || undefined
                                                }
                                                playerCount={
                                                    instance.playerCount ??
                                                    instance.userCount ??
                                                    instance.occupants
                                                }
                                                showHistory={Boolean(
                                                    previousInstances.length
                                                )}
                                                historyTooltip="Visit history"
                                                onHistory={() =>
                                                    changeTab('visit-history')
                                                }
                                            />
                                        </div>
                                        <InstanceUserTiles
                                            instance={instance}
                                        />
                                    </div>
                                );
                            })
                        ) : !isInstanceLocation ? (
                            <WorldInstancesEmptyState />
                        ) : null}
                    </div>
                </EntityDialogTabContent>
                <EntityDialogTabContent
                    value="visit-history"
                    className="flex min-h-0 flex-col"
                >
                    <PreviousInstancesPanel
                        title={t('dialog.world.generated.visit_history')}
                        instances={previousInstances}
                        variant="world"
                        targetRef={world}
                        onRowsChange={onPreviousInstancesChange}
                        className="flex-1"
                    />
                </EntityDialogTabContent>
                <EntityDialogTabContent value="info" forceMount>
                    <EntityInfoGrid>
                        <EntityMemoTextarea
                            label={t('dialog.world.generated.memo')}
                            value={memo}
                            placeholder={t('dialog.world.generated.memo')}
                            onSave={onSaveMemo}
                        />
                        <EntityInfoBlock
                            label={t('dialog.world.generated.world_id')}
                            value={world.id}
                            mono
                            full
                        />
                        {previewUrl ? (
                            <EntityInfoBlock
                                label={t('dialog.world.generated.youtube_preview')}
                                wide
                                onClick={() => openExternalLink(previewUrl)}
                            >
                                <span className="block truncate text-xs">
                                    {previewUrl}
                                </span>
                            </EntityInfoBlock>
                        ) : null}
                        <EntityInfoBlock
                            label={t('dialog.world.generated.author')}
                            onClick={
                                world.authorId
                                    ? () =>
                                          openUserDialog({
                                              userId: world.authorId,
                                              title:
                                                  world.authorName || undefined
                                          })
                                    : undefined
                            }
                        >
                            <span className="block truncate text-xs">
                                {world.authorName || '—'}
                            </span>
                        </EntityInfoBlock>
                        <EntityInfoBlock
                            label={t('dialog.world.generated.players')}
                            value={
                                world.occupants ? String(world.occupants) : '—'
                            }
                        />
                        <EntityInfoBlock
                            label={t('dialog.world.generated.favorites')}
                            value={
                                world.favorites
                                    ? `${world.favorites}${favoriteRate ? ` (${favoriteRate}%)` : ''}`
                                    : '—'
                            }
                        />
                        <EntityInfoBlock
                            label={t('dialog.world.info.visits')}
                            value={world.visits ? String(world.visits) : '—'}
                        />
                        <EntityInfoBlock
                            label={t('dialog.world.info.capacity')}
                            value={`${world.recommendedCapacity || '—'} (${world.capacity || '—'})`}
                        />
                        <EntityInfoBlock
                            label={t('dialog.world.generated.created')}
                            value={formatDate(
                                world.createdAt || world.created_at
                            )}
                        />
                        <EntityInfoBlock
                            label={t('dialog.world.generated.last_updated')}
                            value={formatDate(
                                world.updatedAt || world.updated_at
                            )}
                        />
                        {world.labsPublicationDate &&
                        world.labsPublicationDate !== 'none' ? (
                            <EntityInfoBlock
                                label={t('dialog.world.info.labs_publication_date')}
                                value={formatDate(world.labsPublicationDate)}
                            />
                        ) : null}
                        <EntityInfoBlock
                            label={t('dialog.world.info.publication_date')}
                            value={formatDate(world.publicationDate)}
                        />
                        <EntityInfoBlock
                            label={t('dialog.world.generated.last_visited')}
                            value={formatDate(
                                lastVisitedInstance?.created_at ||
                                    lastVisitedInstance?.createdAt
                            )}
                        />
                        <EntityInfoBlock
                            label={t('dialog.world.info.visit_count')}
                            value={
                                previousInstances.length
                                    ? String(previousInstances.length)
                                    : '—'
                            }
                            onClick={
                                previousInstances.length
                                    ? () => changeTab('visit-history')
                                    : undefined
                            }
                        />
                        <EntityInfoBlock
                            label={t('dialog.world.generated.time_spent')}
                            value={
                                totalVisitTime > 0
                                    ? timeToText(totalVisitTime)
                                    : '—'
                            }
                        />
                        <EntityInfoBlock
                            label={t('dialog.world.generated.version')}
                            value={world.version ? String(world.version) : '—'}
                        />
                        <EntityInfoBlock
                            label={t('dialog.world.info.heat')}
                            value={world.heat ? String(world.heat) : '—'}
                        />
                        <EntityInfoBlock
                            label={t('dialog.world.generated.popularity')}
                            value={
                                world.popularity
                                    ? String(world.popularity)
                                    : '—'
                            }
                        />
                        <EntityInfoBlock
                            label={t('dialog.world.generated.persistent_data')}
                            value={hasPersistData ? 'Available' : '—'}
                        />
                        <EntityInfoBlock label={t('dialog.world.generated.platform')} full>
                            <span className="block text-xs whitespace-normal">
                                {world.platforms?.join(', ') || '—'}
                            </span>
                        </EntityInfoBlock>
                        {Array.isArray(world.urlList) &&
                        world.urlList.length ? (
                            <EntityInfoBlock
                                label={t('dialog.allowed_video_player_domains.header')}
                                full
                            >
                                <div className="flex flex-wrap gap-1.5">
                                    {world.urlList.map((url) => (
                                        <Badge key={url} variant="outline">
                                            {url}
                                        </Badge>
                                    ))}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                        {authorTags.length ? (
                            <EntityInfoBlock label={t('dialog.world.info.author_tags')} full>
                                <div className="flex flex-wrap gap-1.5">
                                    {authorTags.map((tag) => (
                                        <Badge key={tag} variant="outline">
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                    </EntityInfoGrid>
                </EntityDialogTabContent>
                <EntityDialogTabContent value="json">
                    <EntityRawJson
                        value={{
                            world,
                            memo,
                            hasPersistData,
                            fileAnalysis: world.fileAnalysis || {}
                        }}
                    />
                </EntityDialogTabContent>
            </EntityDialogTabs>
        </EntityDialogScaffold>
    );
}

