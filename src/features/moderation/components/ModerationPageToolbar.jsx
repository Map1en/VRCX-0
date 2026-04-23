import { RefreshCwIcon } from 'lucide-react';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import { PageToolbarRow } from '@/components/layout/PageScaffold.jsx';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

import { ModerationTypeFilterDropdown } from './ModerationViewParts.jsx';

export function ModerationPageToolbar({
    selectedTypes,
    onSelectedTypesChange,
    getModerationTypeLabel,
    normalizeSelectedTypes,
    searchQuery,
    onSearchQueryChange,
    detail,
    currentUserId,
    loadStatus,
    onRefresh,
    table,
    t
}) {
    return (
        <>
            <PageToolbarRow>
                <ModerationTypeFilterDropdown
                    value={selectedTypes}
                    onChange={onSelectedTypesChange}
                    getTypeLabel={getModerationTypeLabel}
                    sanitizeTypes={normalizeSelectedTypes}
                />
                <Input
                    value={searchQuery}
                    onChange={(event) => onSearchQueryChange(event.target.value)}
                    placeholder={t('common.actions.search')}
                    className="h-9 min-w-32 flex-1 sm:max-w-40"
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('common.actions.refresh')}
                    disabled={!currentUserId || loadStatus === 'running'}
                    onClick={onRefresh}
                >
                    {loadStatus === 'running' ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <RefreshCwIcon data-icon="inline-start" />
                    )}
                </Button>
                <TableColumnVisibilityMenu table={table} />
            </PageToolbarRow>

            {detail ? (
                <div className="text-muted-foreground text-sm">{detail}</div>
            ) : null}
        </>
    );
}
