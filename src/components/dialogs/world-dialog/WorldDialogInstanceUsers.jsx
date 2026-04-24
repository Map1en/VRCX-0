import { UserIcon } from 'lucide-react';

import { timeToText } from '@/lib/dateTime.js';
import { userImage } from '@/lib/entityMedia.js';
import { userStatusDotClassName } from '@/lib/userStatus.js';
import { cn } from '@/lib/utils.js';
import { openUserDialog } from '@/services/dialogService.js';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
export function firstText(...values) {
    for (const value of values) {
        const text =
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim();
        if (text) {
            return text;
        }
    }
    return '';
}

export function isGroupId(value) {
    return firstText(value).startsWith('grp_');
}

function normalizeInstanceUser(value) {
    if (!value) {
        return null;
    }
    if (typeof value === 'string') {
        const userId = value.trim();
        return userId ? { id: userId, userId, displayName: userId } : null;
    }
    if (typeof value !== 'object') {
        return null;
    }
    const userId = firstText(
        value.id,
        value.userId,
        value.user_id,
        value.targetUserId,
        value.target_user_id
    );
    const displayName = firstText(
        value.displayName,
        value.display_name,
        value.username,
        value.name,
        userId
    );
    return {
        ...value,
        id: userId || value.id,
        userId: value.userId || userId,
        displayName
    };
}

export function normalizeInstanceUsers(...sources) {
    const rows = [];
    const push = (value) => {
        if (!value) {
            return;
        }
        if (value instanceof Map) {
            for (const entry of value.values()) {
                push(entry);
            }
            return;
        }
        if (Array.isArray(value)) {
            for (const entry of value) {
                push(entry);
            }
            return;
        }
        if (
            typeof value === 'object' &&
            !value.id &&
            !value.userId &&
            !value.user_id &&
            !value.targetUserId &&
            !value.target_user_id &&
            !value.displayName &&
            !value.display_name &&
            !value.username &&
            !value.name
        ) {
            for (const entry of Object.values(value)) {
                push(entry);
            }
            return;
        }
        const row = normalizeInstanceUser(value);
        if (row) {
            rows.push(row);
        }
    };

    for (const source of sources) {
        push(source);
    }
    return rows;
}

function instanceUserKey(user) {
    return firstText(
        user?.id,
        user?.userId,
        user?.user_id,
        user?.targetUserId,
        user?.target_user_id,
        user?.displayName,
        user?.display_name,
        user?.username,
        user?.name
    );
}

export function mergeInstanceUsers(...sources) {
    const usersByKey = new Map();
    const anonymousUsers = [];

    for (const user of normalizeInstanceUsers(...sources)) {
        const key = instanceUserKey(user);
        if (!key) {
            anonymousUsers.push(user);
            continue;
        }

        usersByKey.set(key, {
            ...(usersByKey.get(key) || {}),
            ...user
        });
    }

    return [...usersByKey.values(), ...anonymousUsers];
}

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

function instanceUserSubtitle(user) {
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
        user?.status,
        user?.stateBucket,
        user?.state
    );
}

export function InstanceUserTiles({ instance }) {
    const userMap = new Map();
    const pushUser = (user) => {
        const row = normalizeInstanceUser(user);
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
            $subtitle: 'Instance creator'
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
                const dotClassName = userStatusDotClassName(user);
                const displayName = firstText(
                    user?.displayName,
                    user?.display_name,
                    user?.username,
                    user?.name,
                    userId,
                    'User'
                );
                const subtitle = instanceUserSubtitle(user);
                const travelingTimestamp = instanceUserTravelingTimestamp(user);
                return (
                    <Button
                        key={`${userId || displayName || 'user'}:${index}`}
                        type="button"
                        variant="ghost"
                        className="h-auto w-44 justify-start gap-2 px-1.5 py-1.5 text-left font-normal"
                        onClick={() =>
                            userId &&
                            openUserDialog({
                                userId,
                                title: displayName || undefined,
                                seedData: user
                            })
                        }
                    >
                        <span className="relative size-9 shrink-0">
                            {image ? (
                                <img
                                    src={image}
                                    alt=""
                                    className="size-9 rounded-full object-cover"
                                />
                            ) : (
                                <span className="bg-muted flex size-9 items-center justify-center rounded-full [&>svg]:size-4">
                                    <UserIcon className="text-muted-foreground" />
                                </span>
                            )}
                            {dotClassName ? (
                                <span
                                    className={cn(
                                        'border-background absolute right-0 bottom-0 z-10 size-2.5 rounded-full border',
                                        dotClassName
                                    )}
                                />
                            ) : null}
                        </span>
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
