import { memo } from 'react';

import type { SidebarFriendRecord } from '@/components/friends/friendStatusModel';
import { ListSectionHeader } from '@/components/layout/ListSectionHeader';
import type { LocationMetadata } from '@/components/location/useLocationMetadata';
import { cn } from '@/lib/utils';
import type { UserStatus } from '@/platform/tauri/bindings';
import type { UserNameColourStyle } from '@/shared/utils/entityMedia';
import type { LocalInstanceActionGates } from '@/shared/utils/invite';
import type { TrustColorMap } from '@/shared/utils/trustColors';
import type { FriendLocationTimeEntry } from '@/state/friendLocationTimeStore';
import { Skeleton } from '@/ui/shadcn/skeleton';

import type { StatusPreset } from './FriendsSidebarActionItems';
import { FriendRow } from './FriendsSidebarFriendRow';
import { InstanceHeaderRow } from './FriendsSidebarHeaders';
import type { SidebarVirtualRow } from './friendsSidebarVirtualRowBuilder';
import { sidebarAvatarSkeletonClassName } from './SidebarUserRowContent';
import {
    isFriendsSidebarGroupKey,
    type FriendsSidebarGroupKey
} from './useFriendsSidebarPreferences';

type FriendCommandsView = {
    onOpenFriend: (friend: SidebarFriendRecord) => void;
    onToggleSection: (id: FriendsSidebarGroupKey) => void;
    onSelfInvite?: (location: string) => void;
    onInvite?: (friend: SidebarFriendRecord) => void;
    onRequestInvite?: (friend: SidebarFriendRecord) => void;
    onBoop?: (friend: SidebarFriendRecord) => void;
};

type RuntimeView = {
    currentUser?:
        | (Record<string, unknown> & { isBoopingEnabled?: unknown })
        | null;
    currentUserId?: string | null;
    gameState: {
        currentLocationStartedAt?: string | number | null;
    };
    instanceActionGatesByUserId: Map<string, LocalInstanceActionGates>;
};

type AppearanceView = {
    ageGatedInstancesVisible?: boolean;
    isDarkMode?: boolean;
    randomUserColours?: boolean;
    randomUserColourStyle?: UserNameColourStyle;
    recentActionVersion?: number;
    showInstanceIdInLocation?: boolean;
    showSidebarAvatarFrame?: boolean;
    showSidebarNameplate?: boolean;
    sidebarCompactRows?: boolean;
    trustColor?: TrustColorMap;
};

type LocationView = {
    locationMetadataByKey: Map<string, LocationMetadata>;
    locationTimesByUserId: Readonly<Record<string, FriendLocationTimeEntry>>;
};

type StatusCommandsView = {
    statusPresets?: StatusPreset[];
    onChangeStatus?: (status: UserStatus) => void;
    onSetStatusDescription?: (statusDescription: string) => void;
    onEditSocialStatus?: () => void;
    onApplyStatusPreset?: (preset: StatusPreset) => void;
};

function FavoriteGroupHeaderRow({
    label,
    count
}: {
    label?: string;
    count?: number;
}) {
    return (
        <div className="text-muted-foreground flex w-full items-center px-1.5 py-1 text-left text-xs">
            {label || ''} - {count || 0}
        </div>
    );
}

function SidebarMessageRow({
    className = '',
    text
}: {
    className?: string;
    text?: string;
}) {
    return (
        <div
            className={cn(
                'text-muted-foreground rounded-md border border-dashed p-3 text-xs',
                className
            )}
        >
            {text || ''}
        </div>
    );
}

function SidebarSkeletonRow({ compact = false }: { compact?: boolean }) {
    return (
        <div
            className={cn(
                'flex items-center gap-2 rounded-md px-1.5',
                compact ? 'py-1' : 'py-1.5'
            )}
        >
            <Skeleton
                className={cn(
                    'shrink-0 rounded-full',
                    sidebarAvatarSkeletonClassName(compact)
                )}
            />
            <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-3/5" />
                <Skeleton className="mt-2 h-3 w-4/5" />
            </div>
        </div>
    );
}

const EMPTY_STATUS_PRESETS: StatusPreset[] = [];

