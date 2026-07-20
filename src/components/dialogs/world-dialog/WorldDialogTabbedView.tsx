import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type ReactNode,
    type SetStateAction
} from 'react';
import { useTranslation } from 'react-i18next';

import type {
    EntityRecord,
    GroupProfileRecord,
    WorldProfileRecord
} from '@/domain/entities/profileEntities';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import mediaRepository from '@/repositories/mediaRepository';
import playerListPersistenceRepository from '@/repositories/playerListPersistenceRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import { copyTextToClipboard } from '@/services/clipboardService';
import { openUserDialog } from '@/services/dialogService';
import {
    recordGameRuntimePresence,
    recordLocationHintsFromInstances
} from '@/services/domainIngestionService';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/services/entityMediaService';
import { vrchatWorldUrl } from '@/shared/constants/vrchatWebUrls';
import { vrcxWorldDeepLink } from '@/shared/constants/vrcxDeepLinks';
import { parseLocation } from '@/shared/utils/location';
import { replaceVrcPackageUrl } from '@/shared/utils/urlUtils';

import {
    EntityDialogScaffold,
    EntityDialogTwoColumnLayout
} from '../EntityDialogScaffold';
import type { WorldPreviousInstances } from './useWorldDialogData';
import { useWorldDialogTabbedRuntimeState } from './useWorldDialogRuntimeState';
import { WorldDialogOverviewSection } from './WorldDialogHeaderSection';
import { buildWorldDialogDisplayInstanceRows } from './worldDialogInstanceRows';
import { WorldDialogTabPanels } from './WorldDialogTabPanels';
import {
    authorWorldTags,
    firstKnownValue,
    resolveWorldDialogTab,
    visibleWorldTags
} from './worldDialogUtils';
import {
    firstText,
    groupSeed,
    isGroupId,
    normalizeInstanceGroup,
    resolveInstanceRows,
    resolveLaunchLocation,
    sameLocationTag
} from './WorldDialogViewParts';

export type WorldWorldScreenshots = Array<{
    path: string;
    folderPath: string;
    fileName: string;
    sizeBytes: number;
    modifiedAt: number;
    createdAt: number;
    width: number;
    height: number;
    worldId: string;
    worldName: string | null;
    capturedAt: string | null;
    metadata: {
        application: string;
        version: number;
        author: {
            id: string;
            displayName?: string;
        };
        world: {
            id: string;
            name?: string;
            instanceId: string;
        };
        players: Array<{
            id: string;
            displayName: string;
        }>;
        sourceFile: string;
        timestamp?: string;
    };
    error: string | null;
}>;

export type WorldDialogDisplayInstanceRows = ReturnType<
    typeof buildWorldDialogDisplayInstanceRows
>['displayInstanceRows'];

export interface WorldDialogHeaderModel {
    actionStatus: string;
    canManageWorld: boolean;
    canUpdateHome: boolean;
    detail: string;
    favoriteRate: number;
    hasPersistData: boolean;
    imageUrl: string;
    isHomeWorld: boolean;
    isPublished: boolean;
    canOpenInstanceInGame: boolean;
    packageUrl: string;
    platformRows: string[];
    previousInstances: WorldPreviousInstances;
    visibleTags: ReturnType<typeof visibleWorldTags>;
    world: WorldProfileRecord;
    vrcxWorldUrl: string;
    worldUrl: string;
}

export interface WorldDialogHeaderCommands {
    onChangeAllowedDomains: () => void;
    onEditDetails: () => void;
    onChangeImage: () => void;
    onChangeTags: () => void;
    onChangeTab: (tab: string) => void;
    onCopyWorldId: () => void;
    onCopyWorldName: () => void;
    onCopyWorldUrl: () => void;
    onCopyVrcxWorldUrl: () => void;
    onDelete: () => void;
    onDeleteCache: () => void;
    onDeletePersistentData: () => void;
    onHome: () => void;
    onNewInstance: () => void;
    onNewInstanceSelfInvite: () => void;
    onOpenAuthor: () => void;
    onOpenCache: () => void;
    onOpenImage?: () => void;
    onOpenPackage: () => void;
    onOpenWorldPage: () => void;
    onPublication: () => void;
    onRefresh: () => void;
}

