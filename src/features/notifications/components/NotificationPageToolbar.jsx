import { RefreshCcwIcon } from 'lucide-react';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

import { NotificationTypeFilterDropdown } from './NotificationViewParts.jsx';

export function NotificationPageToolbar({
    activeTypes,
    searchQuery,
    notificationTypeLabel,
    loadStatus,
    table,
    onActiveTypesChange,
    onSearchQueryChange,
    onRefresh,
    onClearFilters,
    t
}) {
    const refreshLabel = t('view.notification.refresh_tooltip');

    return (
        <div className="flex flex-wrap items-center gap-2">
            <NotificationTypeFilterDropdown
                value={activeTypes}
                onChange={onActiveTypesChange}
                getTypeLabel={notificationTypeLabel}
            />
            <Input
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                placeholder={t('common.actions.search')}
                className="h-9 min-w-36 flex-1 sm:max-w-52"
            />
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={refreshLabel}
                title={refreshLabel}
                className="rounded-full"
                disabled={loadStatus === 'running'}
                onClick={onRefresh}
            >
                {loadStatus === 'running' ? (
                    <Spinner data-icon="inline-start" />
                ) : (
                    <RefreshCcwIcon data-icon="inline-start" />
                )}
            </Button>
            <TableColumnVisibilityMenu table={table} />
            {activeTypes.length ? (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onClearFilters}
                >
                    {t('common.actions.clear')}
                </Button>
            ) : null}
        </div>
    );
}