const FriendVirtualRow = memo(function FriendVirtualRow({
    appearance,
    canBoop,
    canSendInvite,
    canUseFriendInstance,
    currentLocationStartedAt,
    friend,
    isCurrentUser = false,
    isGroupByInstance = false,
    instanceLocation,
    friendCommands,
    locationMetadata,
    locationTime,
    statusCommands
}: {
    appearance: AppearanceView;
    canBoop: boolean;
    canSendInvite: boolean;
    canUseFriendInstance: boolean;
    currentLocationStartedAt?: string | number | null;
    friend: SidebarFriendRecord;
    isCurrentUser?: boolean;
    isGroupByInstance?: boolean;
    instanceLocation?: string;
    friendCommands: FriendCommandsView;
    locationMetadata?: LocationMetadata;
    locationTime: FriendLocationTimeEntry | null;
    statusCommands: StatusCommandsView;
}) {
    return (
        <FriendRow
            friend={friend}
            rowModel={{
                isCurrentUser,
                isGroupByInstance,
                instanceLocation,
                locationTime,
                canSendInvite,
                canRequestInvite: !isCurrentUser,
                canBoop,
                canUseFriendInstance
            }}
            rowCommands={{
                onOpen: () => friendCommands.onOpenFriend(friend),
                onSelfInvite: friendCommands.onSelfInvite,
                onInvite: friendCommands.onInvite,
                onRequestInvite: friendCommands.onRequestInvite,
                onBoop: friendCommands.onBoop,
                onChangeStatus: statusCommands.onChangeStatus,
                onSetStatusDescription: statusCommands.onSetStatusDescription,
                onEditSocialStatus: statusCommands.onEditSocialStatus,
                onApplyStatusPreset: statusCommands.onApplyStatusPreset,
                statusPresets: isCurrentUser
                    ? statusCommands.statusPresets
                    : EMPTY_STATUS_PRESETS
            }}
            appearance={{
                randomUserColours: appearance.randomUserColours,
                randomUserColourStyle: appearance.randomUserColourStyle,
                isDarkMode: appearance.isDarkMode,
                trustColor: appearance.trustColor,
                currentLocationStartedAt,
                recentActionVersion: appearance.recentActionVersion,
                locationMetadata,
                showInstanceIdInLocation: appearance.showInstanceIdInLocation,
                ageGatedInstancesVisible: appearance.ageGatedInstancesVisible,
                showAvatarFrame: appearance.showSidebarAvatarFrame,
                showNameplate: appearance.showSidebarNameplate,
                compact: appearance.sidebarCompactRows
            }}
        />
    );
});

function FriendsSidebarVirtualRow({
    appearance,
    friendCommands,
    isFirstRow = false,
    location,
    row,
    runtime,
    statusCommands
}: {
    appearance: AppearanceView;
    friendCommands: FriendCommandsView;
    isFirstRow?: boolean;
    location: LocationView;
    row: SidebarVirtualRow;
    runtime: RuntimeView;
    statusCommands: StatusCommandsView;
}) {
    switch (row?.type) {
        case 'section':
            return (
                <ListSectionHeader
                    id={row.id}
                    title={row.title}
                    count={row.count}
                    open={row.open}
                    isFirst={isFirstRow}
                    onToggle={(id) => {
                        if (isFriendsSidebarGroupKey(id)) {
                            friendCommands.onToggleSection(id);
                        }
                    }}
                />
            );
        case 'favorite-group-header':
            return (
                <FavoriteGroupHeaderRow label={row.label} count={row.count} />
            );
        case 'instance-header':
            return (
                <InstanceHeaderRow
                    location={row.location}
                    count={row.count}
                    isCurrentInstance={row.isCurrentInstance}
                    metadata={location.locationMetadataByKey.get(row.key ?? '')}
                    showInstanceIdInLocation={
                        appearance.showInstanceIdInLocation
                    }
                    ageGatedInstancesVisible={
                        appearance.ageGatedInstancesVisible
                    }
                />
            );
        case 'message':
            return (
                <SidebarMessageRow className={row.className} text={row.text} />
            );
        case 'skeleton':
            return (
                <SidebarSkeletonRow compact={appearance.sidebarCompactRows} />
            );
        case 'footer':
            return <div className="h-4" />;
        case 'friend':
        default: {
            if (!row.friend) {
                return null;
            }
            const friendId = row.friend.id || '';
            const instanceActionGates =
                runtime.instanceActionGatesByUserId.get(friendId);
            return (
                <FriendVirtualRow
                    appearance={appearance}
                    canBoop={runtime.currentUser?.isBoopingEnabled === true}
                    canSendInvite={Boolean(instanceActionGates?.canInvite)}
                    canUseFriendInstance={Boolean(instanceActionGates?.canJoin)}
                    currentLocationStartedAt={
                        runtime.gameState.currentLocationStartedAt
                    }
                    friend={row.friend}
                    isCurrentUser={row.isCurrentUser}
                    isGroupByInstance={row.isGroupByInstance}
                    instanceLocation={row.instanceLocation}
                    friendCommands={friendCommands}
                    locationMetadata={location.locationMetadataByKey.get(
                        row.key ?? ''
                    )}
                    locationTime={
                        location.locationTimesByUserId[friendId] ?? null
                    }
                    statusCommands={statusCommands}
                />
            );
        }
    }
}

export { FriendsSidebarVirtualRow };
