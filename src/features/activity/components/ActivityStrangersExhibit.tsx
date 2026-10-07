import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    MutualFriendAvatars,
    toMutualFriendAvatar
} from '@/components/mutual-friends/MutualFriendAvatars';
import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { mutualFriendIdsOf } from '@/lib/mutual-friends/mutualFriendsStrangers';
import { useUserMutualFriends } from '@/lib/mutual-friends/useUserMutualFriends';
import type { ActivityPageCompanionRow } from '@/platform/tauri/bindings';
import { openUserDialog } from '@/services/dialogService';

import { useActivityUserAvatars } from '../useActivityUserAvatars';
import { Exhibit } from './ActivityExhibit';
import { Face, hours } from './ActivityPeopleExhibit';

const MUTUAL_AVATAR_LIMIT = 3;
const MUTUAL_NAME_LIMIT = 2;

function StrangerMutuals({ userId }: { userId: string }) {
    const { t } = useTranslation();
    const rows = useUserMutualFriends(userId, true).data;
    const friends = useMemo(() => {
        const rowsById = new Map((rows ?? []).map((row) => [row.id, row]));
        return mutualFriendIdsOf(rows).map((id) =>
            toMutualFriendAvatar(id, rowsById.get(id))
        );
    }, [rows]);

    if (friends.length === 0) {
        return null;
    }

    const names = friends
        .slice(0, MUTUAL_NAME_LIMIT)
        .map((friend) => friend.displayName)
        .join(t('user_hover_card.name_separator'));
    const more = friends.length - MUTUAL_NAME_LIMIT;

    return (
        <span
            className="mt-1 flex min-w-0 items-center gap-1.5"
            title={t('user_hover_card.mutual_friends', {
                count: friends.length
            })}
        >
            <MutualFriendAvatars
                friends={friends.slice(0, MUTUAL_AVATAR_LIMIT)}
            />
            <span className="text-muted-foreground min-w-0 truncate text-xs">
                {names}
                {more > 0 ? ` +${more}` : null}
            </span>
        </span>
    );
}

export function ActivityStrangersExhibit({
    rows
}: {
    rows: ActivityPageCompanionRow[];
}) {
    const { t } = useTranslation();
    const userIds = useMemo(() => rows.map((row) => row.userId), [rows]);
    const avatarOf = useActivityUserAvatars(userIds);
    const leadDays = rows[0]?.coDays ?? 0;
    const hoursUnit = t('view.activity.unit.hours');

    return (
        <Exhibit
            label={t('view.activity.section.strangers')}
            caption={t('view.activity.people.strangers_caption')}
        >
            <div className="flex flex-col">
                {rows.map((row) => {
                    const share =
                        leadDays > 0
                            ? Math.max(
                                  2,
                                  Math.round((row.coDays / leadDays) * 100)
                              )
                            : 0;
                    return (
                        <UserHoverCard key={row.userId} userId={row.userId}>
                            <button
                                type="button"
                                onClick={() =>
                                    openUserDialog({
                                        userId: row.userId,
                                        title: row.displayName
                                    })
                                }
                                className="-mx-2 flex min-h-14 items-center gap-3 px-2 py-1.5 text-left transition-colors duration-100 ease-out hover:bg-[var(--act-track)]"
                            >
                                <Face
                                    url={avatarOf(row.userId)}
                                    className="size-9"
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="text-foreground block truncate text-sm">
                                        {row.displayName || row.userId}
                                    </span>
                                    <StrangerMutuals userId={row.userId} />
                                </span>
                                <span
                                    aria-hidden="true"
                                    className="hidden h-1 w-16 shrink-0 bg-[var(--act-track)] sm:block"
                                >
                                    <span
                                        className="block h-full bg-[var(--act-heat-2)]"
                                        style={{ width: `${share}%` }}
                                    />
                                </span>
                                <span className="text-foreground w-16 shrink-0 text-right text-xs font-medium tabular-nums">
                                    {t('view.activity.people.co_days', {
                                        count: row.coDays
                                    })}
                                </span>
                                <span className="text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums">
                                    {hours(row.minutes)}
                                    {hoursUnit}
                                </span>
                            </button>
                        </UserHoverCard>
                    );
                })}
            </div>
        </Exhibit>
    );
}
