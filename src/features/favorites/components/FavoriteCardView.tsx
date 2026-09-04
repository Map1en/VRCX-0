import {
    LockIcon,
    Trash2Icon,
    TriangleAlertIcon,
    type LucideIcon
} from 'lucide-react';
import type {
    HTMLAttributes,
    KeyboardEvent,
    MouseEvent,
    ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location';
import { FadeInImage } from '@/components/media/FadeInImage';
import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { UserStatusDot } from '@/components/UserStatusDot';
import { TILE_SELECTED } from '@/lib/selectableTile';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';

import type { FavoritesDensityConfig } from '../favoritesDensity';
import type { FavoriteItem } from '../favoritesTypes';

export interface FavoriteCardViewModel {
    item: FavoriteItem;
    density: FavoritesDensityConfig;
    selected: boolean;
    isFriend: boolean;
    isWornAvatar: boolean;
    showPlayerCountBadge: boolean;
    friendShowsLocation: boolean;
    friendLocation: string;
    statusDotClassName: string;
    icon: LucideIcon;
    friendHoverCard: {
        userId: string;
        seed: FavoriteItem['seedData'] | null;
        disabled: boolean;
    };
}

export interface FavoriteCardViewSlots {
    selection: ReactNode;
    actions: ReactNode;
    groupLabel: ReactNode;
}

export interface FavoriteCardViewInteractions {
    shell: HTMLAttributes<HTMLDivElement>;
    stop: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void;
    copyWorldId: () => void;
}

export function FavoriteCardView({
    model,
    slots,
    interactions
}: {
    model: FavoriteCardViewModel;
    slots: FavoriteCardViewSlots;
    interactions: FavoriteCardViewInteractions;
}) {
    const { t } = useTranslation();
    const {
        item,
        density,
        selected,
        isFriend,
        isWornAvatar,
        showPlayerCountBadge,
        friendShowsLocation,
        friendLocation,
        statusDotClassName,
        icon: Icon,
        friendHoverCard
    } = model;

    if (density.layout === 'cover') {
        const showUnavailableCopyId =
            item.isUnavailable && item.kind === 'world' && Boolean(item.id);

        return (
            <div
                className={cn(
                    'group/fav-card hover:bg-muted flex h-full w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-lg border text-sm transition-colors',
                    selected && TILE_SELECTED
                )}
                {...interactions.shell}
            >
                <div
                    className={cn(
                        'bg-muted relative w-full shrink-0 overflow-hidden',
                        item.isUnavailable && 'opacity-60 grayscale'
                    )}
                    style={{ aspectRatio: String(density.imageAspectRatio) }}
                >
                    {item.imageUrl && !item.isUnavailable ? (
                        <FadeInImage
                            src={
                                density.value === 'compact'
                                    ? item.imageSmallUrl || item.imageUrl
                                    : item.imageUrl
                            }
                            alt={item.title || ''}
                            loading="lazy"
                            className="size-full object-cover"
                            fallback={
                                <span className="flex size-full items-center justify-center">
                                    <Icon className="text-muted-foreground size-8" />
                                </span>
                            }
                        />
                    ) : (
                        <span className="flex size-full items-center justify-center">
                            <Icon className="text-muted-foreground size-8" />
                        </span>
                    )}
                    {showPlayerCountBadge ? (
                        <span
                            className={cn(
                                'bg-background/55 text-foreground/75 absolute top-1.5 left-1.5 z-10 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-normal tabular-nums backdrop-blur-[2px] transition-opacity',
                                'group-hover/fav-card:opacity-0',
                                selected && 'opacity-0'
                            )}
                        >
                            <span className="size-1.5 rounded-full bg-[var(--status-online)]" />
                            {item.playerCount}
                        </span>
                    ) : null}
                    {slots.selection}
                    {slots.actions ? (
                        <span
                            role="presentation"
                            className="absolute top-1.5 right-1.5 z-10"
                            onClick={interactions.stop}
                            onKeyDown={interactions.stop}
                        >
                            {slots.actions}
                        </span>
                    ) : null}
                    {isWornAvatar ? (
                        <span className="bg-background/80 text-foreground absolute bottom-1.5 left-1.5 z-10 rounded-full px-1.5 py-0.5 text-xs font-medium">
                            {t('dialog.avatar.actions.current_avatar')}
                        </span>
                    ) : null}
                    {item.isDeleted || item.isPrivate ? (
                        <span className="bg-background/80 absolute right-1.5 bottom-1.5 z-10 flex size-5 items-center justify-center rounded-full">
                            {item.isDeleted ? (
                                <Trash2Icon className="text-muted-foreground size-3.5" />
                            ) : (
                                <LockIcon className="text-muted-foreground size-3.5" />
                            )}
                        </span>
                    ) : null}
                </div>
                <div className="flex min-h-0 flex-1 flex-col justify-center gap-0.5 px-2.5 py-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <UserHoverCard {...friendHoverCard}>
                            <span
                                className="truncate font-medium"
                                style={
                                    item.titleColor
                                        ? { color: item.titleColor }
                                        : undefined
                                }
                            >
                                {item.title}
                            </span>
                        </UserHoverCard>
                        {item.isUnavailable ? (
                            <TriangleAlertIcon className="text-destructive size-4 shrink-0" />
                        ) : item.isDeleted ? (
                            <Trash2Icon className="text-muted-foreground size-4 shrink-0" />
                        ) : null}
                    </div>
                    {showUnavailableCopyId ? (
                        <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            className="w-fit"
                            onClick={(event) => {
                                interactions.stop(event);
                                interactions.copyWorldId();
                            }}
                        >
                            {t('dialog.world.info.copy_id')}
                        </Button>
                    ) : (
                        <div className="text-muted-foreground truncate text-xs">
                            {item.subtitle}
                        </div>
                    )}
                    {slots.groupLabel}
                </div>
            </div>
        );
    }

    if (!isFriend && density.value === 'compact') {
        return (
            <div
                className={cn(
                    'object-row object-row--interactive object-row--focusable group/fav-card flex h-full w-full cursor-pointer text-sm',
                    selected && TILE_SELECTED
                )}
                {...interactions.shell}
            >
                {slots.selection}
                <div className="object-row__media">
                    <span className="flex size-full items-center justify-center overflow-hidden">
                        {item.imageSmallUrl || item.imageUrl ? (
                            <FadeInImage
                                src={item.imageSmallUrl || item.imageUrl}
                                alt={item.title || ''}
                                loading="lazy"
                                className="size-full object-cover"
                                fallback={
                                    <Icon className="text-muted-foreground size-4" />
                                }
                            />
                        ) : (
                            <Icon className="text-muted-foreground size-4" />
                        )}
                    </span>
                    <span
                        aria-hidden="true"
                        className="object-row__media-blend"
                    />
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center px-2.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <span
                            className="object-row__title truncate"
                            style={
                                item.titleColor
                                    ? { color: item.titleColor }
                                    : undefined
                            }
                        >
                            {item.title}
                        </span>
                        {item.isUnavailable ? (
                            <TriangleAlertIcon className="text-destructive size-4 shrink-0" />
                        ) : item.isDeleted ? (
                            <Trash2Icon className="text-muted-foreground size-4 shrink-0" />
                        ) : null}
                        {item.isPrivate ? (
                            <LockIcon className="text-muted-foreground size-4 shrink-0" />
                        ) : null}
                    </div>
                    <div className="object-row__meta truncate">
                        {showPlayerCountBadge ? (
                            <>
                                <span className="inline-flex items-baseline gap-1">
                                    <span className="size-1.5 shrink-0 self-center rounded-full bg-[var(--status-online)]" />
                                    {item.playerCount}
                                </span>
                                {item.subtitle ? ' · ' : ''}
                            </>
                        ) : null}
                        {item.subtitle}
                    </div>
                    {slots.groupLabel}
                </div>
                <div
                    className={cn(
                        'object-row__context-action',
                        'mr-1 flex size-8 shrink-0 items-center justify-center'
                    )}
                >
                    {slots.actions}
                </div>
            </div>
        );
    }

    return (
        <div
            className={cn(
                'group/fav-card hover:bg-muted relative flex h-full w-full min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-lg border px-2.5 py-2 text-sm transition-colors',
                selected && TILE_SELECTED
            )}
            {...interactions.shell}
        >
            {slots.selection}
            <UserHoverCard {...friendHoverCard}>
                <div
                    className={cn(
                        'relative ml-2 flex shrink-0 items-center justify-center',
                        isFriend
                            ? 'overflow-visible'
                            : 'bg-muted overflow-hidden rounded-sm'
                    )}
                    style={{
                        width: `${density.mediaWidth}px`,
                        height: `${density.mediaHeight}px`
                    }}
                >
                    <span
                        className={cn(
                            'flex size-full items-center justify-center overflow-hidden',
                            isFriend && 'bg-muted rounded-full border'
                        )}
                    >
                        {item.imageSmallUrl || item.imageUrl ? (
                            <FadeInImage
                                src={item.imageSmallUrl || item.imageUrl}
                                alt={item.title || ''}
                                loading="lazy"
                                className="size-full object-cover"
                                fallback={
                                    <Icon className="text-muted-foreground size-4" />
                                }
                            />
                        ) : (
                            <Icon className="text-muted-foreground size-4" />
                        )}
                    </span>
                    {isFriend ? (
                        <UserStatusDot
                            statusDotClassName={statusDotClassName}
                            className="absolute -right-0.5 -bottom-0.5 z-10 size-3.75"
                        />
                    ) : null}
                </div>
            </UserHoverCard>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                    <UserHoverCard {...friendHoverCard}>
                        <span
                            className="truncate font-medium"
                            style={
                                item.titleColor
                                    ? { color: item.titleColor }
                                    : undefined
                            }
                        >
                            {item.title}
                        </span>
                    </UserHoverCard>
                    {item.isUnavailable ? (
                        <TriangleAlertIcon className="text-destructive size-4 shrink-0" />
                    ) : item.isDeleted ? (
                        <Trash2Icon className="text-muted-foreground size-4 shrink-0" />
                    ) : null}
                    {item.isPrivate ? (
                        <LockIcon className="text-muted-foreground size-4 shrink-0" />
                    ) : null}
                </div>
                {friendShowsLocation ? (
                    <div
                        role="presentation"
                        className="text-muted-foreground truncate text-xs"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                    >
                        <Location
                            location={friendLocation}
                            traveling={item.travelingToLocation}
                            hint={
                                item.seedData?.worldName ||
                                item.seedData?.travelingToWorld ||
                                ''
                            }
                            grouphint={item.seedData?.groupName || ''}
                            link={false}
                            asButton={false}
                            disableTooltip
                        />
                    </div>
                ) : (
                    <div className="text-muted-foreground truncate text-xs">
                        {showPlayerCountBadge ? (
                            <>
                                <span className="inline-flex items-baseline gap-1">
                                    <span className="size-1.5 shrink-0 self-center rounded-full bg-[var(--status-online)]" />
                                    {item.playerCount}
                                </span>
                                {item.subtitle ? ' · ' : ''}
                            </>
                        ) : null}
                        {item.subtitle}
                    </div>
                )}
                {slots.groupLabel}
            </div>
            <div className="flex size-8 shrink-0 items-center justify-center">
                {slots.actions}
            </div>
        </div>
    );
}
