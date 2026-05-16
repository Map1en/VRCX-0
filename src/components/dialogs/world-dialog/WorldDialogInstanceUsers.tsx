// @ts-nocheck
import { useTranslation } from 'react-i18next';

import {
    createInstanceUserRow,
    firstText,
    isGroupId,
    mergeInstanceUsers,
    normalizeInstanceUsers
} from '@/components/instances/instanceRoster.js';
import { resolveSidebarStatusDotClassName } from '@/components/sidebar/friends-sidebar/friendsSidebarModel.js';
import { UserStatusAvatar } from '@/components/UserStatusAvatar';
import { timeToText } from '@/lib/dateTime.js';
import { userImage } from '@/lib/entityMedia.js';
import { userStatusLabel } from '@/lib/userStatus.js';
import { openUserDialog } from '@/services/dialogService.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

export { firstText, isGroupId, mergeInstanceUsers, normalizeInstanceUsers };

function timestampFromValue(value) {
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

function instanceUserTravelingTimestamp(user) {
    if (firstText(user?.location).toLowerCase() !== 'traveling') {
        return 0;
    }
    return (
        timestampFromValue(user?.$travelingToTime) ||
        timestampFromValue(user?.travelingToTime) ||
        timestampFromValue(user?.traveling_to_time)
    );
}

function instanceUserSubtitle(user, t) {
    if (user?.$subtitle) {
        return user.$subtitle;
    }
    if (instanceUserTravelingTimestamp(user)) {
        return '';
    }
    const timestamp =
        timestampFromValue(user?.$location_at) ||
        timestampFromValue(user?.locationAt) ||
        timestampFromValue(user?.location_at) ||
        timestampFromValue(user?.joinedAt) ||
        timestampFromValue(user?.joined_at) ||
        timestampFromValue(user?.created_at) ||
        timestampFromValue(user?.createdAt);
    if (timestamp) {
        return timeToText(Date.now() - timestamp);
    }
    return firstText(
        user?.subtitle,
        user?.statusDescription,
        userStatusLabel(user, t)
    );
}

export function InstanceUserTiles({ instance }) {
    const { t } = useTranslation();
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const userMap = new Map();
    const pushUser = (user) => {
        const row = createInstanceUserRow(user);
        if (!row) {
            return;
        }
        const key = firstText(row.id, row.userId, row.displayName);
        if (!key || userMap.has(key)) {
            return;
        }
        userMap.set(key, row);
    };

    if (instance?.creatorUserId && !isGroupId(instance.creatorUserId)) {
        pushUser({
            ...(instance.creatorUser || {}),
            id: instance.creatorUserId,
            userId: instance.creatorUser?.userId || instance.creatorUserId,
            displayName: firstText(
                instance.creatorUser?.displayName,
                instance.creatorUser?.username,
                instance.creatorUser?.name,
                instance.creatorUserId
            ),
            $subtitle: t('dialog.world.instances.instance_creator')
        });
    }
    for (const user of normalizeInstanceUsers(
        instance?.users,
        instance?.players,
        instance?.playerList,
        instance?.userList,
        instance?.userIds,
        instance?.usersById
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
                    user?.id,
                    user?.userId,
                    user?.user_id,
                    user?.targetUserId,
                    user?.target_user_id
                );
                const image = userImage(user, true);
                const isCurrentUser = Boolean(
                    userId && userId === currentUserSnapshot?.id
                );
                const dotClassName = resolveSidebarStatusDotClassName(
                    user,
                    currentUserSnapshot,
                    isCurrentUser,
                    { hideNonFriend: false }
                );
                const displayName = firstText(
                    user?.displayName,
                    user?.display_name,
                    user?.username,
                    user?.name,
                    userId,
                    'User'
                );
                const subtitle = instanceUserSubtitle(user, t);
                const travelingTimestamp = instanceUserTravelingTimestamp(user);
                return (
                    <Button
                        key={`${userId || displayName || 'user'}:${index}`}
                        type="button"
                        variant="ghost"
                        className="h-auto w-44 justify-start gap-2 px-1.5 py-1.5 text-left font-normal"
                        onClick={() => {
                            if (!userId) {
                                return;
                            }
                            openUserDialog({
                                userId,
                                title: displayName || undefined,
                                seedData: user
                            });
                        }}
                    >
                        <UserStatusAvatar
                            imageUrl={image}
                            statusDotClassName={dotClassName}
                        />
                        <span className="min-w-0 flex-1 overflow-hidden">
                            <span
                                className="block truncate leading-snug font-medium"
                                style={
                                    user?.$userColour
                                        ? { color: user.$userColour }
                                        : undefined
                                }
                            >
                                {displayName}
                            </span>
                            {travelingTimestamp ? (
                                <span className="text-muted-foreground block truncate text-xs">
                                    <Spinner
                                        aria-hidden="true"
                                        aria-label={undefined}
                                        role="presentation"
                                        className="mr-1 inline-block size-3"
                                    />
                                    {timeToText(
                                        Date.now() - travelingTimestamp
                                    )}
                                </span>
                            ) : subtitle ? (
                                <span className="text-muted-foreground block truncate text-xs">
                                    {subtitle}
                                </span>
                            ) : null}
                        </span>
                    </Button>
                );
            })}
        </div>
    );
}
