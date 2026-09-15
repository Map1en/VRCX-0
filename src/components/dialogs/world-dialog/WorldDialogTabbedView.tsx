import {
    useEffect,
    useMemo,
    useState,
    type Dispatch,
    type ReactNode,
    type SetStateAction
} from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupProfileRecord } from '@/domain/entities/group';
import type { EntityRecord } from '@/domain/entities/shared';
import type { WorldProfileRecord } from '@/domain/entities/world';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { copyTextToClipboard } from '@/services/clipboardService';
import { openUserDialog } from '@/services/dialogService';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/services/entityMediaService';
import { vrchatWorldUrl } from '@/shared/constants/vrchatWebUrls';
import { vrcxWorldDeepLink } from '@/shared/constants/vrcxDeepLinks';
import { parseLocation } from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';
import { replaceVrcPackageUrl } from '@/shared/utils/urlUtils';

import {
    EntityDialogScaffold,
    EntityDialogTwoColumnLayout
} from '../EntityDialogScaffold';
import { useWorldDialogCurrentInstance } from './useWorldDialogCurrentInstance';
import type {
    WorldFriendVisits,
    WorldPreviousInstances
} from './useWorldDialogData';
import {
    useWorldDialogInstanceData,
    type WorldDialogInstanceDetailTarget
} from './useWorldDialogInstanceData';
import { useWorldDialogTabbedRuntimeState } from './useWorldDialogRuntimeState';
import {
    useWorldDialogScreenshots,
    type WorldWorldScreenshots
} from './useWorldDialogScreenshots';
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
    resolveInstanceRows,
    resolveLaunchLocation
} from './WorldDialogViewParts';

export type { WorldWorldScreenshots } from './useWorldDialogScreenshots';

type WorldDialogDisplayInstanceRows = ReturnType<
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
    friendVisits: WorldFriendVisits;
    hasPersistData: boolean;
    isInstanceLocation: boolean;
    lastVisitedInstance: WorldPreviousInstances[number] | undefined;
    memo: string;
    previousInstances: WorldPreviousInstances;
    previewUrl: string;
    restrictions: ReturnType<typeof visibleWorldTags>['restrictions'];
    screenshots: WorldWorldScreenshots;
    screenshotsError: string;
    screenshotsRefreshDisabled: boolean;
    screenshotsStatus: string;
    tabs: Array<{ value: string; label: ReactNode }>;
    totalVisitTime: number;
    visibleInstanceUserIds: ReadonlySet<string>;
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
        friendVisits?: WorldFriendVisits;
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

function record(value: unknown): EntityRecord {
    return isRecord(value) ? value : {};
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
        previousInstances = [],
        friendVisits = null
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
        currentLocationPlayers,
        currentLocationStartedAt,
        currentUserId,
        currentUserSnapshot,
        friendsById,
        openImagePreview,
        screenshotCacheStatus
    } = useWorldDialogTabbedRuntimeState();
    const [activeTab, setActiveTab] = useState(() => lastWorldDialogTab);
    const [creatorGroupsById, setCreatorGroupsById] = useState<
        Record<string, GroupProfileRecord>
    >({});
    const instanceRows = useMemo(() => resolveInstanceRows(world), [world]);
    const instanceDetailTargets = useMemo(() => {
        const targetsByLocation = new Map<
            string,
            WorldDialogInstanceDetailTarget
        >();
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
    }, [instanceRows, world]);
    const instanceData = useWorldDialogInstanceData({
        endpoint: currentEndpoint,
        sourceRevision: world.instances,
        targets: instanceDetailTargets
    });
    const instanceDetailsByLocation = instanceData.detailsByLocation;
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
    const currentResolvedLocation = isGameRunning ? currentGameLocation : '';
    const currentInstanceDetails = useWorldDialogCurrentInstance({
        currentResolvedLocation,
        isInstanceLocation,
        normalizedWorldId,
        runtime: {
            currentEndpoint,
            currentLocationPlayers,
            currentLocationStartedAt,
            currentUserId,
            currentUserSnapshot
        },
        worldName: world?.name
    });
    const {
        screenshots: worldScreenshots,
        status: worldScreenshotsStatus,
        error: worldScreenshotsError,
        refresh: refreshWorldScreenshots
    } = useWorldDialogScreenshots({
        active: activeTab === 'screenshots',
        endpoint: currentEndpoint,
        openNonce,
        worldId: world?.id || ''
    });
    const visibleInstanceUserIds = useMemo(() => {
        const userIds = new Set(Object.keys(friendsById || {}));
        const normalizedCurrentUserId = firstText(
            currentUserId,
            currentUserSnapshot?.id
        );
        if (normalizedCurrentUserId) {
            userIds.add(normalizedCurrentUserId);
        }
        return userIds;
    }, [currentUserId, currentUserSnapshot?.id, friendsById]);
    const { creatorGroupKey, displayInstanceRows } =
        buildWorldDialogDisplayInstanceRows({
            creatorGroupsById,
            currentInstanceDetails,
            currentLocation: currentResolvedLocation,
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
        onCopyWorldId: () => copyWorldText(world.id, t('dialog.world.info.id')),
        onCopyWorldName: () =>
            copyWorldText(world.name, t('dialog.world.info.name')),
        onCopyWorldUrl: () =>
            copyWorldText(worldUrl, t('dialog.world.info.url')),
        onCopyVrcxWorldUrl: () => {
            copyWorldText(
                t('dialog.world.info.vrcx_share_text', {
                    name: world.name,
                    url: vrcxWorldUrl
                }),
                t('dialog.world.info.vrcx_url')
            );
            worldProfileRepository.registerWorldOpenShare(world.id);
        },
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
        friendVisits,
        hasPersistData,
        isInstanceLocation,
        lastVisitedInstance,
        memo,
        previousInstances,
        previewUrl,
        restrictions: visibleTags.restrictions,
        screenshots: worldScreenshots,
        screenshotsError: worldScreenshotsError,
        screenshotsStatus: worldScreenshotsStatus,
        screenshotsRefreshDisabled: worldScreenshotsStatus === 'loading',
        tabs,
        totalVisitTime,
        visibleInstanceUserIds,
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
