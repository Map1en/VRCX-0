import { CrownIcon, LockIcon, UsersIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EntityAvatar } from '@/components/EntityAvatar';
import { FriendLocationTimer } from '@/components/friends/FriendInstanceTimer';
import { resolveSidebarStatusDotClassName } from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import { UserListItem } from '@/components/UserListItem';
import type { EntityRecord } from '@/domain/entities/shared';
import {
    presenceOf,
    presencePlace,
    resolveFriendPresenceLocation
} from '@/domain/friends/presence';
import { useNowMs } from '@/lib/useNowMs';
import { userStatusLabel } from '@/shared/utils/userStatus';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';

import { groupIdForRow } from '../userDialogGroupRows';
import {
    isUndisclosedMutualFriendRow,
    summarizeEntityRow,
    userIdForRow,
    entityDescriptionSubtitle,
    userRowSubtitle,
    worldOccupantCount
} from '../userDialogRows';
import { rowImage, type UserDialogEntityKind } from './userDialogEntityImages';
import { EntityListState } from './UserDialogEntityListState';
import { openRow } from './userDialogEntityNavigation';
import {
    UserGroupCard,
    type UserGroupCardMarkers
} from './UserDialogGroupCard';

export function EntityList({
    rows,
    kind,
    loading = false,
    error = '',
    instanceLocation = '',
    showInstanceDuration = false,
    groupMarkers
}: {
    rows: readonly EntityRecord[];
    kind: UserDialogEntityKind;
    loading?: boolean;
    error?: string;
    instanceLocation?: string;
    showInstanceDuration?: boolean;
    groupMarkers?: UserGroupCardMarkers;
}) {
    const { t } = useTranslation();
    const nowMs = useNowMs({ active: kind === 'user' });

    if (error) {
        return <EntityListState kind={kind} error={error} />;
    }
    if (!rows.length) {
        return <EntityListState kind={kind} loading={loading} />;
    }

    return (
        <div
            aria-busy={loading || undefined}
            className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] items-start gap-1"
        >
            {rows.map((row, index) => {
                if (kind === 'group') {
                    const groupId = groupIdForRow(row);
                    return (
                        <UserGroupCard
                            key={`${row?.id || row?.groupId || row?.name || 'group'}:${index}`}
                            group={row}
                            isOwner={groupMarkers?.own.has(groupId)}
                            isMutual={groupMarkers?.mutual.has(groupId)}
                        />
                    );
                }

                const image = rowImage(row, kind);
                const undisclosedMutualFriend =
                    kind === 'user' && isUndisclosedMutualFriendRow(row);
                let rawLabel;
                if (undisclosedMutualFriend) {
                    rawLabel = t(
                        'dialog.user.mutual_friends.undisclosed_friend'
                    );
                } else if (kind === 'user') {
                    rawLabel = row?.displayName || row?.username || '';
                } else {
                    rawLabel = summarizeEntityRow(row);
                }
                const label =
                    typeof rawLabel === 'string'
                        ? rawLabel
                        : String(rawLabel ?? '');
                const subtitle =
                    kind === 'user'
                        ? userRowSubtitle(row, nowMs, t)
                        : kind === 'world'
                          ? ''
                          : entityDescriptionSubtitle(row.description, label);
                const occupants =
                    kind === 'world' ? worldOccupantCount(row) : 0;
                const userId = kind === 'user' ? userIdForRow(row) : '';
                const rowPresence = kind === 'user' ? presenceOf(row) : null;
                const isTraveling = rowPresence
                    ? presencePlace(rowPresence)?.location.isTraveling === true
                    : false;
                const timerLocation =
                    kind === 'user'
                        ? isTraveling
                            ? resolveFriendPresenceLocation(row, {
                                  preferTraveling: true
                              })
                            : instanceLocation.trim() ||
                              resolveFriendPresenceLocation(row, {
                                  preferTraveling: true
                              })
                        : '';
                const dotClassName =
                    kind === 'user'
                        ? resolveSidebarStatusDotClassName(row, {
                              hideNonFriend: false
                          })
                        : '';
                const isPrivateWorld =
                    kind === 'world' && row?.releaseStatus === 'private';
                const userColour =
                    typeof row.$userColour === 'string' ? row.$userColour : '';
                const isInstanceCreator = row.$isInstanceCreator === true;
                const timerFallback =
                    typeof row.statusDescription === 'string' &&
                    row.statusDescription.trim()
                        ? row.statusDescription
                        : userStatusLabel(row, t);
                const rowKey = `${row?.id || row?.userId || label}:${index}`;

                if (kind === 'user') {
                    return (
                        <UserListItem
                            key={rowKey}
                            userId={userId}
                            seed={row}
                            disabled={undisclosedMutualFriend}
                            imageUrl={image}
                            statusDotClassName={dotClassName}
                            displayName={label || '\u2014'}
                            namePrefix={
                                isInstanceCreator ? (
                                    <HintTooltip
                                        label={t(
                                            'dialog.user.info.instance_creator'
                                        )}
                                    >
                                        <span
                                            role="img"
                                            className="inline-flex shrink-0"
                                        >
                                            <CrownIcon className="text-muted-foreground size-3.5 shrink-0" />
                                        </span>
                                    </HintTooltip>
                                ) : undefined
                            }
                            nameStyle={
                                userColour ? { color: userColour } : undefined
                            }
                            subline={
                                isInstanceCreator ? (
                                    t('dialog.user.info.instance_creator')
                                ) : showInstanceDuration || isTraveling ? (
                                    <FriendLocationTimer
                                        userId={userId}
                                        location={timerLocation}
                                        traveling={isTraveling}
                                        fallback={timerFallback || undefined}
                                    />
                                ) : (
                                    subtitle || undefined
                                )
                            }
                            onOpen={
                                undisclosedMutualFriend
                                    ? undefined
                                    : () => openRow(row, kind)
                            }
                        />
                    );
                }

                const content = (
                    <>
                        <EntityAvatar kind={kind} imageUrl={image} />
                        <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="flex min-w-0 items-center gap-1">
                                <span className="block truncate text-sm leading-5 font-medium">
                                    {label || '\u2014'}
                                </span>
                                {isPrivateWorld ? (
                                    <LockIcon
                                        className="text-muted-foreground size-3.5 shrink-0"
                                        aria-label={t(
                                            'dialog.world.tags.private'
                                        )}
                                    />
                                ) : null}
                            </span>
                            {subtitle ? (
                                <span className="text-content-secondary block truncate text-xs leading-4">
                                    {subtitle}
                                </span>
                            ) : null}
                            {occupants > 0 ? (
                                <HintTooltip
                                    label={t(
                                        'dialog.user.worlds.current_occupants'
                                    )}
                                >
                                    <span className="text-content-secondary flex w-fit items-center gap-1 text-xs leading-4 tabular-nums">
                                        <UsersIcon
                                            aria-hidden="true"
                                            className="size-3"
                                        />
                                        {occupants}
                                    </span>
                                </HintTooltip>
                            ) : null}
                        </span>
                    </>
                );

                return (
                    <Button
                        key={rowKey}
                        type="button"
                        variant="ghost"
                        className="h-auto min-w-0 justify-start gap-2.5 px-2 py-1.5 text-left font-normal active:not-aria-[haspopup]:translate-y-0"
                        onClick={() => openRow(row, kind)}
                    >
                        {content}
                    </Button>
                );
            })}
        </div>
    );
}

export function UserGroupSection({
    title,
    rows,
    countText
}: {
    title: ReactNode;
    rows: readonly EntityRecord[];
    countText?: ReactNode;
}) {
    if (!rows.length) {
        return null;
    }

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-baseline gap-1.5">
                <span className="text-base font-bold">{title}</span>
                <span className="text-muted-foreground text-xs">
                    {countText || rows.length}
                </span>
            </div>
            <EntityList rows={rows} kind="group" />
        </section>
    );
}
