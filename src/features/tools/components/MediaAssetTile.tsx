import {
    CheckIcon,
    MoreHorizontalIcon,
    ImageIcon,
    type LucideIcon
} from 'lucide-react';
import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { useRef } from 'react';

import { FadeInImage } from '@/components/media/FadeInImage';
import { TileLockOverlay } from '@/components/tile/TileLockOverlay';
import { TileShell } from '@/components/tile/TileShell';
import { cn } from '@/lib/utils';
import {
    TILE_CHECK,
    TILE_LOCKED,
    TILE_MOTION,
    TILE_SELECT_BOX,
    TILE_SELECT_OVERLAY_SHIFT,
    TILE_SELECT_OVERLAY_SHIFT_ACTIVE,
    TILE_SELECT_TOGGLE,
    TILE_SELECT_TOGGLE_VISIBLE
} from '@/shared/constants/selectableTile';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent } from '@/ui/shadcn/card';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

export type MediaAssetBadge = {
    key?: string;
    label: string;
    variant?: ComponentProps<typeof Badge>['variant'];
};

export type MediaAssetAction = {
    key?: string;
    label: string;
    icon?: LucideIcon;
    destructive?: boolean;
    disabled?: boolean;
    variant?: ComponentProps<typeof Button>['variant'];
    onClick?: () => void;
    onSelect?: () => void;
};

export type MediaAssetMeta = {
    key?: string;
    label: string;
    title?: string;
};

export type MediaPreviewOptions = {
    id?: string;
    url: string;
    title: string;
};

export function shortAssetId(value: string) {
    const text = value.trim();
    if (!text) {
        return '';
    }
    if (text.length <= 18) {
        return text;
    }
    return `${text.slice(0, 10)}...${text.slice(-6)}`;
}

function renderIcon(Icon?: LucideIcon) {
    return Icon ? <Icon data-icon="inline-start" /> : null;
}

