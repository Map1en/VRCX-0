// @ts-nocheck
import { RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

export function UserDialogSearchHeader({
    searchKey,
    tab,
    rows,
    filteredRows,
    placeholder,
    children,
    remoteStatus,
    loadTab,
    search,
    setSearch
}) {
    const { t } = useTranslation();
    const currentSearch = String(search?.[searchKey] ?? '');
    const hasSearch = currentSearch.trim().length > 0;
    const running = tab ? remoteStatus[tab] === 'running' : false;

    return (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex min-w-0 items-center gap-2">
                {tab ? (
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        disabled={running}
                        aria-label={t('common.actions.refresh')}
                        onClick={() => void loadTab(tab, { force: true })}
                    >
                        {running ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <RefreshCwIcon data-icon="inline-start" />
                        )}
                        <span className="sr-only">
                            {t('common.actions.refresh')}
                        </span>
                    </Button>
                ) : null}
                {hasSearch ? (
                    <div className="text-muted-foreground min-w-0 text-sm tabular-nums">
                        {filteredRows.length}/{rows.length}
                    </div>
                ) : null}
            </div>
            <div className="ml-auto flex min-w-0 flex-1 basis-64 flex-wrap items-center justify-end gap-2">
                <Input
                    value={currentSearch}
                    onChange={(event) =>
                        setSearch((current) => ({
                            ...current,
                            [searchKey]: event.target.value
                        }))
                    }
                    placeholder={placeholder}
                    className="h-8 min-w-40 flex-1 sm:max-w-64"
                />
                {children}
            </div>
        </div>
    );
}
