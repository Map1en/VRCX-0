import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import {
    FriendInstanceTimer,
    FriendLocationTimer
} from '@/components/friends/FriendInstanceTimer';
import { usePendingOfflineBlink } from '@/components/friends/usePendingOfflineBlink';
import { useRecentlyOnline } from '@/components/friends/useRecentlyOnline';
import type { LocationMetadata } from '@/components/location/useLocationMetadata';
import {
    ProfileAvatarFrame,
    ProfileNameplate,
    useDecorationHover
} from '@/components/ProfileDecorations';
import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { UserDetailContent } from '@/components/UserDetailTile';
import type { InstanceRosterTimestamp } from '@/domain/instances/instanceRoster';
import type { UserStatus } from '@/platform/tauri/bindings';
import { getNameColour, userImage } from '@/services/entityMediaService';
import { TRUST_COLOR_DEFAULTS } from '@/shared/constants/trustColors';
import type { UserNameColourStyle } from '@/shared/utils/entityMedia';
import { type TrustColorMap } from '@/shared/utils/trustColors';
import type { FriendLocationTimeEntry } from '@/state/friendLocationTimeStore';
import { useShellStore } from '@/state/shellStore';
import { buttonVariants } from '@/ui/shadcn/button';
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

import { AccountSwitcherPopover } from './AccountSwitcherPopover';
import {
    CurrentUserActionItems,
    FriendActionItems,
    type StatusPreset
} from './FriendsSidebarActionItems';
import {
    resolveFriendRowLocationState,
    StaticSidebarLocation
} from './FriendsSidebarLocation';
import {
    resolveSidebarStatusDotClassName,
    resolveTrustNameColour,
    type SidebarFriendRecord
} from './friendsSidebarModel';
import { useSidebarMenuDoubleClick } from './useSidebarMenuDoubleClick';

export function resolveFriendRowDisplay(
    friend: SidebarFriendRecord | null | undefined,
    {
        randomUserColours = false,
        randomUserColourStyle = 'classic',
        isDarkMode = false,
        trustColor = TRUST_COLOR_DEFAULTS
    }: {
        randomUserColours?: boolean;
        randomUserColourStyle?: UserNameColourStyle;
        isDarkMode?: boolean;
        trustColor?: TrustColorMap;
    }
) {
    const displaySource = friend;
    const nameStyle: CSSProperties =
        randomUserColours && friend?.id
            ? {
                  color: getNameColour(
                      friend.id,
                      isDarkMode,
                      randomUserColourStyle
                  )
              }
            : {
                  color:
                      displaySource?.$userColour ||
                      resolveTrustNameColour(displaySource, trustColor)
              };
    return {
        displaySource,
        imageUrl: userImage(displaySource, 64),
        displayName:
            displaySource?.displayName ||
            displaySource?.username ||
            friend?.displayName ||
            friend?.username ||
            friend?.id ||
            'Unknown',
        nameStyle
    };
}

type FriendRowModel = {
    isCurrentUser?: boolean;
    isGroupByInstance?: boolean;
    instanceLocation?: string;
    locationTime?: FriendLocationTimeEntry | null;
    canSendInvite?: boolean;
    canRequestInvite?: boolean;
    canBoop?: boolean;
    canUseFriendInstance?: boolean;
};

type FriendRowCommands = {
    onOpen?: () => void;
    onSelfInvite?: (location: string) => void;
    onInvite?: (friend: SidebarFriendRecord) => void;
    onRequestInvite?: (friend: SidebarFriendRecord) => void;
    onBoop?: (friend: SidebarFriendRecord) => void;
    onChangeStatus?: (status: UserStatus) => void;
    onSetStatusDescription?: (statusDescription: string) => void;
    onEditSocialStatus?: () => void;
    onApplyStatusPreset?: (preset: StatusPreset) => void;
    statusPresets?: StatusPreset[];
};

type FriendRowAppearance = {
    randomUserColours?: boolean;
    randomUserColourStyle?: UserNameColourStyle;
    isDarkMode?: boolean;
    trustColor?: TrustColorMap;
    recentActionVersion?: number;
    locationMetadata?: LocationMetadata | null;
    showInstanceIdInLocation?: boolean;
    ageGatedInstancesVisible?: boolean;
    currentLocationStartedAt?: InstanceRosterTimestamp | null;
    showAvatarFrame?: boolean;
    showNameplate?: boolean;
};

type FriendRowProps = {
    friend: SidebarFriendRecord;
    rowModel?: FriendRowModel;
    rowCommands?: FriendRowCommands;
    appearance?: FriendRowAppearance;
};

