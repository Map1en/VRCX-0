import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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

import { EntityDialogScaffold } from './EntityDialogScaffold.jsx';
import { WorldDialogHeaderSection } from './world-dialog/WorldDialogHeaderSection.jsx';
import { buildWorldDialogDisplayInstanceRows } from './world-dialog/worldDialogInstanceRows.js';
import { WorldDialogTabPanels } from './world-dialog/WorldDialogTabPanels.jsx';
import {
    firstText,
    groupSeed,
    isGroupId,
    normalizeInstanceGroup,
    resolveInstanceRows,
    sameLocationTag
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
    const { t } = useTranslation();
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
    const currentResolvedLocation =
        currentGameLocation === 'traveling'
            ? currentGameDestination
            : currentGameLocation;
    const { creatorGroupKey, displayInstanceRows } =
        buildWorldDialogDisplayInstanceRows({
            creatorGroupsById,
            currentInstanceDetails,
            friendsById,
            instanceRows,
            isInstanceLocation,
            normalizedWorldId,
            world,
            worldDialogShortName
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
        toast.success(
            t('dialog.world.generated_dynamic.value_copied', { value: label })
        );
    }

    const headerState = {
        actionStatus,
        canManageWorld,
        canUpdateHome,
        detail,
        hasPersistData,
        imageUrl,
        isHomeWorld,
        isPublished,
        packageUrl,
        platformRows,
        previousInstances,
        visibleTags,
        world,
        worldUrl
    };
    const headerHandlers = {
        onChangeAllowedDomains,
        onChangeCapacity,
        onChangeDescription,
        onChangeImage,
        onChangePreview,
        onChangeRecommendedCapacity,
        onChangeTags,
        onChangeTab: changeTab,
        onCopyWorldId: () => copyWorldText(world.id, 'World ID'),
        onCopyWorldName: () => copyWorldText(world.name, 'World name'),
        onCopyWorldUrl: () => copyWorldText(worldUrl, 'World URL'),
        onDelete,
        onDeleteCache,
        onDeletePersistentData,
        onHome,
        onNewInstance,
        onNewInstanceSelfInvite,
        onOpenAuthor: () =>
            openUserDialog({
                userId: world.authorId,
                title: world.authorName || undefined
            }),
        onOpenCache,
        onOpenImage: () =>
            openImagePreview({
                url: convertFileUrlToImageUrl(world.imageUrl || imageUrl, 1024),
                title: world.name || 'World'
            }),
        onOpenPackage: () => openExternalLink(packageUrl),
        onOpenWorldPage: () => openExternalLink(worldUrl),
        onPublication: () => onPublication(!isPublished),
        onRefresh,
        onRename
    };
    const tabState = {
        activeTab,
        authorTags,
        currentUserId,
        displayInstanceRows,
        favoriteRate,
        hasPersistData,
        isInstanceLocation,
        lastVisitedInstance,
        memo,
        previousInstances,
        previewUrl,
        tabs,
        totalVisitTime,
        world,
        worldDialogShortName
    };
    const tabHandlers = {
        onChangeTab: changeTab,
        onOpenAuthor: () =>
            openUserDialog({
                userId: world.authorId,
                title: world.authorName || undefined
            }),
        onPreviousInstancesChange,
        onSaveMemo
    };

    return (
        <EntityDialogScaffold>
            <WorldDialogHeaderSection
                handlers={headerHandlers}
                state={headerState}
                t={t}
            />
            <WorldDialogTabPanels
                handlers={tabHandlers}
                helpers={{ formatDate }}
                state={tabState}
                t={t}
            />
        </EntityDialogScaffold>
    );
}
