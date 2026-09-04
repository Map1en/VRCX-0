import type { LocationMetadata } from '@/components/location/useLocationMetadata';
import { normalizeStateBucket } from '@/domain/users/userFacts';
import { cn } from '@/lib/utils';
import type { UserStatus } from '@/platform/tauri/bindings';
import type { LocalInstanceActionGates } from '@/shared/utils/invite';
import type { TrustColorMap } from '@/shared/utils/trustColors';
import { Skeleton } from '@/ui/shadcn/skeleton';

import type { StatusPreset } from './FriendsSidebarActionItems';
import { FriendRow } from './FriendsSidebarFriendRow';
import {
    FriendSectionHeader,
    InstanceHeaderRow
} from './FriendsSidebarHeaders';
import {
    readFriendStatusSource,
    type SidebarFriendRecord
} from './friendsSidebarModel';
import type { SidebarVirtualRow } from './friendsSidebarVirtualRowBuilder';
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
        isGameRunning?: boolean | null;
        currentLocationStartedAt?: string | number | null;
    };
    onlineIdSet: Set<string>;
    instanceActionGatesByUserId: Map<string, LocalInstanceActionGates>;
};

type AppearanceView = {
    ageGatedInstancesVisible?: boolean;
    isDarkMode?: boolean;
    randomUserColours?: boolean;
    recentActionVersion?: number;
    showInstanceIdInLocation?: boolean;
    trustColor?: TrustColorMap;
};

type LocationView = {
    locationMetadataByKey: Map<string, LocationMetadata>;
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

function SidebarSkeletonRow() {
    return (
        <div className="flex items-center gap-2 rounded-md px-1.5 py-1.5">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-3/5" />
                <Skeleton className="mt-2 h-3 w-4/5" />
            </div>
        </div>
    );
}

function FriendVirtualRow({
    appearance,
    friend,
    metadataKey = '',
    isCurrentUser = false,
    isGroupByInstance = false,
    instanceLocation,
    friendCommands,
    location,
    runtime,
    statusCommands
}: {
    appearance: AppearanceView;
    friend: SidebarFriendRecord;
    metadataKey?: string;
    isCurrentUser?: boolean;
    isGroupByInstance?: boolean;
    instanceLocation?: string;
    friendCommands: FriendCommandsView;
    location: LocationView;
    runtime: RuntimeView;
    statusCommands: StatusCommandsView;
}) {
    const source = readFriendStatusSource(friend);
    const state = normalizeStateBucket(source?.state);
    const friendId = friend.id || '';
    const isOnlineFriend =
        runtime.onlineIdSet.has(friendId) || state === 'online';
    const instanceActionGates =
        runtime.instanceActionGatesByUserId.get(friendId);

    return (
        <FriendRow
            friend={friend}
            rowModel={{
                isCurrentUser,
                isGroupByInstance,
                instanceLocation,
                canSendInvite: Boolean(instanceActionGates?.canInvite),
                canRequestInvite: !isCurrentUser,
                canBoop: Boolean(runtime.currentUser?.isBoopingEnabled),
                canUseFriendInstance: Boolean(
                    isOnlineFriend && instanceActionGates?.canJoin
                )
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
                statusPresets: isCurrentUser ? statusCommands.statusPresets : []
            }}
            appearance={{
                randomUserColours: appearance.randomUserColours,
                isDarkMode: appearance.isDarkMode,
                trustColor: appearance.trustColor,
                currentUserSnapshot: runtime.currentUser,
                isGameRunning: runtime.gameState.isGameRunning,
                currentLocationStartedAt:
                    runtime.gameState.currentLocationStartedAt,
                recentActionVersion: appearance.recentActionVersion,
                locationMetadata:
                    location.locationMetadataByKey.get(metadataKey),
                showInstanceIdInLocation: appearance.showInstanceIdInLocation,
                ageGatedInstancesVisible: appearance.ageGatedInstancesVisible
            }}
        />
    );
}

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
                <FriendSectionHeader
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
            return <SidebarSkeletonRow />;
        case 'footer':
            return <div className="h-4" />;
        case 'friend':
        default:
            return row.friend ? (
                <FriendVirtualRow
                    appearance={appearance}
                    friend={row.friend}
                    isCurrentUser={row.isCurrentUser}
                    isGroupByInstance={row.isGroupByInstance}
                    instanceLocation={row.instanceLocation}
                    metadataKey={row.key}
                    friendCommands={friendCommands}
                    location={location}
                    runtime={runtime}
                    statusCommands={statusCommands}
                />
            ) : null;
    }
}

export { FriendsSidebarVirtualRow };