export function FriendRow({
    friend,
    rowModel,
    rowCommands,
    appearance
}: FriendRowProps) {
    const { t } = useTranslation();
    const sidebarWindowMode = useShellStore(
        (state) => state.windowDisplayMode === 'sidebar'
    );
    const {
        isCurrentUser,
        isGroupByInstance = false,
        instanceLocation,
        locationTime,
        canSendInvite,
        canRequestInvite,
        canBoop,
        canUseFriendInstance
    } = rowModel || {};
    const {
        onOpen,
        onSelfInvite,
        onInvite,
        onRequestInvite,
        onBoop,
        onChangeStatus,
        onSetStatusDescription,
        onEditSocialStatus,
        onApplyStatusPreset,
        statusPresets = []
    } = rowCommands || {};
    const {
        randomUserColours = false,
        randomUserColourStyle = 'classic',
        isDarkMode = false,
        trustColor = TRUST_COLOR_DEFAULTS,
        recentActionVersion = 0,
        locationMetadata = null,
        showInstanceIdInLocation = false,
        ageGatedInstancesVisible = false,
        currentLocationStartedAt = null,
        showAvatarFrame = false,
        showNameplate = false
    } = appearance || {};
    const decorationHover = useDecorationHover();
    const recentlyOnline = useRecentlyOnline(friend.id || '');
    const decorationActive = decorationHover.active || recentlyOnline;
    const iconFrameId = showAvatarFrame ? friend.iconFrame?.trim() : '';
    const nameplateId = showNameplate ? friend.nameplateEffect?.trim() : '';
    const { displaySource, imageUrl, displayName, nameStyle } =
        resolveFriendRowDisplay(friend, {
            randomUserColours,
            randomUserColourStyle,
            isDarkMode,
            trustColor
        });
    const statusDotClassName = resolveSidebarStatusDotClassName(friend, {
        hideNonFriend: !isCurrentUser
    });
    const {
        isPendingOffline,
        friendLocation,
        parsedFriendLocation,
        isTraveling,
        displayLocation,
        displayTraveling,
        groupByInstanceTimerVisible,
        showLocationSubline,
        metadataHint
    } = resolveFriendRowLocationState({
        friend,
        isCurrentUser,
        isGroupByInstance,
        locationTime
    });
    const timerLocation = isTraveling
        ? displayTraveling || ''
        : instanceLocation || friendLocation;
    const canUseFriendLocation = Boolean(
        canUseFriendInstance &&
        parsedFriendLocation.isRealInstance &&
        parsedFriendLocation.worldId &&
        parsedFriendLocation.instanceId
    );
    const podButtonRef =
        usePendingOfflineBlink<HTMLButtonElement>(isPendingOffline);
    const subline = isPendingOffline
        ? t('side_panel.pending_offline')
        : String(displaySource?.statusDescription || '');

    const podButton = (
        <button
            ref={podButtonRef}
            type="button"
            data-slot="button"
            data-variant="ghost"
            data-size="default"
            className={buttonVariants({
                variant: 'ghost',
                className:
                    'relative isolate h-auto w-full min-w-0 justify-start gap-2 p-1.5 text-left font-normal'
            })}
            data-pending-offline={isPendingOffline || undefined}
            onClick={sidebarWindowMode ? undefined : onOpen}
            {...decorationHover.hoverProps}
        >
            {nameplateId ? (
                <ProfileNameplate
                    templateId={nameplateId}
                    active={decorationActive}
                />
            ) : null}
            <UserDetailContent
                imageUrl={imageUrl}
                statusDotClassName={statusDotClassName}
                avatarClassName="size-10"
                avatarFrame={
                    iconFrameId ? (
                        <ProfileAvatarFrame
                            templateId={iconFrameId}
                            active={
                                decorationActive ||
                                (showLocationSubline && isTraveling)
                            }
                        />
                    ) : null
                }
                displayName={displayName}
                nameStyle={nameStyle}
                subline={
                    groupByInstanceTimerVisible ? (
                        isCurrentUser ? (
                            <FriendInstanceTimer
                                epoch={currentLocationStartedAt}
                                traveling={isTraveling}
                                className="text-muted-foreground"
                            />
                        ) : (
                            <FriendLocationTimer
                                userId={friend.id || ''}
                                location={timerLocation}
                                traveling={isTraveling}
                                className="text-muted-foreground"
                            />
                        )
                    ) : showLocationSubline ? (
                        <StaticSidebarLocation
                            location={displayLocation}
                            traveling={displayTraveling}
                            hint={metadataHint}
                            metadata={locationMetadata}
                            tooltips={false}
                            showInstanceIdInLocation={showInstanceIdInLocation}
                            ageGatedInstancesVisible={ageGatedInstancesVisible}
                        />
                    ) : (
                        subline
                    )
                }
            />
        </button>
    );

    const menuItems = isCurrentUser ? (
        <CurrentUserActionItems
            friend={friend}
            onOpen={onOpen}
            onChangeStatus={onChangeStatus}
            onSetStatusDescription={onSetStatusDescription}
            onEditSocialStatus={onEditSocialStatus}
            onApplyStatusPreset={onApplyStatusPreset}
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
            onOpen={onOpen}
            onSelfInvite={onSelfInvite}
            onInvite={onInvite}
            onRequestInvite={onRequestInvite}
            onBoop={onBoop}
            MenuItem={ContextMenuItem}
            Group={ContextMenuGroup}
            Separator={ContextMenuSeparator}
            recentActionVersion={recentActionVersion}
        />
    );
    const doubleClick = useSidebarMenuDoubleClick(() => onOpen?.());
    const rowButton = sidebarWindowMode ? (
        <DropdownMenu {...doubleClick.menuProps}>
            <DropdownMenuTrigger
                render={podButton}
                {...doubleClick.triggerProps}
            />
            <DropdownMenuContent className="w-max max-w-[calc(100vw-1rem)] min-w-56">
                {menuItems}
            </DropdownMenuContent>
        </DropdownMenu>
    ) : (
        podButton
    );

    return (
        <ContextMenu>
            {isCurrentUser ? (
                <ContextMenuTrigger
                    render={
                        <div className="group flex w-full min-w-0 items-center gap-0.5">
                            <div className="min-w-0 flex-1">{rowButton}</div>
                            <AccountSwitcherPopover />
                        </div>
                    }
                />
            ) : (
                <UserHoverCard
                    userId={friend?.id}
                    seed={friend}
                    disabled={isCurrentUser}
                >
                    <ContextMenuTrigger
                        render={
                            sidebarWindowMode ? (
                                <div>{rowButton}</div>
                            ) : (
                                podButton
                            )
                        }
                    />
                </UserHoverCard>
            )}
            <ContextMenuContent className="w-max max-w-[calc(100vw-1rem)] min-w-56">
                {menuItems}
            </ContextMenuContent>
        </ContextMenu>
    );
}
