import {
    FileArchiveIcon,
    FolderTreeIcon,
    LayersIcon,
    StarIcon,
    StarOffIcon,
    Trash2Icon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SelectionActionBar } from '@/components/layout/SelectionActionBar';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

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
            <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={actionsDisabled || deletableCount === 0}
                title={
                    deletableCount === 0
                        ? t('view.tools.gallery_selection.delete_locked')
                        : undefined
                }
                onClick={onDelete}
            >
                <Trash2Icon data-icon="inline-start" />
                {deletableCount < selectedCount
                    ? t('view.tools.gallery_selection.delete_unlocked', {
                          count: deletableCount
                      })
                    : t('common.actions.delete')}
            </Button>
        </SelectionActionBar>
    );
}
