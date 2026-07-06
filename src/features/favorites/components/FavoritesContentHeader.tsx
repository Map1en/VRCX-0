import { CopyIcon, MoveRightIcon, Trash2Icon } from 'lucide-react';
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
import { Switch } from '@/ui/shadcn/switch';

import type { FavoriteGroup } from '../favoritesTypes';

type FavoritesContentHeaderProps = {
    title: string;
    subtitle: string;
    editMode: boolean;
    editModeDisabled: boolean;
    editModeVisible: boolean;
    isAllSelected: boolean;
    hasSelection: boolean;
    moveTargets: FavoriteGroup[];
    showCopyButton: boolean;
    onEditModeChange(value: boolean): void;
    onToggleSelectAll(): void;
    onClearSelection(): void;
    onCopySelection(): void;
    onMoveSelection(target: FavoriteGroup): void;
    onBulkRemove(): void;
};

function FavoritesContentHeader({
    title,
    subtitle,
    editMode,
    editModeDisabled,
    editModeVisible,
    isAllSelected,
    hasSelection,
    moveTargets,
    showCopyButton,
    onEditModeChange,
    onToggleSelectAll,
    onClearSelection,
    onCopySelection,
    onMoveSelection,
    onBulkRemove
}: FavoritesContentHeaderProps) {
    const { t } = useTranslation();
    const remoteMoveTargets = moveTargets.filter(
        (target) => target.source === 'remote'
    );
    const localMoveTargets = moveTargets.filter(
        (target) => target.source === 'local'
    );
    const hasMoveTargets = moveTargets.length > 0;
    const showMoveSeparator =
        remoteMoveTargets.length > 0 && localMoveTargets.length > 0;

    return (
        <>
            <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5 pl-0.5 text-base font-semibold">
                    <span className="truncate">{title}</span>
                    {subtitle ? (
                        <small className="text-muted-foreground truncate text-xs font-normal">
                            {subtitle}
                        </small>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-sm">
                    <span>{t('view.favorite.action.edit_mode')}</span>
                    <Switch
                        checked={editMode}
                        disabled={editModeDisabled}
                        onCheckedChange={onEditModeChange}
                    />
                </div>
            </div>
            <div className="flex min-w-0 items-center justify-end">
                {editModeVisible ? (
                    <div className="mb-3 flex min-w-0 flex-wrap justify-end gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={onToggleSelectAll}
                        >
                            {isAllSelected
                                ? t('view.favorite.deselect_all')
                                : t('view.favorite.select_all')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={!hasSelection}
                            onClick={onClearSelection}
                        >
                            {t('common.actions.clear')}
                        </Button>
                        {showCopyButton ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={!hasSelection}
                                onClick={onCopySelection}
                            >
                                <CopyIcon data-icon="inline-start" />
                                {t('common.actions.copy')}
                            </Button>
                        ) : null}
                        <DropdownMenu>
                            <DropdownMenuTrigger
                                render={
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={
                                            !hasSelection || !hasMoveTargets
                                        }
                                    >
                                        <MoveRightIcon data-icon="inline-start" />
                                        {t('view.favorite.action.move')}
                                    </Button>
                                }
                            />
                            <DropdownMenuContent align="end" className="w-64">
                                <DropdownMenuLabel>
                                    {t('view.favorite.action.move_to')}
                                </DropdownMenuLabel>
                                <DropdownMenuGroup>
                                    {remoteMoveTargets.map((target) => (
                                        <DropdownMenuItem
                                            key={`remote:${target.key}`}
                                            onClick={() =>
                                                onMoveSelection(target)
                                            }
                                        >
                                            {target.label}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuGroup>
                                {showMoveSeparator ? (
                                    <DropdownMenuSeparator />
                                ) : null}
                                <DropdownMenuGroup>
                                    {localMoveTargets.map((target) => (
                                        <DropdownMenuItem
                                            key={`local:${target.key}`}
                                            onClick={() =>
                                                onMoveSelection(target)
                                            }
                                        >
                                            {target.label}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!hasSelection}
                            onClick={onBulkRemove}
                        >
                            <Trash2Icon data-icon="inline-start" />
                            {t('view.favorite.bulk_unfavorite')}
                        </Button>
                    </div>
                ) : null}
            </div>
        </>
    );
}

export { FavoritesContentHeader };
