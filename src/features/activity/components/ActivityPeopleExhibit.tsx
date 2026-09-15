import { UserIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { cn } from '@/lib/utils';
import type {
    ActivityCompanionOrder,
    ActivityPageCompanionRow,
    ActivityPagePeople
} from '@/repositories/activityPageRepository';
import { openUserDialog } from '@/services/dialogService';
import { Skeleton } from '@/ui/shadcn/skeleton';

import { useActivityUserAvatars } from '../useActivityUserAvatars';
import { Exhibit } from './ActivityExhibit';
import { ActivityFadingList } from './ActivityFadingList';
import { OptionSegmented } from './ActivityViewOption';

function hours(minutes: number) {
    return (minutes / 60).toFixed(1);
}

function Face({ url, className }: { url: string; className: string }) {
    const fallback = (
        <span className="flex size-full items-center justify-center rounded-full bg-[var(--act-track)]">
            <UserIcon className="text-muted-foreground size-1/2" />
        </span>
    );
    return (
        <span
            className={cn(
                'block shrink-0 overflow-hidden rounded-full',
                className
            )}
        >
            {url ? (
                <FadeInImage
                    src={url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-full rounded-full object-cover"
                    fallback={fallback}
                />
            ) : (
                fallback
            )}
        </span>
    );
}

function PeopleSkeleton({ rows }: { rows: number }) {
    return (
        <>
            <div className="flex w-full items-center gap-4">
                <Skeleton className="size-16 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="mt-2.5 h-3 w-28" />
                </div>
            </div>
            <div className="mt-4 flex flex-col gap-3 border-t border-[var(--act-edge)] pt-4">
                {Array.from({ length: rows }, (_, index) => (
                    <div key={index} className="flex items-center gap-3 px-2">
                        <Skeleton className="size-7 shrink-0 rounded-full" />
                        <Skeleton className="h-3 min-w-0 flex-1" />
                        <Skeleton className="h-3 w-16 shrink-0" />
                        <Skeleton className="h-3 w-12 shrink-0" />
                    </div>
                ))}
            </div>
        </>
    );
}

export function ActivityPeopleExhibit({
    people,
    order,
    pending,
    onOrderChange
}: {
    people: ActivityPagePeople;
    order: ActivityCompanionOrder;
    pending: boolean;
    onOrderChange: (next: ActivityCompanionOrder) => void;
}) {
    const { t } = useTranslation();
    const userIds = useMemo(
        () => people.companions.map((row) => row.userId),
        [people.companions]
    );
    const avatarOf = useActivityUserAvatars(userIds);
    const [lead, ...rest] = people.companions;
    const leadValue = lead
        ? order === 'days'
            ? lead.coDays
            : lead.minutes
        : 0;

    if (!lead) {
        return null;
    }

    const open = (row: ActivityPageCompanionRow) =>
        openUserDialog({ userId: row.userId, title: row.displayName });
    const hoursUnit = t('view.activity.unit.hours');

    return (
        <Exhibit
            label={t('view.activity.section.companions')}
            caption={t('view.activity.people.encountered_total', {
                count: people.encounteredCount
            })}
            aside={
                <OptionSegmented
                    value={order}
                    onValueChange={onOrderChange}
                    options={[
                        {
                            value: 'minutes',
                            label: t('view.activity.people.order_minutes')
                        },
                        {
                            value: 'days',
                            label: t('view.activity.people.order_days')
                        }
                    ]}
                />
            }
            footer={
                pending ? undefined : (
                    <ActivityFadingList rows={people.fading} />
                )
            }
        >
            {pending ? (
                <PeopleSkeleton rows={rest.length} />
            ) : (
                <>
                    <UserHoverCard userId={lead.userId} side="bottom">
                        <button
                            type="button"
                            onClick={() => open(lead)}
                            className="flex w-full items-center gap-4 text-left transition-opacity duration-100 ease-out hover:opacity-85 active:opacity-70"
                        >
                            <Face
                                url={avatarOf(lead.userId)}
                                className="size-16"
                            />
                            <span className="min-w-0 flex-1">
                                <span className="text-foreground block truncate text-xl font-semibold tracking-[-0.015em]">
                                    {lead.displayName || lead.userId}
                                </span>
                                <span className="text-muted-foreground mt-1.5 block text-xs tabular-nums">
                                    {t('view.activity.people.lead_caption', {
                                        days: lead.coDays,
                                        hours: hours(lead.minutes)
                                    })}
                                </span>
                            </span>
                        </button>
                    </UserHoverCard>

                    {rest.length > 0 ? (
                        <div className="mt-4 flex flex-col border-t border-[var(--act-edge)] pt-2">
                            {rest.map((row) => {
                                const value =
                                    order === 'days' ? row.coDays : row.minutes;
                                const share =
                                    leadValue > 0
                                        ? Math.max(
                                              2,
                                              Math.round(
                                                  (value / leadValue) * 100
                                              )
                                          )
                                        : 0;
                                return (
                                    <UserHoverCard
                                        key={row.userId || row.displayName}
                                        userId={row.userId}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => open(row)}
                                            className="-mx-2 flex items-center gap-3 px-2 py-1.5 text-left transition-colors duration-100 ease-out hover:bg-[var(--act-track)]"
                                        >
                                            <Face
                                                url={avatarOf(row.userId)}
                                                className="size-7"
                                            />
                                            <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                                                {row.displayName || row.userId}
                                            </span>
                                            <span
                                                aria-hidden="true"
                                                className="hidden h-1 w-16 shrink-0 bg-[var(--act-track)] sm:block"
                                            >
                                                <span
                                                    className="block h-full bg-[var(--act-heat-2)]"
                                                    style={{
                                                        width: `${share}%`
                                                    }}
                                                />
                                            </span>
                                            <span
                                                className={cn(
                                                    'shrink-0 text-xs tabular-nums',
                                                    order === 'days'
                                                        ? 'text-foreground font-medium'
                                                        : 'text-muted-foreground'
                                                )}
                                            >
                                                {t(
                                                    'view.activity.people.co_days',
                                                    {
                                                        count: row.coDays
                                                    }
                                                )}
                                            </span>
                                            <span
                                                className={cn(
                                                    'w-16 shrink-0 text-right text-xs tabular-nums',
                                                    order === 'minutes'
                                                        ? 'text-foreground font-medium'
                                                        : 'text-muted-foreground'
                                                )}
                                            >
                                                {hours(row.minutes)}
                                                {hoursUnit}
                                            </span>
                                        </button>
                                    </UserHoverCard>
                                );
                            })}
                        </div>
                    ) : null}
                </>
            )}
        </Exhibit>
    );
}
