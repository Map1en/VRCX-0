import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { FriendInstanceTimer } from '@/components/sidebar/friends-sidebar/FriendsSidebarLocation';
import {
    resolveSidebarStatusDotClassName,
    type SidebarFriendRecord
} from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import { UserDetailTile } from '@/components/UserDetailTile';
import {
    createInstanceUserRow,
    firstText,
    isGroupId,
    mergeInstanceUsers,
    normalizeInstanceUsers,
    resolveInstanceDwellEpoch,
    type InstanceRosterRow
} from '@/domain/instances/instanceRoster';
import { timeToText } from '@/lib/dateTime';
import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import { useKnownUserFact } from '@/lib/useKnownUser';
import userProfileRepository from '@/repositories/userProfileRepository';
import { openUserDialog } from '@/services/dialogService';
import { userImage } from '@/services/entityMediaService';
import { userStatusLabel } from '@/shared/utils/userStatus';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Spinner } from '@/ui/shadcn/spinner';

export { firstText, isGroupId, mergeInstanceUsers, normalizeInstanceUsers };

type InstanceUserSource = Record<string, unknown> | string | null | undefined;
type Translate = NonNullable<Parameters<typeof userStatusLabel>[1]>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function record(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function timestampFromValue(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
    }
    const text = firstText(value);
    if (!text) {
        return 0;
    }
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function instanceUserTravelingTimestamp(user: InstanceRosterRow) {
    if (firstText(user.location).toLowerCase() !== 'traveling') {
        return 0;
    }
    return (
        timestampFromValue(user.$travelingToTime) ||
        timestampFromValue(user.travelingToTime) ||
        timestampFromValue(user.traveling_to_time)
    );
}

function instanceUserSubtitle(user: InstanceRosterRow, t: Translate) {
    if (user.$subtitle) {
        return user.$subtitle;
    }
    if (instanceUserTravelingTimestamp(user)) {
        return '';
    }
    const timestamp =
        timestampFromValue(user.$location_at) ||
        timestampFromValue(user.locationAt) ||
        timestampFromValue(user.location_at) ||
        timestampFromValue(user.joinedAt) ||
        timestampFromValue(user.joined_at) ||
        timestampFromValue(user.created_at) ||
        timestampFromValue(user.createdAt);
    if (timestamp) {
        return timeToText(Date.now() - timestamp);
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
    visibleUserIds,
    showInstanceDuration = false
}: {
    instance: unknown;
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
    const creatorIsVisible =
        !visibleUserIds ||
        Boolean(creatorUserId && visibleUserIds.has(creatorUserId));
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
            !isGroupId(creatorUserId) &&
            creatorIsVisible &&
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
        if (visibleUserIds && (!userId || !visibleUserIds.has(userId))) {
            return;
        }
        const key = firstText(userId, row.displayName);
        if (!key || userMap.has(key)) {
            return;
        }
        userMap.set(key, row);
    };

    if (creatorUserId && !isGroupId(creatorUserId) && creatorIsVisible) {
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
                    statusDescription: user.statusDescription,
                    isFriend: user.isFriend,
                    $userColour:
                        typeof user.$userColour === 'string'
                            ? user.$userColour
                            : undefined,
                    $location_at:
                        typeof user.$location_at === 'string' ||
                        typeof user.$location_at === 'number' ||
                        user.$location_at === null
                            ? user.$location_at
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
                const travelingTimestamp = instanceUserTravelingTimestamp(user);
                return (
                    <UserDetailTile
                        key={`${userId || displayName || 'user'}:${index}`}
                        userId={userId}
                        seed={user}
                        className="w-44"
                        imageUrl={image}
                        statusDotClassName={dotClassName}
                        displayName={displayName}
                        nameStyle={
                            typeof user.$userColour === 'string'
                                ? { color: user.$userColour }
                                : undefined
                        }
                        subline={
                            showInstanceDuration ? (
                                <FriendInstanceTimer
                                    epoch={
                                        travelingTimestamp ||
                                        resolveInstanceDwellEpoch(user)
                                    }
                                    traveling={Boolean(travelingTimestamp)}
                                />
                            ) : travelingTimestamp ? (
                                <>
                                    <Spinner
                                        aria-hidden="true"
                                        aria-label={undefined}
                                        role="presentation"
                                        className="mr-1 inline-block size-3"
                                    />
                                    {timeToText(
                                        Date.now() - travelingTimestamp
                                    )}
                                </>
                            ) : (
                                subtitle || undefined
                            )
                        }
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