export interface WorldDialogTabModel {
    activeTab: string;
    authorTags: string[];
    currentUserId: string | null;
    displayInstanceRows: WorldDialogDisplayInstanceRows;
    favoriteRate: number;
    hasPersistData: boolean;
    isInstanceLocation: boolean;
    lastVisitedInstance: WorldPreviousInstances[number] | undefined;
    memo: string;
    previousInstances: WorldPreviousInstances;
    previewUrl: string;
    screenshots: WorldWorldScreenshots;
    screenshotsError: string;
    screenshotsRefreshDisabled: boolean;
    screenshotsStatus: string;
    tabs: Array<{ value: string; label: ReactNode }>;
    totalVisitTime: number;
    world: WorldProfileRecord;
    worldDialogShortName: string;
}

export interface WorldDialogTabCommands {
    onChangeTab: (tab: string) => void;
    onOpenAuthor: () => void;
    onOpenScreenshot: (path: string) => void;
    onPreviousInstancesChange: Dispatch<SetStateAction<WorldPreviousInstances>>;
    onRefreshScreenshots: () => void;
    onSaveMemo: (memo: string) => void | Promise<void>;
}

let lastWorldDialogTab = 'instances';

type CurrentInstanceDetails = {
    location: string;
    instance: EntityRecord | null;
    ownerUser: EntityRecord | null;
    ownerGroup: EntityRecord | null;
    playerSnapshot: unknown;
};

type InstanceDetailTarget = {
    location: string;
    worldId: string;
    instanceId: string;
};

type InstanceDetailCacheEntry = {
    endpoint: string;
    instance: EntityRecord;
};

type InstanceDetailResult = {
    location: string;
    instance: EntityRecord;
};

function isInstanceDetailResult(
    value: { location: string; instance: EntityRecord | null } | null
): value is InstanceDetailResult {
    return Boolean(value?.instance);
}

type ScreenshotScanStatus = Awaited<
    ReturnType<typeof mediaRepository.getScreenshotLibraryStatus>
>;

type WorldDialogTabbedViewProps = {
    world: WorldProfileRecord;
    resource: {
        memo: string;
        detail: string;
        imageUrl: string;
        actionStatus: string;
        normalizedWorldId: string;
        openNonce?: number;
        previousInstances?: WorldPreviousInstances;
    };
    permissions: {
        isInstanceLocation: boolean;
        worldDialogShortName?: string;
        isHomeWorld: boolean;
        isGameRunning: boolean;
        canUpdateHome: boolean;
        canManageWorld: boolean;
        hasPersistData?: boolean;
    };
    worldControls: {
        onRefresh: () => void;
        onHome: () => void;
        onEditDetails: () => void;
        onChangeTags: () => void;
        onChangeAllowedDomains: () => void;
        onChangeImage: () => void;
        onNewInstance: () => void;
        onNewInstanceSelfInvite: () => void;
        onPublication: (published: boolean) => void;
        onSaveMemo: (memo: string) => void | Promise<void>;
        onOpenCache: () => void;
        onDeleteCache: () => void;
        onDeletePersistentData: () => void;
        onDelete: () => void;
        onOpenScreenshot: (path: string) => void;
        onPreviousInstancesChange: Dispatch<
            SetStateAction<WorldPreviousInstances>
        >;
    };
};

function isRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object');
}

function record(value: unknown): EntityRecord {
    return isRecord(value) ? value : {};
}

function firstRecord(...values: unknown[]): EntityRecord | null {
    return values.find(isRecord) ?? null;
}

