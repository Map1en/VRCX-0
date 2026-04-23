import { cn } from '@/lib/utils.js';
import { checkCanInviteSelf } from '@/shared/utils/invite.js';

import {
    normalizeLocationStatus,
    readFriendRefLocation,
    readFriendStatusSource,
    resolvePresenceLocation
} from './friendsSidebarModel.js';
import { FriendRow } from './FriendsSidebarFriendRow.jsx';
import { FriendSectionHeader, InstanceHeaderRow } from './FriendsSidebarHeaders.jsx';

function FavoriteGroupHeaderRow({ label, count }) {
    return (
        <div className="text-muted-foreground flex w-full items-center px-1.5 py-1 text-left text-xs">
            {label} - {count}
        </div>
    );
}

function SidebarMessageRow({ className = '', text }) {
    return (
        <div
            className={cn(
                'text-muted-foreground rounded-md border border-dashed p-3 text-xs',
                className
            )}
        >
            {text}
        </div>
    );
}

function FriendVirtualRow({
    friend,
    isCurrentUser = false,
    isGroupByInstance = false,
    metadataKey = '',
    context,
    rowActions,
    onOpenFriend,
    t
}) {
    const source = readFriendStatusSource(friend);
    const state = normalizeLocationStatus(source?.stateBucket || source?.state);
    const isOnlineFriend =
        context.onlineIdSet.has(friend.id) || state === 'online';

    return (
        <FriendRow
            friend={friend}
            isCurrentUser={isCurrentUser}
            isGroupByInstance={isGroupByInstance}
            canSendInvite={Boolean(
                context.gameState.isGameRunning &&
                    context.currentInviteLocation &&
                    context.canInviteFromCurrentLocation
            )}
            canRequestInvite={isOnlineFriend}
            canBoop={Boolean(context.currentUser?.isBoopingEnabled)}
            canUseFriendInstance={Boolean(
                isOnlineFriend &&
                    checkCanInviteSelf(
                        isCurrentUser
                            ? resolvePresenceLocation(friend)
                            : readFriendRefLocation(friend),
                        {
                            currentUserId: context.currentUserId,
                            cachedInstances: new Map(),
                            friends: context.friendsMap
                        }
                    )
            )}
            actions={{
                ...rowActions,
                open: () => onOpenFriend(friend)
            }}
            t={t}
            statusPresets={isCurrentUser ? context.statusPresets : []}
            randomUserColours={context.randomUserColours}
            isDarkMode={context.isDarkMode}
            timeUnitLabels={context.timeUnitLabels}
            trustColor={context.trustColor}
            currentUserSnapshot={context.currentUser}
            recentActionVersion={context.recentActionVersion}
            locationMetadata={context.locationMetadataByKey.get(metadataKey)}
            showInstanceIdInLocation={context.showInstanceIdInLocation}
            ageGatedInstancesVisible={context.ageGatedInstancesVisible}
        />
    );
}

function FriendsSidebarVirtualRow({
    row,
    context,
    rowActions,
    onOpenFriend,
    onToggleSection,
    t
}) {
    switch (row?.type) {
        case 'section':
            return (
                <FriendSectionHeader
                    id={row.id}
                    title={row.title}
                    count={row.count}
                    open={row.open}
                    onToggle={onToggleSection}
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
                    metadata={context.locationMetadataByKey.get(row.key)}
                    t={t}
                    showInstanceIdInLocation={context.showInstanceIdInLocation}
                    ageGatedInstancesVisible={context.ageGatedInstancesVisible}
                />
            );
        case 'message':
            return (
                <SidebarMessageRow
                    className={row.className}
                    text={row.text}
                />
            );
        case 'footer':
            return <div className="h-4" />;
        case 'friend':
        default:
            return (
                <FriendVirtualRow
                    friend={row.friend}
                    isCurrentUser={row.isCurrentUser}
                    isGroupByInstance={row.isGroupByInstance}
                    metadataKey={row.key}
                    context={context}
                    rowActions={rowActions}
                    onOpenFriend={onOpenFriend}
                    t={t}
                />
            );
    }
}

export { FriendsSidebarVirtualRow };
