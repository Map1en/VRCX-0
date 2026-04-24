import { CopyIcon, Trash2Icon } from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/shadcn/button';

import { Switch } from '@/ui/shadcn/switch';

function FavoritesContentHeader({
    title,
    subtitle,
    editMode,
    editModeDisabled,
    editModeVisible,
    isAllSelected,
    hasSelection,
    showCopyButton,
    onEditModeChange,
    onToggleSelectAll,
    onClearSelection,
    onCopySelection,
    onBulkRemove
}) {
    const { t } = useTranslation();

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
                    <span>{t('view.favorite.generated.edit_mode')}</span>
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
                            {isAllSelected ? 'Deselect All' : 'Select All'}
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
