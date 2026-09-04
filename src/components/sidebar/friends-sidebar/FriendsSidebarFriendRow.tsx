import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import {
    FriendInstanceTimer,
    FriendLocationTimer
} from '@/components/friends/FriendInstanceTimer';
import type { LocationMetadata } from '@/components/location/useLocationMetadata';
import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { UserDetailContent } from '@/components/UserDetailTile';
import type { InstanceRosterTimestamp } from '@/domain/instances/instanceRoster';
import type { UserStatus } from '@/platform/tauri/bindings';
import { getNameColour, userImage } from '@/services/entityMediaService';
import {
    TRUST_COLOR_DEFAULTS,
    type TrustColorMap
} from '@/shared/utils/trustColors';
import type { FriendLocationTimeEntry } from '@/state/friendLocationTimeStore';
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
    readFriendRef,
    resolveSidebarStatusDotClassName,
    resolveTrustNameColour,
    type SidebarFriendRecord
} from './friendsSidebarModel';

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
    isDarkMode?: boolean;
    trustColor?: TrustColorMap;
    currentUserSnapshot?: SidebarFriendRecord | null;
    isGameRunning?: boolean | null;
    recentActionVersion?: number;
    locationMetadata?: LocationMetadata | null;
    showInstanceIdInLocation?: boolean;
    ageGatedInstancesVisible?: boolean;
    currentLocationStartedAt?: InstanceRosterTimestamp | null;
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
        isDarkMode = false,
        trustColor = TRUST_COLOR_DEFAULTS,
        currentUserSnapshot = null,
        isGameRunning = undefined,
        recentActionVersion = 0,
        locationMetadata = null,
        showInstanceIdInLocation = false,
        ageGatedInstancesVisible = false,
        currentLocationStartedAt = null
    } = appearance || {};
    const displaySource = readFriendRef(friend);
    const imageUrl = userImage(displaySource, true, '64');
    const displayName =
        displaySource?.displayName ||
        displaySource?.username ||
        friend?.displayName ||
        friend?.username ||
        friend?.id ||
        'Unknown';
    const nameStyle: CSSProperties =
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
    const {
        statusSource,
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
    const subline = statusSource?.pendingOffline
        ? t('side_panel.pending_offline')
        : String(displaySource?.statusDescription || '');

    const podButton = (
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
            onClick={onOpen}
        >
            <UserDetailContent
                imageUrl={imageUrl}
                statusDotClassName={statusDotClassName}
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

    return (
        <ContextMenu>
            {isCurrentUser ? (
                <ContextMenuTrigger
                    render={
                        <div className="group flex w-full min-w-0 items-center gap-0.5">
                            <div className="min-w-0 flex-1">{podButton}</div>
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
                    <ContextMenuTrigger render={podButton} />
                </UserHoverCard>
            )}
            <ContextMenuContent className="w-56">
                {isCurrentUser ? (
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
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}
