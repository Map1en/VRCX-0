import { LockIcon, PersonStandingIcon, UserIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import { resolveSidebarStatusDotClassName } from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import { UserDetailTile } from '@/components/UserDetailTile';
import type { EntityRecord } from '@/domain/entities/profileEntities';
import { timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    summarizeEntityRow,
    userIdForRow,
    userRowSubtitle,
    userTravelingTimestamp,
    worldOccupantSubtitle
} from '../userDialogRows';
import { rowImage, type UserDialogEntityKind } from './userDialogEntityImages';
import { EntityListState } from './UserDialogEntityListState';
import { openRow } from './userDialogEntityNavigation';
import { UserGroupCard } from './UserDialogGroupCard';

export function EntityList({
    rows,
    kind,
    loading = false,
    error = ''
}: {
    rows: readonly EntityRecord[];
    kind: UserDialogEntityKind;
    loading?: boolean;
    error?: string;
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

    if (loading) {
        return <EntityListState kind={kind} loading />;
    }
    if (error) {
        return <EntityListState kind={kind} error={error} />;
    }
    if (!rows.length) {
        return <EntityListState kind={kind} />;
    }

    const nowMs = Date.now();

    return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] items-start gap-1">
            {rows.map((row, index) => {
                if (kind === 'group') {
                    return (
                        <UserGroupCard
                            key={`${row?.id || row?.groupId || row?.name || 'group'}:${index}`}
                            group={row}
                            currentEndpoint={currentEndpoint}
                        />
                    );
                }

                const image = rowImage(row, kind);
                const rawLabel =
                    kind === 'user'
                        ? row?.displayName || row?.username || ''
                        : summarizeEntityRow(row);
                const label =
                    typeof rawLabel === 'string'
                        ? rawLabel
                        : String(rawLabel ?? '');
                const subtitle =
                    kind === 'user'
                        ? userRowSubtitle(row, nowMs, t)
                        : kind === 'world'
                          ? worldOccupantSubtitle(row)
                          : typeof row.description === 'string'
                            ? row.description
                            : '';
                const imageRoundedClassName =
                    kind === 'user' ? 'rounded-full' : 'rounded-md';
                const RowFallbackIcon =
                    kind === 'avatar' ? PersonStandingIcon : UserIcon;
                const travelingTimestamp =
                    kind === 'user' ? userTravelingTimestamp(row) : 0;
                const userId = kind === 'user' ? userIdForRow(row) : '';
                const isCurrentUserRow = Boolean(
                    userId && userId === currentUserSnapshot?.id
                );
                const dotClassName =
                    kind === 'user'
                        ? resolveSidebarStatusDotClassName(
                              row,
                              currentUserSnapshot,
                              isCurrentUserRow,
                              { hideNonFriend: false, isGameRunning }
                          )
                        : '';
                const isPrivateWorld =
                    kind === 'world' && row?.releaseStatus === 'private';
                const userColour =
                    typeof row.$userColour === 'string' ? row.$userColour : '';
                const rowKey = `${row?.id || row?.userId || label}:${index}`;

                if (kind === 'user') {
                    return (
                        <UserDetailTile
                            key={rowKey}
                            userId={userId}
                            seed={row}
                            className="active:not-aria-[haspopup]:translate-y-0"
                            imageUrl={image}
                            statusDotClassName={dotClassName}
                            displayName={label || '\u2014'}
                            nameStyle={
                                userColour ? { color: userColour } : undefined
                            }
                            subline={
                                travelingTimestamp ? (
                                    <>
                                        <Spinner
                                            data-icon="inline-start"
                                            className="mr-1 inline-block"
                                        />
                                        {timeToText(
                                            Date.now() - travelingTimestamp
                                        )}
                                    </>
                                ) : (
                                    subtitle || undefined
                                )
                            }
                            onOpen={() => openRow(row, kind)}
                        />
                    );
                }

                const content = (
                    <>
                        <span className="relative size-9 shrink-0">
                            {image ? (
                                <FadeInImage
                                    src={image}
                                    alt=""
                                    className={cn(
                                        'size-9 object-cover',
                                        imageRoundedClassName
                                    )}
                                />
                            ) : (
                                <span
                                    className={cn(
                                        'bg-muted flex size-9 items-center justify-center [&>svg]:size-4',
                                        imageRoundedClassName
                                    )}
                                >
                                    <RowFallbackIcon className="text-muted-foreground" />
                                </span>
                            )}
                        </span>
                        <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="flex min-w-0 items-center gap-1">
                                <span className="block truncate leading-snug font-medium">
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
                                <span className="text-muted-foreground block truncate text-xs">
                                    {subtitle}
                                </span>
                            ) : null}
                        </span>
                    </>
                );

                return (
                    <Button
                        key={rowKey}
                        type="button"
                        variant="ghost"
                        className="h-auto min-w-0 justify-start gap-2 px-1.5 py-1.5 text-left font-normal active:not-aria-[haspopup]:translate-y-0"
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
