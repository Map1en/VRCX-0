import { useQuery } from '@tanstack/react-query';
import { CrownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FriendLocationTimer } from '@/components/friends/FriendInstanceTimer';
import {
    resolveSidebarStatusDotClassName,
    type SidebarFriendRecord
} from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import { UserDetailTile } from '@/components/UserDetailTile';
import {
    createInstanceUserRow,
    firstText,
    mergeInstanceUserRows,
    mergeInstanceUsers,
    normalizeInstanceUsers,
    type InstanceRosterRow
} from '@/domain/instances/instanceRoster';
import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import { useKnownUserFact } from '@/lib/useKnownUser';
import userProfileRepository from '@/repositories/userProfileRepository';
import { openUserDialog } from '@/services/dialogService';
import { userImage } from '@/services/entityMediaService';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import {
    locationSentinel,
    resolveFriendPresenceLocation
} from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';
import { userStatusLabel } from '@/shared/utils/userStatus';
import { useRuntimeStore } from '@/state/runtimeStore';

export { firstText, mergeInstanceUsers, normalizeInstanceUsers };

type InstanceUserSource = Record<string, unknown> | string | null | undefined;
type Translate = NonNullable<Parameters<typeof userStatusLabel>[1]>;

function record(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function instanceUserSubtitle(user: InstanceRosterRow, t: Translate) {
    if (user.$subtitle) {
        return user.$subtitle;
    }
    return firstText(
        user.subtitle,
        user.statusDescription,
        userStatusLabel(user, t)
    );
}

function firstDisplayName(userId: unknown, ...sources: unknown[]) {
    const normalizedUserId = firstText(userId);
    for (const source of sources) {
        const displayName = firstText(
            record(source).displayName,
            record(source).display_name,
            record(source).username,
            record(source).name
        );
        if (displayName && displayName !== normalizedUserId) {
            return displayName;
        }
    }
    return normalizedUserId;
}

export function InstanceUserTiles({
    instance,
    instanceLocation = '',
    visibleUserIds,
    showInstanceDuration = false
}: {
    instance: unknown;
    instanceLocation?: string;
    visibleUserIds?: ReadonlySet<string>;
    showInstanceDuration?: boolean;
}) {
    const { t } = useTranslation();
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning === true
    );
    const source = record(instance);
    const creatorUser = record(source.creatorUser);
    const creatorUserId = firstText(source.creatorUserId);
    const knownCreatorUser = useKnownUserFact(creatorUserId, {
        endpoint: currentEndpoint
    });
    const knownCreatorUserRecord = record(knownCreatorUser);
    const creatorUserSeed = {
        ...knownCreatorUserRecord,
        ...creatorUser,
        id: creatorUserId,
        userId: firstText(
            creatorUser.userId,
            knownCreatorUserRecord.userId,
            creatorUserId
        ),
        displayName: firstDisplayName(
            creatorUserId,
            creatorUser,
            knownCreatorUser
        )
    };
    const creatorHasDisplayMedia =
        creatorUserSeed.displayName !== creatorUserId &&
        Boolean(userImage(creatorUserSeed, true));
    const creatorProfileQuery = useQuery({
        queryKey: queryKeys.user(creatorUserId, currentEndpoint),
        queryFn: () =>
            userProfileRepository.getUserProfile({
                userId: creatorUserId
            }),
        enabled:
            Boolean(creatorUserId) &&
            !hasGroupIdPrefix(creatorUserId) &&
            !creatorHasDisplayMedia,
        staleTime: entityQueryPolicies.userAvatarLookup.staleTime,
        gcTime: entityQueryPolicies.userAvatarLookup.gcTime,
        retry: entityQueryPolicies.userAvatarLookup.retry,
        refetchOnWindowFocus:
            entityQueryPolicies.userAvatarLookup.refetchOnWindowFocus
    });
    const userMap = new Map<string, InstanceRosterRow>();
    const pushUser = (user: InstanceUserSource) => {
        const row = createInstanceUserRow(user);
        if (!row) {
            return;
        }
        const userId = firstText(row.userId, row.user_id, row.id);
        if (
            visibleUserIds &&
            userId !== creatorUserId &&
            (!userId || !visibleUserIds.has(userId))
        ) {
            return;
        }
        const key = firstText(userId, row.displayName);
        if (!key) {
            return;
        }
        const existing = userMap.get(key);
        userMap.set(
            key,
            existing
                ? (mergeInstanceUserRows(existing, row, {
                      incomingPresenceWins: true
                  }) ?? row)
                : row
        );
    };

    if (creatorUserId && !hasGroupIdPrefix(creatorUserId)) {
        const creatorProfile = record(creatorProfileQuery.data);
        pushUser({
            ...knownCreatorUserRecord,
            ...creatorProfile,
            ...creatorUser,
            id: creatorUserId,
            userId: firstText(
                creatorUser.userId,
                creatorProfile.userId,
                knownCreatorUserRecord.userId,
                creatorUserId
            ),
            displayName: firstDisplayName(
                creatorUserId,
                creatorUser,
                creatorProfile,
                knownCreatorUser
            ),
            $subtitle: t('dialog.world.instances.instance_creator')
        });
    }
    for (const user of normalizeInstanceUsers(
        source.users,
        source.players,
        source.playerList,
        source.userList,
        source.userIds,
        source.usersById
    )) {
        pushUser(user);
    }
    const users = Array.from(userMap.values());
    if (!users.length) {
        return null;
    }
    return (
        <div className="mt-2 flex flex-wrap items-start">
            {users.map((user, index) => {
                const userId = firstText(
                    user.id,
                    user.userId,
                    user.user_id,
                    user.targetUserId,
                    user.target_user_id
                );
                const image = userImage(user, true);
                const isCurrentUser = Boolean(
                    userId && userId === currentUserSnapshot?.id
                );
                const statusUser: SidebarFriendRecord = {
                    id: user.id,
                    userId: user.userId,
                    displayName: user.displayName,
                    location:
                        typeof user.location === 'string'
                            ? user.location
                            : undefined,
                    state:
                        typeof user.state === 'string' ? user.state : undefined,
                    stateBucket:
                        typeof user.stateBucket === 'string'
                            ? user.stateBucket
                            : undefined,
                    status:
                        typeof user.status === 'string' ? user.status : null,
                    statusDescription:
                        typeof user.statusDescription === 'string'
                            ? user.statusDescription
                            : undefined,
                    isFriend:
                        typeof user.isFriend === 'boolean'
                            ? user.isFriend
                            : undefined,
                    $userColour:
                        typeof user.$userColour === 'string'
                            ? user.$userColour
                            : undefined
                };
                const dotClassName = resolveSidebarStatusDotClassName(
                    statusUser,
                    currentUserSnapshot,
                    isCurrentUser,
                    { hideNonFriend: false, isGameRunning }
                );
                const displayName = firstText(
                    user.displayName,
                    user.display_name,
                    user.username,
                    user.name,
                    userId,
                    'User'
                );
                const subtitle = instanceUserSubtitle(user, t);
                const isTraveling =
                    locationSentinel(user.location) === 'traveling';
                const timerLocation = isTraveling
                    ? resolveFriendPresenceLocation(user)
                    : instanceLocation.trim() ||
                      resolveFriendPresenceLocation(user);
                const isInstanceCreator = userId === creatorUserId;
                let subline: ReactNode;
                if (showInstanceDuration || isTraveling) {
                    subline = (
                        <FriendLocationTimer
                            userId={userId}
                            location={timerLocation}
                            traveling={isTraveling}
                            fallback={subtitle || undefined}
                        />
                    );
                } else {
                    subline = subtitle || undefined;
                }
                return (
                    <UserDetailTile
                        key={`${userId || displayName || 'user'}:${index}`}
                        userId={userId}
                        seed={user}
                        className="w-44"
                        imageUrl={image}
                        statusDotClassName={dotClassName}
                        displayName={displayName}
                        namePrefix={
                            isInstanceCreator ? (
                                <CrownIcon
                                    className="text-muted-foreground size-3.5 shrink-0"
                                    aria-label={t(
                                        'dialog.world.instances.instance_creator'
                                    )}
                                />
                            ) : undefined
                        }
                        nameStyle={
                            typeof user.$userColour === 'string'
                                ? { color: user.$userColour }
                                : undefined
                        }
                        subline={subline}
                        onOpen={() => {
                            if (!userId) {
                                return;
                            }
                            openUserDialog({
                                userId,
                                title: displayName || undefined,
                                seedData: user
                            });
                        }}
                    />
                );
            })}
        </div>
    );
}