export function WorldDialogTabbedView({
    permissions,
    resource,
    world,
    worldControls
}: WorldDialogTabbedViewProps) {
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
    const [currentInstanceDetails, setCurrentInstanceDetails] =
        useState<CurrentInstanceDetails>({
            location: '',
            instance: null,
            ownerUser: null,
            ownerGroup: null,
            playerSnapshot: null
        });
    const [instanceDetailsByLocation, setInstanceDetailsByLocation] = useState<
        Record<string, InstanceDetailCacheEntry>
    >({});
    const [creatorGroupsById, setCreatorGroupsById] = useState<
        Record<string, GroupProfileRecord>
    >({});
    const [worldScreenshots, setWorldScreenshots] =
        useState<WorldWorldScreenshots>([]);
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
        const targetsByLocation = new Map<string, InstanceDetailTarget>();
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
        .map((target) => target.location)
        .sort()
        .join('|');
    const hydratedInstanceRows = instanceRows.map((instance: EntityRecord) => {
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
                record(detail.world).capacity,
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

    function changeTab(tab: string) {
        lastWorldDialogTab = resolveWorldDialogTab(tabs, tab);
        setActiveTab(lastWorldDialogTab);
    }

    function refreshWorldScreenshots() {
        worldScreenshotsForceRefreshRef.current = true;
        setWorldScreenshotsRefreshToken((current) => current + 1);
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

        const completeScan = (status: ScreenshotScanStatus) => {
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
                .then((status) => {
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
                .catch((error: unknown) => {
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
            .then((status) => {
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
            .catch((error: unknown) => {
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
            instanceDetailTargets.map((target) => target.location)
        );

        Promise.all(
            instanceDetailTargets.map((target) =>
                vrchatInstanceRepository
                    .getInstance({
                        worldId: target.worldId,
                        instanceId: target.instanceId
                    })
                    .then((response) => ({
                        location: target.location,
                        instance: isRecord(response.json) ? response.json : null
                    }))
                    .catch((): null => null)
            )
        ).then((rawEntries) => {
            if (!active) {
                return;
            }
            const entries = rawEntries;
            recordLocationHintsFromInstances({
                endpoint: currentEndpoint,
                instances: entries
                    .filter(isInstanceDetailResult)
                    .map((entry) => {
                        const parsedLocation = parseLocation(entry.location);
                        return {
                            ...entry.instance,
                            location: entry.location,
                            worldId: parsedLocation.worldId,
                            instanceId: parsedLocation.instanceId
                        };
                    })
            });
            setInstanceDetailsByLocation((current) => {
                const next: Record<string, InstanceDetailCacheEntry> = {};
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
            groupIds.map((groupId) =>
                groupProfileRepository
                    .getGroupProfile({
                        groupId,
                        includeRoles: false
                    })
                    .then((groupProfile) => ({ groupId, groupProfile }))
                    .catch((): null => null)
            )
        ).then((rawEntries) => {
            if (!active) {
                return;
            }
            const entries = rawEntries;
            setCreatorGroupsById((current) => {
                const next: Record<string, GroupProfileRecord> = {
                    ...current
                };
                let changed = false;
                for (const entry of entries) {
                    if (!entry) {
                        continue;
                    }
                    next[entry.groupId] = entry.groupProfile;
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
                    instanceId: parsedLocation.instanceId
                })
                .then((response) =>
                    isRecord(response.json) ? response.json : null
                )
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
            .then(async ([instance, playerSnapshot]) => {
                const playerSnapshotRecord = record(playerSnapshot);
                const playerContext = record(playerSnapshotRecord.context);
                const snapshotPlayers = (
                    Array.isArray(playerSnapshotRecord.players)
                        ? playerSnapshotRecord.players
                        : []
                ).map((player) => {
                    const source = record(player);
                    const userId = firstText(source.userId, source.user_id);
                    return {
                        id: userId,
                        userId,
                        displayName: firstText(
                            source.displayName,
                            source.display_name
                        ),
                        joinedAt: firstText(source.joinedAt, source.joined_at)
                    };
                });
                const instanceRecord = instance || {};
                const ownerUserRecord = record(instanceRecord.ownerUser);
                const ownerRecord = record(instanceRecord.owner);
                const creatorUserRecord = record(instanceRecord.creatorUser);
                const userRecord = record(instanceRecord.user);
                const groupRecord = record(instanceRecord.group);
                const ownerId = firstText(
                    parsedLocation.userId,
                    instanceRecord.ownerUserId,
                    instanceRecord.owner_user_id,
                    instanceRecord.ownerId,
                    instanceRecord.owner_id,
                    instanceRecord.userId,
                    instanceRecord.user_id,
                    instanceRecord.creatorUserId,
                    instanceRecord.creator_user_id,
                    ownerUserRecord.id,
                    ownerUserRecord.userId,
                    ownerRecord.id,
                    ownerRecord.userId,
                    creatorUserRecord.id,
                    creatorUserRecord.userId,
                    userRecord.id,
                    userRecord.userId,
                    instanceRecord.groupId,
                    instanceRecord.group_id,
                    groupRecord.id,
                    parsedLocation.groupId
                );
                const ownerIsGroup = isGroupId(ownerId);
                const ownerSeed = ownerIsGroup
                    ? firstRecord(
                          instanceRecord.group,
                          instanceRecord.ownerGroup,
                          instanceRecord.owner_group,
                          groupSeed(instanceRecord.owner),
                          instanceRecord.creatorGroup,
                          instanceRecord.creator_group
                      )
                    : firstRecord(
                          instanceRecord.ownerUser,
                          instanceRecord.owner,
                          instanceRecord.creatorUser,
                          instanceRecord.user
                      );
                let ownerUser = null;
                let ownerGroup = null;
                if (ownerIsGroup) {
                    ownerGroup = ownerSeed
                        ? normalizeInstanceGroup(ownerSeed, ownerId)
                        : ownerId
                          ? await groupProfileRepository
                                .getGroupProfile({
                                    groupId: ownerId,
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
                                    userId: ownerId
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
                            ...instanceRecord,
                            location: normalizedWorldId,
                            worldId: parsedLocation.worldId,
                            instanceId: parsedLocation.instanceId,
                            worldName: world?.name,
                            users: instanceRecord.users,
                            players: instanceRecord.players || snapshotPlayers,
                            usersById: instanceRecord.usersById,
                            userIds: instanceRecord.userIds
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
                            playerContext.createdAt ||
                            '',
                        currentLocationPlayers: snapshotPlayers,
                        currentWorldName:
                            playerContext.worldName || world?.name || ''
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

    const worldUrl = world.id ? vrchatWorldUrl(world.id) : '';
    const vrcxWorldUrl = vrcxWorldDeepLink(world.id);
    const packageUrl = replaceVrcPackageUrl(
        firstText(world.unityPackageUrl, record(world.unityPackage).url)
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

    function copyWorldText(text: string, label: string) {
        return copyTextToClipboard(text, {
            successMessage: t('dialog.world.dynamic.value_copied', {
                value: label
            })
        });
    }

    const headerModel: WorldDialogHeaderModel = {
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
        vrcxWorldUrl,
        worldUrl
    };
    const headerCommands: WorldDialogHeaderCommands = {
        onChangeAllowedDomains,
        onEditDetails,
        onChangeImage,
        onChangeTags,
        onChangeTab: changeTab,
        onCopyWorldId: () => copyWorldText(world.id, 'World ID'),
        onCopyWorldName: () => copyWorldText(world.name, 'World name'),
        onCopyWorldUrl: () => copyWorldText(worldUrl, 'World URL'),
        onCopyVrcxWorldUrl: () =>
            copyWorldText(vrcxWorldUrl, t('dialog.world.info.vrcx_url')),
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
    const tabModel: WorldDialogTabModel = {
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
    const tabCommands: WorldDialogTabCommands = {
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
