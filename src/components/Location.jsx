import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    AlertTriangleIcon,
    CopyIcon,
    ExternalLinkIcon,
    FlagIcon,
    HistoryIcon,
    Loader2Icon,
    LockIcon,
    MessageSquareIcon,
    Share2Icon
} from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog.jsx';
import { cn } from '@/lib/utils.js';
import { copyTextToClipboard } from '@/lib/entityMedia.js';
import {
    gameLogRepository,
    groupProfileRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import { entityQueryPolicies, queryKeys } from '@/services/entityQueryCacheService.js';
import { openGroupDialog, openWorldDialog } from '@/services/dialogService.js';
import { directAccessParse } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import {
    getLocationText,
    parseLocation,
    resolveRegion,
    translateAccessType
} from '@/shared/utils/location.js';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType.js';
import { useLaunchStore } from '@/state/launchStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu.jsx';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@/ui/shadcn/tooltip.jsx';

const WORLD_ID_PATTERN = /(?:^|\b)wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::|$|\s)/i;

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function isRawWorldReference(value) {
    const normalizedValue = normalizeString(value);
    return Boolean(normalizedValue && WORLD_ID_PATTERN.test(normalizedValue));
}

function normalizeWorldNameHint(hint, parsedLocation, currentLocation) {
    const normalizedHint = normalizeString(hint);
    if (!normalizedHint) {
        return '';
    }
    if (
        normalizedHint === normalizeString(parsedLocation.worldId) ||
        normalizedHint === normalizeString(parsedLocation.tag) ||
        normalizedHint === normalizeString(currentLocation) ||
        isRawWorldReference(normalizedHint)
    ) {
        return '';
    }
    return normalizedHint;
}

function locationTarget(location, traveling) {
    const normalizedLocation = normalizeString(location);
    if (typeof traveling !== 'undefined' && normalizedLocation === 'traveling') {
        return normalizeString(traveling);
    }
    return normalizedLocation;
}

function instanceLocation(instance) {
    return normalizeString(instance?.location || instance?.tag || instance?.$location?.tag);
}

function locationCacheKey(location) {
    const parsed = parseLocation(location);
    if (!parsed.worldId || !parsed.instanceId) {
        return '';
    }
    return `${parsed.worldId}:${parsed.instanceId}`;
}

function buildCachedInstanceMap(instances) {
    const map = new Map();
    if (!Array.isArray(instances)) {
        return map;
    }

    for (const instance of instances) {
        const location = instanceLocation(instance);
        if (location) {
            map.set(location, instance);
            const key = locationCacheKey(location);
            if (key) {
                map.set(key, instance);
            }
        }
    }
    return map;
}

function readInstanceDisplayName(instance) {
    return normalizeString(
        instance?.displayName ||
            instance?.name ||
            instance?.instanceDisplayName ||
            instance?.$location?.displayName
    );
}

function readInstanceWorldName(instance) {
    return normalizeString(
        instance?.worldName ||
            instance?.world_name ||
            instance?.world?.name ||
            instance?.ref?.worldName ||
            instance?.ref?.world?.name ||
            instance?.$location?.worldName ||
            instance?.$location?.world?.name
    );
}

function readInstanceGroupName(instance) {
    return normalizeString(
        instance?.groupName ||
            instance?.group_name ||
            instance?.group?.name ||
            instance?.group?.displayName ||
            instance?.ref?.groupName ||
            instance?.ref?.group?.name ||
            instance?.ref?.group?.displayName ||
            instance?.$location?.groupName ||
            instance?.$location?.group?.name ||
            instance?.$location?.group?.displayName
    );
}

function isInstanceClosed(instance) {
    return Boolean(instance?.closedAt || instance?.closed_at || instance?.isClosed);
}

function groupProfileName(group) {
    return normalizeString(group?.name || group?.displayName || group?.shortCode);
}

function LocationTooltip({ disabled, content, children }) {
    if (disabled || !content) {
        return children;
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent>{content}</TooltipContent>
        </Tooltip>
    );
}

