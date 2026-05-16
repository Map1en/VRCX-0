// @ts-nocheck
import { UserIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getNameColour, userImage } from '@/lib/entityMedia.js';
import { TRUST_COLOR_DEFAULTS } from '@/lib/trustColors.js';
import { cn } from '@/lib/utils.js';
import { buttonVariants } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';

import {
    CurrentUserActionItems,
    FriendActionItems
} from './FriendsSidebarActionItems';
import {
    FriendInstanceTimer,
    resolveFriendRowLocationState,
    StaticSidebarLocation
} from './FriendsSidebarLocation';
import {
    readFriendRef,
    resolveSidebarStatusDotClassName,
    resolveTrustNameColour
} from './friendsSidebarModel.js';

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
    randomUserColours = false,
    isDarkMode = false,
    trustColor = TRUST_COLOR_DEFAULTS,
    currentUserSnapshot = null,
    isGameRunning = undefined,
    recentActionVersion = 0,
    locationMetadata = null,
    showInstanceIdInLocation = false,
    ageGatedInstancesVisible = false
}) {
    const { t } = useTranslation();
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
        isCurrentUser,
        { isGameRunning }
    );
    const isActiveStatusDot = statusDotClassName.includes('bg-background');
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
                <button
                    type="button"
                    data-slot="button"
                    data-variant="ghost"
                    data-size="default"
                    className={buttonVariants({
                        variant: 'ghost',
                        className:
                            'h-auto w-full min-w-0 justify-start gap-2 p-1.5 text-left font-normal'
                    })}
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
                            isActiveStatusDot ? (
                                <span className="border-background bg-background absolute -right-0.5 -bottom-0.5 z-10 size-3.75 rounded-full border-3">
                                    <span
                                        className={cn(
                                            'absolute inset-0 rounded-full border-2',
                                            statusDotClassName
                                        )}
                                    />
                                </span>
                            ) : (
                                <span
                                    className={cn(
                                        'border-background absolute -right-0.5 -bottom-0.5 z-10 size-3.75 rounded-full border-3',
                                        statusDotClassName
                                    )}
                                />
                            )
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
                                />
                            ) : showLocationSubline ? (
                                <StaticSidebarLocation
                                    location={displayLocation}
                                    traveling={displayTraveling}
                                    hint={metadataHint}
                                    metadata={locationMetadata}
                                    tooltips={false}
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
                </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                {isCurrentUser ? (
                    <CurrentUserActionItems
                        friend={friend}
                        actions={actions}
                        MenuItem={ContextMenuItem}
                        CheckboxItem={ContextMenuCheckboxItem}
                        Group={ContextMenuGroup}
                        Separator={ContextMenuSeparator}
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
