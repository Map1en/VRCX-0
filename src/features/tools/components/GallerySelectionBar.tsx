import {
    FileArchiveIcon,
    FolderTreeIcon,
    LayersIcon,
    StarIcon,
    StarOffIcon,
    Trash2Icon
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { SelectionActionBar } from '@/components/layout/SelectionActionBar';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

type GallerySelectionBarProps = {
    selectedCount: number;
    deletableCount: number;
    isAllSelected: boolean;
    actionsDisabled: boolean;
    favoriteActions?: {
        onFavorite(): void;
        onUnfavorite(): void;
    };
    exportAction?: {
        onExport(groupByFolder: boolean): void;
    };
    children?: ReactNode;
    onSelectAll(): void;
    onClearSelection(): void;
    onDelete(): void;
};

export function GallerySelectionBar({
    selectedCount,
    deletableCount,
    isAllSelected,
    actionsDisabled,
    favoriteActions,
    exportAction,
    children,
    onSelectAll,
    onClearSelection,
    onDelete
}: GallerySelectionBarProps) {
    const { t } = useTranslation();

    if (selectedCount === 0) {
        return null;
    }

    return (
        <SelectionActionBar
            status={t('view.tools.gallery_selection.count', {
                count: selectedCount
            })}
            selectAllLabel={
                isAllSelected
                    ? t('view.tools.gallery_selection.deselect_all')
                    : t('view.tools.gallery_selection.select_all')
            }
            clearLabel={t('common.actions.clear')}
            onSelectAll={onSelectAll}
            onClearSelection={onClearSelection}
        >
            {favoriteActions ? (
                <>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={actionsDisabled}
                        onClick={favoriteActions.onFavorite}
                    >
                        <StarIcon data-icon="inline-start" />
                        {t('view.tools.prints_favorites.favorite')}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={actionsDisabled}
                        onClick={favoriteActions.onUnfavorite}
                    >
                        <StarOffIcon data-icon="inline-start" />
                        {t('view.tools.prints_favorites.unfavorite')}
                    </Button>
                </>
            ) : null}
            {exportAction ? (
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={actionsDisabled}
                            >
                                <FileArchiveIcon data-icon="inline-start" />
                                {t('view.tools.gallery_selection.export_zip')}
                            </Button>
                        }
                    />
                    <DropdownMenuContent
                        side="top"
                        align="center"
                        className="w-auto"
                    >
                        <DropdownMenuItem
                            onClick={() => exportAction.onExport(true)}
                        >
                            <FolderTreeIcon data-icon="inline-start" />
                            {t('view.tools.gallery_selection.export_grouped')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => exportAction.onExport(false)}
                        >
                            <LayersIcon data-icon="inline-start" />
                            {t('view.tools.gallery_selection.export_flat')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
            {children}
            <Tooltip disabled={deletableCount !== 0}>
                <TooltipTrigger
                    render={
                        <span
                            className="inline-flex"
                            tabIndex={deletableCount === 0 ? 0 : undefined}
                        />
                    }
                >
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={actionsDisabled || deletableCount === 0}
                        onClick={onDelete}
                    >
                        <Trash2Icon data-icon="inline-start" />
                        {deletableCount < selectedCount
                            ? t(
                                  'view.tools.gallery_selection.delete_unlocked',
                                  {
                                      count: deletableCount
                                  }
                              )
                            : t('common.actions.delete')}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    {t('view.tools.gallery_selection.delete_locked')}
                </TooltipContent>
            </Tooltip>
        </SelectionActionBar>
    );
}
