import { AlertTriangleIcon, LockIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { LocationContextMenu } from '@/components/location/LocationContextMenu.jsx';
import { RegionCodeBadge } from '@/components/location/RegionCodeBadge.jsx';
import {
    normalizeString,
    useLocationMetadata
} from '@/components/location/useLocationMetadata.js';
import { useLocationPreviousInstancesDialog } from '@/components/location/useLocationPreviousInstancesDialog.jsx';
import { copyTextToClipboard } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import { openGroupDialog, openWorldDialog } from '@/services/dialogService.js';
import { directAccessParse } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType.js';
import {
    getLocationText,
    normalizeLocationValue,
    parseLocation,
    translateAccessType
} from '@/shared/utils/location.js';
import { useLaunchStore } from '@/state/launchStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

function locationTarget(location, traveling) {
    const normalizedLocation = normalizeLocationValue(location);
    if (
        typeof traveling !== 'undefined' &&
        normalizedLocation === 'traveling'
    ) {
        return normalizeLocationValue(traveling);
    }
    return normalizedLocation;
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
    showGroupLink = true,
    className = ''
}) {
    const { t } = useTranslation();
    const showLaunchDialog = useLaunchStore((state) => state.showLaunchDialog);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const ageGatedInstancesVisiblePreference = usePreferencesStore(
        (state) => state.isAgeGatedInstancesVisible
    );
    const globalShowInstanceIdInLocation = usePreferencesStore(
        (state) => state.showInstanceIdInLocation
    );
    const ageGatedInstancesVisible =
        preferencesHydrated && ageGatedInstancesVisiblePreference;
    const currentLocation = locationTarget(location, traveling);
    const hasShortNameHint = Boolean(
        !normalizeString(currentLocation) && normalizeString(hint).length === 8
    );
    const isTraveling =
        typeof traveling !== 'undefined' &&
        normalizeString(location) === 'traveling';
    const parsedLocation = useMemo(
        () => parseLocation(currentLocation),
        [currentLocation]
    );
    const {
        currentEndpoint,
        region,
        instanceName: resolvedInstanceName,
        isClosed,
        groupName,
        worldName,
        worldNameHint
    } = useLocationMetadata({
        locationInfo: parsedLocation,
        currentLocation,
        endpoint,
        hint,
        groupHint: grouphint
    });
    const isAgeRestricted = Boolean(
        parsedLocation.ageGate && !ageGatedInstancesVisible
    );
    const isLocationLink = Boolean(
        link &&
        !parsedLocation.isPrivate &&
        !parsedLocation.isOffline &&
        (normalizeString(currentLocation) || hasShortNameHint)
    );
    const accessTypeLabel = translateAccessType(
        parsedLocation.accessTypeName,
        t,
        accessTypeLocaleKeyMap
    );
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
    const canUseCurrentInstance = Boolean(
        parsedLocation.isRealInstance &&
        parsedLocation.worldId &&
        parsedLocation.instanceId
    );
    const shareUrl = parsedLocation.worldId
        ? `https://vrchat.com/home/world/${parsedLocation.worldId}`
        : '';
    const showContextMenu = Boolean(
        enableContextMenu &&
        parsedLocation.isRealInstance &&
        parsedLocation.worldId
    );
    const {
        previousInstancesDialog,
        previousInstancesLoading,
        showExactPreviousInstanceInfo,
        showPreviousInstances
    } = useLocationPreviousInstancesDialog({
        currentLocation,
        groupName,
        onShowPreviousInstances,
        parsedLocation,
        t,
        worldName,
        worldNameHint
    });

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
        const worldDialogTarget =
            parsedLocation.isRealInstance && parsedLocation.tag
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

    function copyCurrentLocation() {
        void copyTextToClipboard(currentLocation);
    }

    function launchCurrentInstance() {
        if (!canUseCurrentInstance) {
            return;
        }
        showLaunchDialog(currentLocation, parsedLocation.shortName || '', '', {
            worldName: worldName || worldNameHint
        });
    }

    async function selfInviteCurrentInstance() {
        if (!canUseCurrentInstance) {
            return;
        }
        try {
            await selfInviteToInstance(
                currentLocation,
                parsedLocation.shortName || '',
                currentEndpoint
            );
            toast.success(t('common.generated.generated.self_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.location.generated_toast.failed_to_send_self_invite'
                      )
            );
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

    function openWorldFromKeyboard(event) {
        if (asButton || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }
        event.preventDefault();
        openWorld(event);
    }

    const LocationTrigger = asButton ? 'button' : 'span';

    const content = (
        <div
            className={cn(
                'inline-flex max-w-full min-w-0 items-center',
                className
            )}
        >
            {!text ? (
                <div className="text-transparent">-</div>
            ) : isAgeRestricted ? (
                <LocationTooltip
                    disabled={disableTooltip}
                    content={t(
                        'dialog.user.info.instance_age_restricted_tooltip'
                    )}
                >
                    <div className="text-muted-foreground inline-flex min-w-0 items-center gap-1">
                        <LockIcon className="size-3.5 shrink-0" />
                        <span className="min-w-0 truncate">
                            {t('dialog.user.info.instance_age_restricted')}
                        </span>
                    </div>
                </LocationTooltip>
            ) : (
                <>
                    <RegionCodeBadge region={region} />
                    <LocationTooltip
                        disabled={
                            disableTooltip ||
                            !tooltipContent ||
                            shouldShowInstanceIdInLocation
                        }
                        content={tooltipContent}
                    >
                        <LocationTrigger
                            {...(asButton
                                ? { type: 'button' }
                                : {
                                      role: isLocationLink
                                          ? 'button'
                                          : undefined,
                                      tabIndex: isLocationLink ? 0 : undefined
                                  })}
                            className={cn(
                                'x-location inline-flex max-w-full min-w-0 flex-nowrap items-center truncate overflow-hidden text-left',
                                isLocationLink
                                    ? 'hover:text-primary cursor-pointer text-inherit underline-offset-4'
                                    : 'cursor-default'
                            )}
                            onClick={openWorld}
                            onKeyDown={openWorldFromKeyboard}
                        >
                            {isTraveling ? (
                                <Spinner
                                    aria-hidden="true"
                                    aria-label={undefined}
                                    role="presentation"
                                    className="mr-1 size-3.5 shrink-0"
                                />
                            ) : null}
                            <span className="min-w-0 flex-1 truncate">
                                <span>{text}</span>
                                {shouldShowInstanceIdInLocation &&
                                resolvedInstanceName ? (
                                    <span className="ml-1">{`· #${resolvedInstanceName}`}</span>
                                ) : null}
                            </span>
                        </LocationTrigger>
                    </LocationTooltip>
                    {showGroupLink && groupName ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="hover:text-primary ml-0.5 h-auto min-w-0 p-0 text-left font-normal text-inherit"
                            onClick={openGroup}
                            onKeyDown={(event) => event.stopPropagation()}
                        >
                            ({groupName})
                        </Button>
                    ) : null}
                    {isClosed ? (
                        <LocationTooltip
                            disabled={disableTooltip}
                            content={t('dialog.user.info.instance_closed')}
                        >
                            <AlertTriangleIcon className="text-muted-foreground ml-2 inline-block size-3.5 shrink-0" />
                        </LocationTooltip>
                    ) : null}
                    {parsedLocation.strict ? (
                        <LockIcon className="text-muted-foreground ml-2 inline-block size-3.5 shrink-0" />
                    ) : null}
                </>
            )}
        </div>
    );
    if (!showContextMenu) {
        return (
            <>
                {content}
                {previousInstancesDialog}
            </>
        );
    }

    return (
        <LocationContextMenu
            canOpenWorld={canOpenWorld}
            canUseCurrentInstance={canUseCurrentInstance}
            currentLocation={currentLocation}
            isOpenPreviousInstanceInfoDialog={isOpenPreviousInstanceInfoDialog}
            onCopyCurrentLocation={copyCurrentLocation}
            onCopyShareLink={copyShareLink}
            onLaunchCurrentInstance={launchCurrentInstance}
            onNewInstance={newInstance}
            onOpenWorld={openWorld}
            onSelfInviteCurrentInstance={selfInviteCurrentInstance}
            onShowExactPreviousInstanceInfo={showExactPreviousInstanceInfo}
            onShowPreviousInstances={showPreviousInstances}
            previousInstancesDialog={previousInstancesDialog}
            previousInstancesDisabled={previousInstancesDisabled}
            previousInstancesLoading={previousInstancesLoading}
            shareUrl={shareUrl}
            showLaunchActions={showLaunchActions}
            worldId={parsedLocation.worldId}
        >
            {content}
        </LocationContextMenu>
    );
}