function TileActionsMenu({
    actions = [],
    label
}: {
    actions?: Array<MediaAssetAction | null>;
    label?: string;
}) {
    const visibleActions = actions.filter(
        (action): action is MediaAssetAction => Boolean(action)
    );
    if (!visibleActions.length) {
        return null;
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        variant="secondary"
                        size="icon-sm"
                        className="bg-background/70"
                        aria-label={label}
                    >
                        <MoreHorizontalIcon data-icon="inline-start" />
                    </Button>
                }
            />
            <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuGroup>
                    {visibleActions.map((action) => (
                        <DropdownMenuItem
                            key={action.key || action.label}
                            variant={
                                action.destructive ? 'destructive' : 'default'
                            }
                            disabled={action.disabled}
                            closeOnClick={false}
                            onClick={(event) => {
                                event.preventDefault();
                                action.onSelect?.();
                            }}
                        >
                            {renderIcon(action.icon)}
                            {action.label}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function MediaAssetTile({
    title,
    subtitle,
    meta,
    badges,
    imageUrl,
    alt,
    aspectClass = 'aspect-square',
    imageFit = 'cover',
    imagePosition = 'center',
    fadeIn = true,
    isCurrent = false,
    locked = false,
    currentLabel,
    menuLabel,
    placeholderIcon: PlaceholderIcon = ImageIcon,
    renderMedia,
    onPreview,
    onMediaClick,
    mediaHoverLabel,
    primaryAction,
    menuActions,
    className,
    contentClassName,
    hideContent = false,
    selectable = false,
    selected = false,
    selectionActive = false,
    selectLabel,
    onToggleSelect
}: {
    title?: string;
    subtitle?: string;
    meta?: MediaAssetMeta | MediaAssetMeta[];
    badges?: Array<MediaAssetBadge | null>;
    imageUrl?: string;
    alt?: string;
    aspectClass?: string;
    imageFit?: 'cover' | 'contain';
    imagePosition?: 'center' | 'top';
    fadeIn?: boolean;
    isCurrent?: boolean;
    locked?: boolean;
    currentLabel?: string;
    menuLabel?: string;
    placeholderIcon?: LucideIcon;
    renderMedia?: ((options: { className: string }) => ReactNode) | null;
    onPreview?: () => void;
    onMediaClick?: () => void;
    mediaHoverLabel?: string;
    primaryAction?: MediaAssetAction | null;
    menuActions?: Array<MediaAssetAction | null>;
    className?: string;
    contentClassName?: string;
    hideContent?: boolean;
    selectable?: boolean;
    selected?: boolean;
    selectionActive?: boolean;
    selectLabel?: string;
    onToggleSelect?: (checked: boolean, shift: boolean) => void;
}) {
    const shiftPressedRef = useRef(false);
    const safeTitle = String(title || '').trim();
    const safeSubtitle = String(subtitle || '').trim();
    const safeMeta = Array.isArray(meta) ? meta : meta ? [meta] : [];
    const safeBadges = (badges || []).filter(
        (badge): badge is MediaAssetBadge => Boolean(badge)
    );
    const resolvedPrimaryAction = primaryAction?.label ? primaryAction : null;
    const isSelectionActive = selectable && selectionActive;
    const previewClick = onMediaClick || onPreview;
    const handleMediaClick =
        selectable && isSelectionActive
            ? (event: MouseEvent<HTMLButtonElement>) => {
                  onToggleSelect?.(!selected, event.shiftKey);
              }
            : previewClick
              ? () => previewClick()
              : undefined;
    const imageClassName = cn(
        'size-full',
        imageFit === 'contain' ? 'object-contain' : 'object-cover',
        imagePosition === 'top' && 'object-top'
    );

    return (
        <TileShell
            selected={isCurrent || selected}
            className={cn(
                'group/tile gap-0 py-0 data-[size=sm]:gap-0 data-[size=sm]:py-0',
                className
            )}
            render={<Card size="sm" />}
        >
            <div className="relative">
                <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                        'block h-auto w-full rounded-none p-0 focus-visible:ring-inset',
                        TILE_MOTION
                    )}
                    onClick={
                        isSelectionActive || imageUrl || renderMedia
                            ? handleMediaClick
                            : undefined
                    }
                >
                    <div
                        className={cn(
                            'bg-muted/30 text-muted-foreground flex w-full items-center justify-center overflow-hidden',
                            aspectClass,
                            locked && TILE_LOCKED
                        )}
                    >
                        {renderMedia ? (
                            renderMedia({
                                className: imageClassName
                            })
                        ) : imageUrl ? (
                            <FadeInImage
                                src={imageUrl}
                                fade={fadeIn}
                                alt={alt || safeTitle}
                                loading="lazy"
                                className={imageClassName}
                                fallback={
                                    <PlaceholderIcon className="size-8" />
                                }
                            />
                        ) : (
                            <PlaceholderIcon className="size-8" />
                        )}
                    </div>
                </Button>
                {locked ? <TileLockOverlay /> : null}
                {selectable ? (
                    <span
                        role="presentation"
                        className={cn(
                            TILE_SELECT_TOGGLE,
                            (selected || isSelectionActive) &&
                                TILE_SELECT_TOGGLE_VISIBLE
                        )}
                        onClickCapture={(event: MouseEvent<HTMLElement>) => {
                            shiftPressedRef.current = event.shiftKey;
                        }}
                    >
                        <Checkbox
                            className={TILE_SELECT_BOX}
                            aria-label={selectLabel}
                            checked={selected}
                            onCheckedChange={(checked) =>
                                onToggleSelect?.(
                                    Boolean(checked),
                                    shiftPressedRef.current
                                )
                            }
                        />
                    </span>
                ) : null}
                <div
                    className={cn(
                        'pointer-events-none absolute top-2 flex flex-wrap gap-1',
                        selectable ? TILE_SELECT_OVERLAY_SHIFT : 'left-2',
                        selectable &&
                            (selected || isSelectionActive) &&
                            TILE_SELECT_OVERLAY_SHIFT_ACTIVE
                    )}
                >
                    {isCurrent && currentLabel ? (
                        <span
                            role="img"
                            aria-label={currentLabel}
                            className={TILE_CHECK}
                        >
                            <CheckIcon className="size-3" />
                        </span>
                    ) : null}
                    {safeBadges.map((badge) => (
                        <Badge
                            key={badge.key || badge.label}
                            variant={badge.variant || 'outline'}
                            className="bg-background/80"
                        >
                            {badge.label}
                        </Badge>
                    ))}
                </div>
                {mediaHoverLabel ? (
                    <div
                        className={cn(
                            'bg-background/85 text-foreground pointer-events-none absolute top-2 hidden max-w-[calc(100%-3rem)] rounded-sm px-1.5 py-0.5 text-xs font-medium group-hover/tile:block',
                            selectable ? 'left-9' : 'left-2'
                        )}
                    >
                        {mediaHoverLabel}
                    </div>
                ) : null}
                <div className="absolute top-2 right-2">
                    <TileActionsMenu actions={menuActions} label={menuLabel} />
                </div>
            </div>
            {hideContent ? null : (
                <CardContent
                    className={cn(
                        'flex min-h-20 items-start gap-2 p-2.5',
                        contentClassName
                    )}
                >
                    <div className="min-w-0 flex-1">
                        {safeTitle ? (
                            <div
                                className="truncate text-sm font-medium"
                                title={safeTitle}
                            >
                                {safeTitle}
                            </div>
                        ) : null}
                        {safeSubtitle ? (
                            <div
                                className="text-muted-foreground truncate font-mono text-xs"
                                title={safeSubtitle}
                            >
                                {safeSubtitle}
                            </div>
                        ) : null}
                        {safeMeta.map((item) => (
                            <div
                                key={item.key || item.label}
                                className="text-muted-foreground truncate text-xs"
                                title={item.title || item.label}
                            >
                                {item.label}
                            </div>
                        ))}
                    </div>
                    {resolvedPrimaryAction ? (
                        <Button
                            type="button"
                            variant={resolvedPrimaryAction.variant || 'outline'}
                            size="sm"
                            className="shrink-0"
                            disabled={resolvedPrimaryAction.disabled}
                            onClick={resolvedPrimaryAction.onClick}
                        >
                            {renderIcon(resolvedPrimaryAction.icon)}
                            {resolvedPrimaryAction.label}
                        </Button>
                    ) : null}
                </CardContent>
            )}
        </TileShell>
    );
}
