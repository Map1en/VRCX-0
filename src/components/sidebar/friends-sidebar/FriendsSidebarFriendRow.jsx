import { UserIcon } from 'lucide-react';

import { getNameColour, userImage } from '@/lib/entityMedia.js';
import { TRUST_COLOR_DEFAULTS } from '@/lib/trustColors.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';

import {
    readFriendRef,
    resolveSidebarStatusDotClassName,
    resolveTrustNameColour
} from './friendsSidebarModel.js';
import {
    CurrentUserActionItems,
    FriendActionItems
} from './FriendsSidebarActionItems.jsx';
import {
    FriendInstanceTimer,
    resolveFriendRowLocationState,
    StaticSidebarLocation
} from './FriendsSidebarLocation.jsx';

export function FriendRow({
    friend,
    isCurrentUser,
    isGroupByInstance = false,
    statusPresets = [],
    canSendInvite,
    canRequestInvite,
    canBoop,
    canUseFriendInstance,
    actions,
    t,
    randomUserColours = false,
    isDarkMode = false,
    timeUnitLabels,
    trustColor = TRUST_COLOR_DEFAULTS,
    currentUserSnapshot = null,
    recentActionVersion = 0,
    locationMetadata = null,
    showInstanceIdInLocation = false,
    ageGatedInstancesVisible = false
}) {
    const displaySource = readFriendRef(friend);
    const imageUrl = userImage(displaySource, true, '64');
    const displayName =
        displaySource?.displayName ||
        displaySource?.username ||
        friend?.displayName ||
        friend?.username ||
        friend?.id ||
        'Unknown';
    const nameStyle =
        randomUserColours && friend?.id
            ? { color: getNameColour(friend.id, isDarkMode) }
            : {
                  color:
                      displaySource?.$userColour ||
                      resolveTrustNameColour(displaySource, trustColor)
              };
    const statusDotClassName = resolveSidebarStatusDotClassName(
        friend,
        currentUserSnapshot,
        isCurrentUser
    );
    const {
        statusSource,
        friendLocation,
        parsedFriendLocation,
        isTraveling,
        displayLocation,
        displayTraveling,
        groupByInstanceTimerVisible,
        groupByInstanceEpoch,
        showLocationSubline,
        metadataHint
    } = resolveFriendRowLocationState({
        friend,
        isCurrentUser,
        isGroupByInstance
    });
    const canUseFriendLocation = Boolean(
        canUseFriendInstance &&
            parsedFriendLocation.isRealInstance &&
            parsedFriendLocation.worldId &&
            parsedFriendLocation.instanceId
    );
    const subline = statusSource?.pendingOffline
        ? t('side_panel.pending_offline')
        : displaySource?.statusDescription || '';

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div className="hover:bg-muted/50 flex w-full items-center rounded-lg">
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-auto min-w-0 flex-1 justify-start gap-2 p-1.5 text-left font-normal"
                        onClick={actions.open}
                    >
                        <span className="relative flex size-9 shrink-0 items-center justify-center overflow-visible">
                            <span className="bg-muted relative z-0 flex size-full items-center justify-center overflow-hidden rounded-full border">
                                {imageUrl ? (
                                    <img
                                        src={imageUrl}
                                        alt=""
                                        className="size-full object-cover"
                                    />
                                ) : (
                                    <UserIcon
                                        data-icon="inline-start"
                                        className="text-muted-foreground"
                                    />
                                )}
                            </span>
                            {statusDotClassName ? (
                                <span
                                    className={cn(
                                        'border-background absolute -right-0.5 -bottom-0.5 z-10 size-3.75 rounded-full border-3',
                                        statusDotClassName
                                    )}
                                />
                            ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span
                                className="block truncate leading-5 font-medium"
                                style={nameStyle}
                            >
                                {displayName}
                            </span>
                            <span className="text-muted-foreground block truncate text-xs">
                                {groupByInstanceTimerVisible ? (
                                    <FriendInstanceTimer
                                        epoch={groupByInstanceEpoch}
                                        traveling={isTraveling}
                                        timeUnitLabels={timeUnitLabels}
                                    />
                                ) : showLocationSubline ? (
                                    <StaticSidebarLocation
                                        location={displayLocation}
                                        traveling={displayTraveling}
                                        hint={metadataHint}
                                        link
                                        metadata={locationMetadata}
                                        t={t}
                                        showInstanceIdInLocation={
                                            showInstanceIdInLocation
                                        }
                                        ageGatedInstancesVisible={
                                            ageGatedInstancesVisible
                                        }
                                    />
                                ) : (
                                    subline
                                )}
                            </span>
                        </span>
                    </Button>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                {isCurrentUser ? (
                    <CurrentUserActionItems
                        friend={friend}
                        actions={actions}
                        t={t}
                        MenuItem={ContextMenuItem}
                        CheckboxItem={ContextMenuCheckboxItem}
                        Group={ContextMenuGroup}
                        Separator={ContextMenuSeparator}
                        Sub={ContextMenuSub}
                        SubTrigger={ContextMenuSubTrigger}
                        SubContent={ContextMenuSubContent}
                        statusPresets={statusPresets}
                    />
                ) : (
                    <FriendActionItems
                        friend={friend}
                        friendLocation={friendLocation}
                        canUseFriendLocation={canUseFriendLocation}
                        canSendInvite={canSendInvite}
                        canRequestInvite={canRequestInvite}
                        canBoop={canBoop}
                        actions={actions}
                        t={t}
                        MenuItem={ContextMenuItem}
                        Group={ContextMenuGroup}
                        Separator={ContextMenuSeparator}
                        recentActionVersion={recentActionVersion}
                    />
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}
