import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import groupProfileRepository from '@/repositories/groupProfileRepository';
import mediaRepository from '@/repositories/mediaRepository';
import playerListPersistenceRepository from '@/repositories/playerListPersistenceRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import { openUserDialog } from '@/services/dialogService';
import {
    recordGameRuntimePresence,
    recordLocationHintsFromInstances
} from '@/services/domainIngestionService';
import {
    convertFileUrlToImageUrl,
    copyTextToClipboard,
    openExternalLink
} from '@/services/entityMediaService';
import { parseLocation } from '@/shared/utils/location';
import { replaceVrcPackageUrl } from '@/shared/utils/urlUtils';

import {
    EntityDialogScaffold,
    EntityDialogTwoColumnLayout
} from '../EntityDialogScaffold';
import { useWorldDialogTabbedRuntimeState } from './useWorldDialogRuntimeState';
import { WorldDialogOverviewSection } from './WorldDialogHeaderSection';
import { buildWorldDialogDisplayInstanceRows } from './worldDialogInstanceRows';
import { WorldDialogTabPanels } from './WorldDialogTabPanels';
import {
    firstText,
    groupSeed,
    isGroupId,
    normalizeInstanceGroup,
    resolveInstanceRows,
    resolveLaunchLocation,
    sameLocationTag
} from './WorldDialogViewParts';

let lastWorldDialogTab = 'instances';

function resolveWorldDialogTab(
    tabs: any,
    preferred: any,
    fallback: any = 'instances'
) {
    return tabs.some((tab: any) => tab.value === preferred)
        ? preferred
        : fallback;
}

function authorWorldTags(tags: any[] = []) {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags
        .filter((tag: any) => String(tag).startsWith('author_tag_'))
        .map((tag: any) => String(tag).replace(/^author_tag_/, ''))
        .filter(Boolean);
}

