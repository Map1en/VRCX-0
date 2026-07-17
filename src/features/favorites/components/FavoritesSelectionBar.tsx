import { CopyIcon, MoveRightIcon, Trash2Icon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

import type { FavoriteGroup } from '../favoritesTypes';
import { isFavoriteMoveTargetOverCapacity } from '../favoriteTransfer';

type FavoritesSelectionBarProps = {
    selectedCount: number;
    isAllSelected: boolean;
    moveTargets: FavoriteGroup[];
    copyTargets: FavoriteGroup[];
    showCopyIdsButton: boolean;
    actionsDisabled: boolean;
    onSelectAll(): void;
    onClearSelection(): void;
    onCopyIds(): void;
    onCopySelection(target: FavoriteGroup): void;
    onMoveSelection(target: FavoriteGroup): void;
    onBulkRemove(): void;
};

function favoriteMoveTargetLabel(target: FavoriteGroup): string {
    if (typeof target.capacity === 'number' && target.capacity > 0) {
        return `${target.label} (${target.count ?? 0}/${target.capacity})`;
    }
    if (typeof target.count === 'number') {
        return `${target.label} (${target.count})`;
    }
    return target.label;
}

function FavoriteTransferTargetsMenu({
    icon,
    triggerLabel,
    triggerTitle,
    listLabel,
    targets,
    selectedCount,
    actionsDisabled,
    onSelect
}: {
    icon: ReactNode;
    triggerLabel: string;
    triggerTitle?: string;
    listLabel: string;
    targets: FavoriteGroup[];
    selectedCount: number;
    actionsDisabled: boolean;
    onSelect(target: FavoriteGroup): void;
}) {
    const remoteTargets = targets.filter(
        (target) => target.source === 'remote'
    );
    const localTargets = targets.filter((target) => target.source === 'local');
    const showSeparator = remoteTargets.length > 0 && localTargets.length > 0;

    function renderTargetItems(items: FavoriteGroup[], prefix: string) {
        return items.map((target) => (
            <DropdownMenuItem
                key={`${prefix}:${target.key}`}
                disabled={isFavoriteMoveTargetOverCapacity(
                    target,
                    selectedCount
                )}
                onClick={() => onSelect(target)}
            >
                {favoriteMoveTargetLabel(target)}
            </DropdownMenuItem>
        ));
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={actionsDisabled || targets.length === 0}
                        title={triggerTitle}
                    >
                        {icon}
                        {triggerLabel}
                    </Button>
                }
            />
            <DropdownMenuContent align="center" className="w-64">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>{listLabel}</DropdownMenuLabel>
                    {renderTargetItems(remoteTargets, 'remote')}
                    {showSeparator ? <DropdownMenuSeparator /> : null}
                    {renderTargetItems(localTargets, 'local')}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function FavoritesSelectionBar({
    selectedCount,
    isAllSelected,
    moveTargets,
    copyTargets,
    showCopyIdsButton,
    actionsDisabled,
    onSelectAll,
    onClearSelection,
    onCopyIds,
    onCopySelection,
    onMoveSelection,
    onBulkRemove
}: FavoritesSelectionBarProps) {
    const { t } = useTranslation();

    if (selectedCount === 0) {
        return null;
    }

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-2">
            <div className="bg-popover text-popover-foreground pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm shadow-lg">
                <span className="text-muted-foreground px-1.5 font-medium whitespace-nowrap">
                    {t('view.favorite.selection.count', {
                        count: selectedCount
                    })}
                </span>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onSelectAll}
                >
                    {isAllSelected
                        ? t('view.favorite.deselect_all')
                        : t('view.favorite.select_all')}
                </Button>
                {showCopyIdsButton ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={actionsDisabled}
                        onClick={onCopyIds}
                    >
                        <CopyIcon data-icon="inline-start" />
                        {t('view.favorite.action.copy_ids')}
                    </Button>
                ) : null}
                <FavoriteTransferTargetsMenu
                    icon={<CopyIcon data-icon="inline-start" />}
                    triggerLabel={t('view.favorite.action.copy_to')}
                    triggerTitle={t(
                        'view.favorite.label.online_favorites_copy_hint'
                    )}
                    listLabel={t('view.favorite.action.copy_to')}
                    targets={copyTargets}
                    selectedCount={selectedCount}
                    actionsDisabled={actionsDisabled}
                    onSelect={onCopySelection}
                />
                <FavoriteTransferTargetsMenu
                    icon={<MoveRightIcon data-icon="inline-start" />}
                    triggerLabel={t('view.favorite.action.move')}
                    listLabel={t('view.favorite.action.move_to')}
                    targets={moveTargets}
                    selectedCount={selectedCount}
                    actionsDisabled={actionsDisabled}
                    onSelect={onMoveSelection}
                />
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={actionsDisabled}
                    onClick={onBulkRemove}
                >
                    <Trash2Icon data-icon="inline-start" />
                    {t('view.favorite.bulk_unfavorite')}
                </Button>
                <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="rounded-full"
                    aria-label={t('common.actions.clear')}
                    onClick={onClearSelection}
                >
                    <XIcon data-icon="icon" />
                </Button>
            </div>
        </div>
    );
}

export { FavoritesSelectionBar };
