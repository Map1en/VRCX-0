import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';

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
    setSearch,
    t
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <div className="text-muted-foreground text-sm">
                {filteredRows.length}/{rows.length}
            </div>
            {tab ? (
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={remoteStatus[tab] === 'running'}
                    onClick={() => void loadTab(tab, { force: true })}
                >
                    {t('common.actions.refresh')}
                </Button>
            ) : null}
            {children}
            <Input
                value={search[searchKey]}
                onChange={(event) =>
                    setSearch((current) => ({
                        ...current,
                        [searchKey]: event.target.value
                    }))
                }
                placeholder={placeholder}
                className="ml-auto h-8 max-w-64"
            />
        </div>
    );
}