function firstKnownValue(...values: any[]) {
    for (const value of values) {
        if (value !== null && typeof value !== 'undefined' && value !== '') {
            return value;
        }
    }
    return undefined;
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

function visibleWorldTags(world: any, t: any) {
    const tags = Array.isArray(world?.tags) ? world.tags : [];
    const entries: Array<{ key: string; label: string }> = [];
    const seen = new Set<string>();
    const pushTag = (key: any, label: any) => {
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
    permissions,
    resource,
    world,
    worldControls
}: any) {
    const { t } = useTranslation();
    const {
        memo,
        detail,
        imageUrl,
        actionStatus,
        normalizedWorldId,
        openNonce = 0,
        previousInstances = []
    } = resource;
    const {
        isInstanceLocation,
        worldDialogShortName = '',
        isHomeWorld,
        isGameRunning,
        canUpdateHome,
        canManageWorld,
        hasPersistData = false
    } = permissions;
    const {
        onRefresh,
        onHome,
        onEditDetails,
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
        onOpenScreenshot,
        onPreviousInstancesChange
    } = worldControls;
    const {
        currentEndpoint,
        currentGameLocation,
        currentLocationStartedAt,
        currentUserId,
        currentUserSnapshot,
        friendsById,
        openImagePreview,
        screenshotCacheStatus
    } = useWorldDialogTabbedRuntimeState();
    const [activeTab, setActiveTab] = useState(() => lastWorldDialogTab);
    const [currentInstanceDetails, setCurrentInstanceDetails] = useState<any>({
        location: '',
        instance: null,
        ownerUser: null,
        ownerGroup: null,
        playerSnapshot: null
    });
    const [instanceDetailsByLocation, setInstanceDetailsByLocation] =
        useState<any>({});
    const [creatorGroupsById, setCreatorGroupsById] = useState<any>({});
    const [worldScreenshots, setWorldScreenshots] = useState<any[]>([]);
    const [worldScreenshotsStatus, setWorldScreenshotsStatus] =
        useState('idle');
    const [worldScreenshotsError, setWorldScreenshotsError] = useState('');
    const [worldScreenshotsRefreshToken, setWorldScreenshotsRefreshToken] =
        useState(0);
    const worldScreenshotsForceRefreshRef = useRef(false);
    const instanceRows = useMemo(
        () => resolveInstanceRows(world),
        [world?.id, world?.instances]
    );
    const instanceDetailTargets = useMemo(() => {
        const targetsByLocation = new Map();
        for (const instance of instanceRows) {
            const location = resolveLaunchLocation(world, instance);
            const parsedLocation = parseLocation(location);
            if (
                parsedLocation.isRealInstance &&
                parsedLocation.worldId &&
                parsedLocation.instanceId
            ) {
                targetsByLocation.set(location, {
                    location,
                    worldId: parsedLocation.worldId,
                    instanceId: parsedLocation.instanceId
                });
            }
        }
        return Array.from(targetsByLocation.values());
    }, [instanceRows, world?.id]);
    const instanceDetailTargetKey = instanceDetailTargets
        .map((target: any) => target.location)
        .sort()
        .join('|');
    const hydratedInstanceRows = instanceRows.map((instance: any) => {
        const location = resolveLaunchLocation(world, instance);
        const cachedDetail = instanceDetailsByLocation[location];
        if (
            !cachedDetail ||
            cachedDetail.endpoint !== currentEndpoint ||
            !cachedDetail.instance
        ) {
            return instance;
        }
        const detail = cachedDetail.instance;
        return {
            ...instance,
            ref: detail,
            userCount: firstKnownValue(
                detail.userCount,
                detail.occupants,
                detail.n_users,
                instance.userCount
            ),
            occupants: firstKnownValue(
                detail.userCount,
                detail.occupants,
                detail.n_users,
                instance.occupants
            ),
            playerCount: firstKnownValue(
                detail.userCount,
                detail.occupants,
                detail.n_users,
                Array.isArray(detail.users) ? detail.users.length : undefined,
                instance.playerCount,
                instance.userCount,
                instance.occupants
            ),
            capacity: firstKnownValue(
                detail.capacity,
                detail.world?.capacity,
                instance.capacity,
                world.capacity
            )
        };
    });
    const currentResolvedLocation = currentGameLocation;
    const { creatorGroupKey, displayInstanceRows } =
        buildWorldDialogDisplayInstanceRows({
            creatorGroupsById,
            currentInstanceDetails,
            friendsById,
            instanceRows: hydratedInstanceRows,
            isInstanceLocation,
            normalizedWorldId,
            world,
            worldDialogShortName
        });
    const tabs = [
        { value: 'instances', label: t('dialog.world.instances.header') },
        {
            value: 'visit-history',
            label: t('dialog.previous_instances.header')
        },
        ...(screenshotCacheStatus?.available
            ? [
                  {
                      value: 'screenshots',
                      label: t('dialog.world.screenshots.header')
                  }
              ]
            : []),
        { value: 'info', label: t('dialog.world.info.header') },
        { value: 'json', label: t('dialog.world.json.header') }
    ];

    function changeTab(tab: any) {
        lastWorldDialogTab = resolveWorldDialogTab(tabs, tab);
        setActiveTab(lastWorldDialogTab);
    }

    function refreshWorldScreenshots() {
        worldScreenshotsForceRefreshRef.current = true;
        setWorldScreenshotsRefreshToken((current: any) => current + 1);
    }

    useEffect(() => {
        setWorldScreenshots([]);
        setWorldScreenshotsStatus('idle');
        setWorldScreenshotsError('');
    }, [world?.id]);

    useEffect(() => {
        if (activeTab !== 'screenshots' || !world?.id) {
            return undefined;
        }

        let active = true;
        let pollTimer = 0;
        let pollInFlight = false;
        let scanCompleted = false;
        let scanError = '';

        const loadWorldScreenshots = async () => {
            try {
                const screenshots = await mediaRepository.getWorldScreenshots(
                    world.id
                );
                if (!active) {
                    return;
                }
                const screenshotList = Array.isArray(screenshots)
                    ? screenshots
                    : [];
                setWorldScreenshots(screenshotList);
                if (scanError) {
                    setWorldScreenshotsError(scanError);
                    setWorldScreenshotsStatus(
                        screenshotList.length ? 'ready' : 'error'
                    );
                    return;
                }
                setWorldScreenshotsError('');
                setWorldScreenshotsStatus('ready');
            } catch (error) {
                if (!active) {
                    return;
                }
                setWorldScreenshots([]);
                setWorldScreenshotsError(
                    error instanceof Error
                        ? error.message
                        : t('dialog.world.screenshots.load_failed')
                );
                setWorldScreenshotsStatus('error');
            }
        };

        const completeScan = (status: any) => {
            if (scanCompleted) {
                return;
            }
            scanCompleted = true;
            if (status?.error) {
                scanError = status.error;
            }
            loadWorldScreenshots();
        };

        const pollScanStatus = () => {
            if (pollInFlight || scanCompleted) {
                return;
            }
            pollInFlight = true;
            mediaRepository
                .getScreenshotLibraryStatus()
                .then((status: any) => {
                    if (!active) {
                        return;
                    }
                    if (status?.error) {
                        scanError = status.error;
                    }
                    if (!status?.running) {
                        if (pollTimer) {
                            window.clearInterval(pollTimer);
                            pollTimer = 0;
                        }
                        completeScan(status);
                    }
                })
                .catch((error: any) => {
                    if (!active) {
                        return;
                    }
                    if (pollTimer) {
                        window.clearInterval(pollTimer);
                        pollTimer = 0;
                    }
                    setWorldScreenshots([]);
                    setWorldScreenshotsError(
                        error instanceof Error
                            ? error.message
                            : t('dialog.world.screenshots.load_failed')
                    );
                    setWorldScreenshotsStatus('error');
                })
                .finally(() => {
                    pollInFlight = false;
                });
        };

        setWorldScreenshotsStatus('loading');
        setWorldScreenshotsError('');
        const forceRefresh = worldScreenshotsForceRefreshRef.current;
        worldScreenshotsForceRefreshRef.current = false;
        mediaRepository
            .startScreenshotLibraryScan(forceRefresh)
            .then((status: any) => {
                if (!active) {
                    return;
                }
                if (status?.error) {
                    scanError = status.error;
                }
                if (status?.running) {
                    pollTimer = window.setInterval(pollScanStatus, 1000);
                    pollScanStatus();
                    return;
                }
                completeScan(status);
            })
            .catch((error: any) => {
                if (!active) {
                    return;
                }
                setWorldScreenshots([]);
                setWorldScreenshotsError(
                    error instanceof Error
                        ? error.message
                        : t('dialog.world.screenshots.load_failed')
                );
                setWorldScreenshotsStatus('error');
            });

        return () => {
            active = false;
            if (pollTimer) {
                window.clearInterval(pollTimer);
            }
        };
    }, [activeTab, openNonce, t, world?.id, worldScreenshotsRefreshToken]);

    useEffect(() => {
        if (!instanceDetailTargets.length) {
            setInstanceDetailsByLocation({});
            return undefined;
        }

        let active = true;
        const targetLocations = new Set(
            instanceDetailTargets.map((target: any) => target.location)
        );

        Promise.all(
            instanceDetailTargets.map((target: any) =>
                vrchatInstanceRepository
                    .getInstance({
                        worldId: target.worldId,
                        instanceId: target.instanceId,
                        endpoint: currentEndpoint
                    })
                    .then((response: any) => ({
                        location: target.location,
                        instance: response.json
                    }))
                    .catch((): null => null)
            )
        ).then((entries: any) => {
            if (!active) {
                return;
            }
            recordLocationHintsFromInstances({
                endpoint: currentEndpoint,
                instances: entries
                    .filter((entry: any) => entry?.instance)
                    .map((entry: any) => {
                        const parsedLocation = parseLocation(entry.location);
                        return {
                            ...entry.instance,
                            location: entry.location,
                            worldId: parsedLocation.worldId,
                            instanceId: parsedLocation.instanceId
                        };
                    })
            });
            setInstanceDetailsByLocation((current: any) => {
                const next: any = {};
                for (const location of targetLocations) {
                    const currentEntry = current[location];
                    if (currentEntry?.endpoint === currentEndpoint) {
                        next[location] = currentEntry;
                    }
                }
                for (const entry of entries) {
                    if (!entry?.instance) {
                        continue;
                    }
                    next[entry.location] = {
                        endpoint: currentEndpoint,
                        instance: entry.instance
                    };
                }
                return next;
            });
        });

        return () => {
            active = false;
        };
    }, [currentEndpoint, instanceDetailTargetKey, instanceDetailTargets]);

    useEffect(() => {
        const groupIds = creatorGroupKey
            ? creatorGroupKey.split('|').filter(Boolean)
            : [];
        if (!groupIds.length) {
            return undefined;
        }

        let active = true;
        Promise.all(
            groupIds.map((groupId: any) =>
                groupProfileRepository
                    .getGroupProfile({
                        groupId,
                        endpoint: currentEndpoint,
                        includeRoles: false
                    })
                    .then((groupProfile: any) => [groupId, groupProfile])
                    .catch((): null => null)
            )
        ).then((entries: any) => {
            if (!active) {
                return;
            }
            setCreatorGroupsById((current: any) => {
                const next: any = { ...current };
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
            vrchatInstanceRepository
                .getInstance({
                    worldId: parsedLocation.worldId,
                    instanceId: parsedLocation.instanceId,
                    endpoint: currentEndpoint
                })
                .then((response: any) => response.json)
                .catch((): null => null),
            isCurrentLiveInstance
                ? playerListPersistenceRepository
                      .getCurrentInstanceSnapshot({
                          currentUserId,
                          currentLocation: normalizedWorldId
                      })
                      .catch((): null => null)
                : Promise.resolve(null)
        ])
            .then(async ([instance, playerSnapshot]: any) => {
                const snapshotPlayers = Array.isArray(playerSnapshot?.players)
                    ? playerSnapshot.players
                    : [];
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
                recordLocationHintsFromInstances({
                    endpoint: currentEndpoint,
                    instances: [
                        {
                            ...(instance || {}),
                            location: normalizedWorldId,
                            worldId: parsedLocation.worldId,
                            instanceId: parsedLocation.instanceId,
                            worldName: world?.name,
                            users: instance?.users,
                            players: instance?.players || snapshotPlayers,
                            usersById: instance?.usersById,
                            userIds: instance?.userIds
                        }
                    ]
                });
                if (isCurrentLiveInstance) {
                    recordGameRuntimePresence({
                        endpoint: currentEndpoint,
                        currentUserId,
                        currentUserSnapshot,
                        currentLocation: normalizedWorldId,
                        currentLocationStartedAt:
                            currentLocationStartedAt ||
                            playerSnapshot?.context?.createdAt ||
                            '',
                        currentLocationPlayers: snapshotPlayers,
                        currentWorldName:
                            playerSnapshot?.context?.worldName ||
                            world?.name ||
                            ''
                    });
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
        currentLocationStartedAt,
        currentUserId,
        currentUserSnapshot,
        isInstanceLocation,
        normalizedWorldId,
        world?.name
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
        (total: any, instance: any) => total + (Number(instance?.time) || 0),
        0
    );
    const favoriteRate =
        Number(world.visits) > 0 && Number(world.favorites) > 0
            ? Math.round((Number(world.favorites) / Number(world.visits)) * 100)
            : 0;

    async function copyWorldText(text: any, label: any) {
        await copyTextToClipboard(text);
        toast.success(t('dialog.world.dynamic.value_copied', { value: label }));
    }

    const headerModel: any = {
        actionStatus,
        canManageWorld,
        canUpdateHome,
        detail,
        favoriteRate,
        hasPersistData,
        imageUrl,
        isHomeWorld,
        isPublished,
        canOpenInstanceInGame: Boolean(isGameRunning),
        packageUrl,
        platformRows,
        previousInstances,
        visibleTags,
        world,
        worldUrl
    };
    const headerCommands: any = {
        onChangeAllowedDomains,
        onEditDetails,
        onChangeImage,
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
        onRefresh
    };
    const tabModel: any = {
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
        screenshots: worldScreenshots,
        screenshotsError: worldScreenshotsError,
        screenshotsStatus: worldScreenshotsStatus,
        screenshotsRefreshDisabled: worldScreenshotsStatus === 'loading',
        tabs,
        totalVisitTime,
        world,
        worldDialogShortName
    };
    const tabCommands: any = {
        onChangeTab: changeTab,
        onOpenAuthor: () =>
            openUserDialog({
                userId: world.authorId,
                title: world.authorName || undefined
            }),
        onOpenScreenshot,
        onPreviousInstancesChange,
        onRefreshScreenshots: refreshWorldScreenshots,
        onSaveMemo
    };

    return (
        <EntityDialogScaffold className="gap-3">
            <EntityDialogTwoColumnLayout
                railMaxHeight="50vh"
                rail={
                    <WorldDialogOverviewSection
                        headerModel={headerModel}
                        headerCommands={headerCommands}
                    />
                }
            >
                <WorldDialogTabPanels
                    tabModel={tabModel}
                    tabCommands={tabCommands}
                />
            </EntityDialogTwoColumnLayout>
        </EntityDialogScaffold>
    );
}
