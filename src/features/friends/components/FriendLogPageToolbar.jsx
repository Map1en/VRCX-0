import { RefreshCwIcon, SearchIcon } from 'lucide-react';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import { PageToolbarRow } from '@/components/layout/PageScaffold.jsx';
import { Button } from '@/ui/shadcn/button';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Spinner } from '@/ui/shadcn/spinner';

import { FriendLogTypeFilterDropdown } from './FriendLogViewParts.jsx';

export function FriendLogPageToolbar({
    selectedTypes,
    onSelectedTypesChange,
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
            <PageToolbarRow className="xl:justify-between">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <FriendLogTypeFilterDropdown
                        value={selectedTypes}
                        onChange={onSelectedTypesChange}
                    />
                    <InputGroup className="min-w-56 flex-1">
                        <InputGroupAddon>
                            <SearchIcon />
                        </InputGroupAddon>
                        <InputGroupInput
                            value={searchQuery}
                            onChange={(event) =>
                                onSearchQueryChange(event.target.value)
                            }
                            placeholder={t('view.friend_log.search_placeholder')}
                        />
                    </InputGroup>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title={t('common.actions.refresh')}
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
                </div>
                <TableColumnVisibilityMenu table={table} />
            </PageToolbarRow>
            {detail ? (
                <div className="text-muted-foreground text-sm">{detail}</div>
            ) : null}
        </>
    );
}
