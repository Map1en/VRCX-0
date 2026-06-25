import { RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import { PageToolbarRow } from '@/components/layout/PageScaffold';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    normalizeModerationSelectedTypes,
    resolveModerationTypeLabel
} from '../moderationPageState';
import type { ModerationLoadStatus } from '../moderationPageTypes';
import { ModerationTypeFilterDropdown } from './ModerationViewParts';

type ModerationPageToolbarProps = {
    selectedTypes: string[];
    onSelectedTypesChange: (value: string[]) => void;
    searchQuery: string;
    onSearchQueryChange: (value: string) => void;
    detail: string;
    currentUserId: string;
    loadStatus: ModerationLoadStatus;
    onRefresh: () => void;
    table: any;
};

export function ModerationPageToolbar({
    selectedTypes,
    onSelectedTypesChange,
    searchQuery,
    onSearchQueryChange,
    detail,
    currentUserId,
    loadStatus,
    onRefresh,
    table
}: ModerationPageToolbarProps) {
    const { t } = useTranslation();
    const getModerationTypeLabel = (type: any) =>
        resolveModerationTypeLabel(type, t);

    return (
        <>
            <PageToolbarRow>
                <ModerationTypeFilterDropdown
                    value={selectedTypes}
                    onChange={onSelectedTypesChange}
                    getTypeLabel={getModerationTypeLabel}
                    sanitizeTypes={normalizeModerationSelectedTypes}
                />
                <Input
                    value={searchQuery}
                    onChange={(event: any) =>
                        onSearchQueryChange(event.target.value)
                    }
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
