import { toast } from 'sonner';

import { LocationContextMenu } from '@/components/location/LocationContextMenu';
import { LocationDisplay } from '@/components/location/LocationDisplay';
import { useLocationPreviousInstancesDialog } from '@/components/location/useLocationPreviousInstancesDialog';
import { useResolvedLocation } from '@/components/location/useResolvedLocation';
import { openGroupDialog, openWorldDialog } from '@/services/dialogService';
import { directAccessParse } from '@/services/directAccessService';
import { copyTextToClipboard } from '@/services/entityMediaService';
import { selfInviteToInstance } from '@/services/launchService';
import { vrchatWorldUrl } from '@/shared/constants/vrchatWebUrls';
import { normalizeString } from '@/shared/utils/string';
import { useLaunchStore } from '@/state/launchStore';
import { useRuntimeStore } from '@/state/runtimeStore';

export function Location({
    location = '',
    traveling,
    hint = '',
    grouphint = '',
    groupHint = '',
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
    className = '',
    worldNameClassName = ''
}: any) {
    const showLaunchDialog = useLaunchStore((state) => state.showLaunchDialog);
    const isGameRunning = useRuntimeStore((state) =>
        Boolean(state.gameState.isGameRunning)
    );
    const {
        t,
        currentLocation,
        currentEndpoint,
        parsedLocation,
        region,
        instanceName: resolvedInstanceName,
        isClosed,
        groupName,
        worldName,
        worldNameHint,
        isTraveling,
        hasShortNameHint,
        isAgeRestricted,
        isLocationLink,
        text,
        tooltipContent,
        shouldShowInstanceId: shouldShowInstanceIdInLocation
    } = useResolvedLocation({
        location,
        traveling,
        hint,
        grouphint,
        groupHint,
        endpoint,
        link,
        showInstanceIdInLocation
    });
    const worldDialogTitle = worldName || worldNameHint || undefined;
    const canOpenWorld = Boolean(
        isLocationLink && (parsedLocation.worldId || hasShortNameHint)
    );
    const canUseCurrentInstance = Boolean(
        parsedLocation.isRealInstance &&
        parsedLocation.worldId &&
        parsedLocation.instanceId
    );
    const shareUrl = parsedLocation.worldId
        ? vrchatWorldUrl(parsedLocation.worldId)
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

    function openWorld(event: any) {
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
            directAccessParse(normalizeString(hint), currentEndpoint);
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

    function openGroup(event: any) {
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
        copyTextToClipboard(shareUrl);
        toast.success(t('message.world.url_copied'));
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
            toast.success(t('message.invite.self_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.location.toast.failed_to_send_self_invite')
            );
        }
    }

    function newInstance(selfInvite: any = false) {
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
            initialAction: selfInvite ? 'newInstanceSelfInvite' : 'newInstance',
            initialNewInstanceDefaults: {
                groupId: parsedLocation.groupId || '',
                groupAccessType: parsedLocation.groupAccessType || '',
                groupName,
                region: parsedLocation.region || ''
            }
        });
    }

    function openWorldFromKeyboard(event: any) {
        if (asButton || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }
        event.preventDefault();
        openWorld(event);
    }

    const content = (
        <LocationDisplay
            asButton={asButton}
            className={className}
            disableTooltip={disableTooltip}
            groupName={groupName}
            instanceName={resolvedInstanceName}
            isAgeRestricted={isAgeRestricted}
            isClosed={isClosed}
            isLocationLink={isLocationLink}
            isTraveling={isTraveling}
            onOpenGroup={openGroup}
            onOpenLocation={openWorld}
            onOpenLocationKeyDown={openWorldFromKeyboard}
            region={region}
            shouldShowInstanceId={shouldShowInstanceIdInLocation}
            showGroupLink={showGroupLink}
            strict={parsedLocation.strict}
            text={text}
            tooltipContent={tooltipContent}
            worldName={worldNameHint || worldName}
            worldNameClassName={worldNameClassName}
        />
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
            canOpenInstanceInGame={isGameRunning}
            canUseCurrentInstance={canUseCurrentInstance}
            isOpenPreviousInstanceInfoDialog={isOpenPreviousInstanceInfoDialog}
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