export function Location({
    location = '',
    traveling,
    hint = '',
    grouphint = '',
    link = true,
    disableTooltip = false,
    isOpenPreviousInstanceInfoDialog = false,
    enableContextMenu = false,
    showInstanceIdInLocation,
    showLaunchActions = false,
    endpoint = '',
    onShowPreviousInstances,
    onNewInstance,
    previousInstancesDisabled = false,
    stopPropagation = false,
    asButton = true,
    className = ''
}) {
    const { t } = useI18n();
    const storeEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentEndpoint = endpoint || storeEndpoint;
    const showLaunchDialog = useLaunchStore((state) => state.showLaunchDialog);
    const groupInstancesState = useRuntimeStore((state) => state.groupInstances);
    const groupInstances = groupInstancesState.endpoint === currentEndpoint ? groupInstancesState.instances : [];
    const groupInstancesRevision = groupInstancesState.endpoint === currentEndpoint
        ? groupInstancesState.lastLoadedAt || groupInstancesState.fetchedAt || groupInstancesState.status
        : '';
    const preferencesHydrated = usePreferencesStore((state) => state.preferencesHydrated);
    const ageGatedInstancesVisiblePreference = usePreferencesStore((state) => state.isAgeGatedInstancesVisible);
    const globalShowInstanceIdInLocation = usePreferencesStore((state) => state.showInstanceIdInLocation);
    const ageGatedInstancesVisible = preferencesHydrated && ageGatedInstancesVisiblePreference;
    const cachedInstances = useMemo(() => buildCachedInstanceMap(groupInstances), [groupInstances, groupInstancesRevision]);
    const [localWorldName, setLocalWorldName] = useState('');
    const [previousInstancesOpen, setPreviousInstancesOpen] = useState(false);
    const [previousInstancesRows, setPreviousInstancesRows] = useState([]);
    const [previousInstancesTitle, setPreviousInstancesTitle] = useState('Previous Instances');
    const [previousInstancesLoading, setPreviousInstancesLoading] = useState(false);
    const currentLocation = locationTarget(location, traveling);
    const hasShortNameHint = Boolean(!normalizeString(currentLocation) && normalizeString(hint).length === 8);
    const isTraveling = typeof traveling !== 'undefined' && normalizeString(location) === 'traveling';
    const parsedLocation = useMemo(() => parseLocation(currentLocation), [currentLocation]);
    const worldId = normalizeString(parsedLocation.worldId);
    const region = resolveRegion(parsedLocation);
    const cachedInstance = cachedInstances.get(parsedLocation.tag) || cachedInstances.get(locationCacheKey(parsedLocation.tag));
    const resolvedInstanceName = readInstanceDisplayName(cachedInstance) || parsedLocation.instanceName || '';
    const isClosed = Boolean(cachedInstance && isInstanceClosed(cachedInstance));
    const groupId = normalizeString(parsedLocation.groupId);
    const hintedGroupName = normalizeString(grouphint) || readInstanceGroupName(cachedInstance);
    const worldNameHint = normalizeWorldNameHint(hint, parsedLocation, currentLocation);
    const cachedWorldName = normalizeWorldNameHint(readInstanceWorldName(cachedInstance), parsedLocation, currentLocation);
    const groupProfileQuery = useQuery({
        queryKey: queryKeys.group(groupId, false, currentEndpoint),
        queryFn: () => groupProfileRepository.getGroupProfile({ groupId, endpoint: currentEndpoint, includeRoles: false }),
        enabled: Boolean(groupId),
        staleTime: entityQueryPolicies.group.staleTime,
        gcTime: entityQueryPolicies.group.gcTime,
        retry: entityQueryPolicies.group.retry,
        refetchOnWindowFocus: entityQueryPolicies.group.refetchOnWindowFocus
    });
    const groupName = useMemo(
        () => groupProfileName(groupProfileQuery.data) || hintedGroupName,
        [groupProfileQuery.data, hintedGroupName]
    );
    const worldProfileQuery = useQuery({
        queryKey: queryKeys.world(worldId, currentEndpoint),
        queryFn: () => worldProfileRepository.getWorldProfile({ worldId, endpoint: currentEndpoint }),
        enabled: Boolean(worldId),
        staleTime: entityQueryPolicies.world.staleTime,
        gcTime: entityQueryPolicies.world.gcTime,
        retry: entityQueryPolicies.world.retry,
        refetchOnWindowFocus: entityQueryPolicies.world.refetchOnWindowFocus
    });
    const worldName = normalizeWorldNameHint(worldProfileQuery.data?.name, parsedLocation, currentLocation) ||
        cachedWorldName ||
        worldNameHint ||
        localWorldName;
    const isAgeRestricted = Boolean(parsedLocation.ageGate && !ageGatedInstancesVisible);
    const isLocationLink = Boolean(
        link &&
            !parsedLocation.isPrivate &&
            !parsedLocation.isOffline &&
            (normalizeString(currentLocation) || hasShortNameHint)
    );
    const accessTypeLabel = translateAccessType(parsedLocation.accessTypeName, t, accessTypeLocaleKeyMap);
    const worldDialogTitle = worldName || worldNameHint || undefined;
    const text = getLocationText(parsedLocation, {
        hint: worldNameHint,
        worldName,
        accessTypeLabel,
        t
    });
    const tooltipContent = resolvedInstanceName
        ? `${t('dialog.new_instance.instance_id')}: #${resolvedInstanceName}`
        : '';
    const shouldShowInstanceIdInLocation =
        typeof showInstanceIdInLocation === 'boolean'
            ? showInstanceIdInLocation
            : globalShowInstanceIdInLocation;
    const canOpenWorld = Boolean(
        isLocationLink && (parsedLocation.worldId || hasShortNameHint)
    );
    const canUseCurrentInstance = Boolean(parsedLocation.isRealInstance && parsedLocation.worldId && parsedLocation.instanceId);
    const shareUrl = parsedLocation.worldId
        ? `https://vrchat.com/home/world/${parsedLocation.worldId}`
        : '';
    const showContextMenu = Boolean(enableContextMenu && parsedLocation.isRealInstance && parsedLocation.worldId);

    useEffect(() => {
        let active = true;
        setLocalWorldName('');

        if (!worldId) {
            return () => {
                active = false;
            };
        }

        if (worldNameHint || cachedWorldName) {
            return () => {
                active = false;
            };
        }

        gameLogRepository
            .getWorldNameByWorldId(worldId)
            .then((localWorldName) => {
                const nextLocalName = normalizeWorldNameHint(localWorldName, parsedLocation, currentLocation);
                if (nextLocalName && active) {
                    setLocalWorldName(nextLocalName);
                }
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [cachedWorldName, currentLocation, parsedLocation, worldId, worldNameHint]);

    function showExactPreviousInstanceInfo() {
        const payload = {
            location: currentLocation,
            worldId: parsedLocation.worldId,
            worldName: worldName || worldNameHint,
            groupName
        };
        if (typeof onShowPreviousInstances === 'function') {
            onShowPreviousInstances(payload);
            return;
        }
        if (!currentLocation) {
            return;
        }
        setPreviousInstancesRows([{
            location: currentLocation,
            worldId: parsedLocation.worldId,
            worldName: worldName || worldNameHint || parsedLocation.worldId,
            groupName
        }]);
        setPreviousInstancesTitle(`Previous Instance - ${worldName || worldNameHint || parsedLocation.worldId || currentLocation}`);
        setPreviousInstancesOpen(true);
    }

    function openWorld(event) {
        if (stopPropagation) {
            event?.stopPropagation?.();
        }
        if (!canOpenWorld) {
            return;
        }
        if (isOpenPreviousInstanceInfoDialog) {
            showExactPreviousInstanceInfo();
            return;
        }
        if (hasShortNameHint) {
            void directAccessParse(normalizeString(hint), currentEndpoint);
            return;
        }
        const worldDialogTarget = parsedLocation.isRealInstance && parsedLocation.tag
            ? parsedLocation.tag
            : parsedLocation.worldId;
        openWorldDialog({
            worldId: worldDialogTarget,
            title: worldDialogTitle
        });
    }

    function openGroup(event) {
        event?.stopPropagation?.();
        const groupId = normalizeString(parsedLocation.groupId);
        if (!groupId) {
            return;
        }
        openGroupDialog({ groupId, title: groupName || undefined });
    }

    function copyShareLink() {
        if (!shareUrl) {
            return;
        }
        void copyTextToClipboard(shareUrl);
        toast.success(t('message.world.url_copied'));
    }

    function launchCurrentInstance() {
        if (!canUseCurrentInstance) {
            return;
        }
        showLaunchDialog(currentLocation, parsedLocation.shortName || '');
    }

    async function selfInviteCurrentInstance() {
        if (!canUseCurrentInstance) {
            return;
        }
        try {
            await selfInviteToInstance(currentLocation, parsedLocation.shortName || '', currentEndpoint);
            toast.success('Self invite sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send self invite.');
        }
    }

    function newInstance(selfInvite = false) {
        if (!parsedLocation.worldId) {
            return;
        }
        if (typeof onNewInstance === 'function') {
            onNewInstance({
                location: parsedLocation.tag || parsedLocation.worldId,
                worldId: parsedLocation.worldId,
                worldName: worldName || worldNameHint,
                groupName,
                selfInvite
            });
            return;
        }
        openWorldDialog({
            worldId: parsedLocation.worldId,
            title: worldDialogTitle,
            initialAction: selfInvite ? 'newInstanceSelfInvite' : 'newInstance'
        });
    }

    async function showPreviousInstances() {
        if (!currentLocation && !parsedLocation.worldId) {
            return;
        }
        if (typeof onShowPreviousInstances === 'function') {
            onShowPreviousInstances({
                location: currentLocation,
                worldId: parsedLocation.worldId,
                worldName: worldName || worldNameHint,
                groupName
            });
            return;
        }

        if (!parsedLocation.worldId || previousInstancesLoading) {
            return;
        }

        setPreviousInstancesLoading(true);
        try {
            const instances = await gameLogRepository.getPreviousInstancesByWorldId({
                worldId: parsedLocation.worldId
            });
            const normalizedCurrentLocation = normalizeString(currentLocation);
            const currentInstanceRow = {
                location: normalizedCurrentLocation,
                worldId: parsedLocation.worldId,
                worldName: worldName || worldNameHint || parsedLocation.worldId
            };
            const nextRows = [
                ...(normalizedCurrentLocation ? [currentInstanceRow] : []),
                ...instances
            ].sort((left, right) => {
                if (normalizedCurrentLocation) {
                    if (normalizeString(left?.location) === normalizedCurrentLocation) {
                        return -1;
                    }
                    if (normalizeString(right?.location) === normalizedCurrentLocation) {
                        return 1;
                    }
                }
                return Date.parse(right?.created_at || right?.createdAt || 0) -
                    Date.parse(left?.created_at || left?.createdAt || 0);
            });

            setPreviousInstancesRows(nextRows);
            setPreviousInstancesTitle(`Previous Instances - ${worldName || worldNameHint || parsedLocation.worldId}`);
            setPreviousInstancesOpen(true);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to load previous instances.');
        } finally {
            setPreviousInstancesLoading(false);
        }
    }

    function openWorldFromKeyboard(event) {
        if (asButton || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }
        event.preventDefault();
        openWorld(event);
    }

    const LocationTrigger = asButton ? 'button' : 'span';

    const content = (
        <div className={cn('inline-flex min-w-0 max-w-full items-center', className)}>
            {!text ? (
                <div className="text-transparent">-</div>
            ) : isAgeRestricted ? (
                <LocationTooltip
                    disabled={disableTooltip}
                    content={t('dialog.user.info.instance_age_restricted_tooltip')}>
                    <div className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                        <LockIcon className="size-3.5 shrink-0" />
                        <span className="min-w-0 truncate">{t('dialog.user.info.instance_age_restricted')}</span>
                    </div>
                </LocationTooltip>
            ) : (
                <>
                    {region ? <span className={cn('flags mr-1.5 shrink-0', region)} /> : null}
                    <LocationTooltip
                        disabled={disableTooltip || !tooltipContent || shouldShowInstanceIdInLocation}
                        content={tooltipContent}>
                        <LocationTrigger
                            {...(asButton
                                ? { type: 'button' }
                                : {
                                    role: isLocationLink ? 'button' : undefined,
                                    tabIndex: isLocationLink ? 0 : undefined
                                })}
                            className={cn(
                                'x-location inline-flex min-w-0 max-w-full flex-nowrap items-center overflow-hidden truncate text-left',
                                isLocationLink ? 'cursor-pointer hover:underline' : 'cursor-default'
                            )}
                            onClick={openWorld}
                            onKeyDown={openWorldFromKeyboard}>
                            {isTraveling ? <Loader2Icon className="mr-1 size-3.5 shrink-0 animate-spin" /> : null}
                            <span className="min-w-0 flex-1 truncate">
                                <span>{text}</span>
                                {shouldShowInstanceIdInLocation && resolvedInstanceName ? (
                                    <span className="ml-1">{`· #${resolvedInstanceName}`}</span>
                                ) : null}
                            </span>
                        </LocationTrigger>
                    </LocationTooltip>
                    {groupName ? (
                        <span
                            className="ml-0.5 cursor-pointer truncate hover:underline"
                            role="button"
                            tabIndex={0}
                            onClick={openGroup}
                            onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    openGroup(event);
                                }
                            }}>
                            ({groupName})
                        </span>
                    ) : null}
                    {isClosed ? (
                        <LocationTooltip
                            disabled={disableTooltip}
                            content={t('dialog.user.info.instance_closed')}>
                            <AlertTriangleIcon className="ml-2 inline-block size-3.5 shrink-0 text-muted-foreground" />
                        </LocationTooltip>
                    ) : null}
                    {parsedLocation.strict ? (
                        <LockIcon className="ml-2 inline-block size-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                </>
            )}
        </div>
    );
    const previousInstancesDialog = previousInstancesOpen ? (
        <PreviousInstancesTableDialog
            open={previousInstancesOpen}
            onOpenChange={setPreviousInstancesOpen}
            title={previousInstancesTitle}
            instances={previousInstancesRows}
            variant="world"
            onRowsChange={setPreviousInstancesRows}
            autoOpenInfo
        />
    ) : null;

    if (!showContextMenu) {
        return (
            <>
                {content}
                {previousInstancesDialog}
            </>
        );
    }

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <span className="inline-flex min-w-0 max-w-full">{content}</span>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-56">
                    <ContextMenuItem disabled={!canOpenWorld} onSelect={openWorld}>
                        <ExternalLinkIcon className="size-4" />
                        {t('common.actions.view_details')}
                    </ContextMenuItem>
                    <ContextMenuItem disabled={!shareUrl} onSelect={copyShareLink}>
                        <Share2Icon className="size-4" />
                        {t('dialog.world.actions.share')}
                    </ContextMenuItem>
                    <ContextMenuItem disabled={!currentLocation} onSelect={() => void copyTextToClipboard(currentLocation)}>
                        <CopyIcon className="size-4" />
                        Copy location
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem disabled={!parsedLocation.worldId} onSelect={() => newInstance(false)}>
                        <FlagIcon className="size-4" />
                        {t('dialog.world.actions.new_instance')}
                    </ContextMenuItem>
                    <ContextMenuItem disabled={!parsedLocation.worldId} onSelect={() => newInstance(true)}>
                        <MessageSquareIcon className="size-4" />
                        {t('dialog.world.actions.new_instance_and_self_invite')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                        disabled={previousInstancesDisabled || previousInstancesLoading || (!parsedLocation.worldId && !isOpenPreviousInstanceInfoDialog)}
                        onSelect={() => {
                            if (isOpenPreviousInstanceInfoDialog) {
                                showExactPreviousInstanceInfo();
                                return;
                            }
                            void showPreviousInstances();
                        }}>
                        <HistoryIcon className="size-4" />
                        {t('dialog.world.actions.show_previous_instances')}
                    </ContextMenuItem>
                    {showLaunchActions ? (
                        <>
                            <ContextMenuSeparator />
                            <ContextMenuItem disabled={!canUseCurrentInstance} onSelect={launchCurrentInstance}>
                                <ExternalLinkIcon className="size-4" />
                                Launch in VRChat
                            </ContextMenuItem>
                            <ContextMenuItem disabled={!canUseCurrentInstance} onSelect={() => void selfInviteCurrentInstance()}>
                                <MessageSquareIcon className="size-4" />
                                Self invite
                            </ContextMenuItem>
                        </>
                    ) : null}
                </ContextMenuContent>
            </ContextMenu>
            {previousInstancesDialog}
        </>
    );
}
