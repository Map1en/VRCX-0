import { ClipboardCopyIcon, FileSearchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    EmptyState,
    PageBody,
    PageScaffold
} from '@/components/layout/PageScaffold';
import { SelectionActionBar } from '@/components/layout/SelectionActionBar';
import { ToolPageHeader } from '@/components/layout/ToolPageHeader';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import { VrchatLogTable } from './vrchat-log/components/VrchatLogTable';
import { VrchatLogToolbar } from './vrchat-log/components/VrchatLogToolbar';
import { useVrchatLogController } from './vrchat-log/useVrchatLogController';

export function VrchatLogPage() {
    const { t } = useTranslation();
    const {
        vrchatPathStatus,
        vrchatPathUnavailable,
        files,
        selectedFileName,
        setSelectedFileName,
        entries,
        visibleLogRows,
        logBodyOffset,
        logVirtualHeight,
        selectedLineNumbers,
        selectedCount,
        isAllSelected,
        visibleLoadedCount,
        totalEntries,
        olderOffset,
        levels,
        toggleLevel,
        categoryOptions,
        selectedCategories,
        setSelectedCategories,
        toggleCategory,
        searchQuery,
        setSearchQuery,
        searchCaseSensitive,
        setSearchCaseSensitive,
        searchRegex,
        setSearchRegex,
        levelCounts,
        followLatest,
        setFollowLatest,
        isFilesLoading,
        isEntriesLoading,
        isLoadingMore,
        isCopying,
        error,
        setLogScrollNode,
        toggleEntrySelected,
        refresh,
        copySelectedEntries,
        clearSelectedEntries,
        toggleSelectAllEntries,
        copyText,
        loadEntries
    } = useVrchatLogController();

    const header = <ToolPageHeader toolKey="vrchat-log" />;

    if (vrchatPathUnavailable) {
        return (
            <PageScaffold className="vrchat-log-page flex-1">
                {header}
                <EmptyState
                    icon={FileSearchIcon}
                    title={t('view.tools.vrchat_log.unavailable')}
                    description={vrchatPathStatus.reason}
                />
            </PageScaffold>
        );
    }

    return (
        <PageScaffold className="vrchat-log-page flex-1" flushBottom>
            {header}
            <VrchatLogToolbar
                selectedFileName={selectedFileName}
                setSelectedFileName={setSelectedFileName}
                files={files}
                isFilesLoading={isFilesLoading}
                isEntriesLoading={isEntriesLoading}
                refresh={refresh}
                followLatest={followLatest}
                setFollowLatest={setFollowLatest}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                searchCaseSensitive={searchCaseSensitive}
                setSearchCaseSensitive={setSearchCaseSensitive}
                searchRegex={searchRegex}
                setSearchRegex={setSearchRegex}
                levels={levels}
                levelCounts={levelCounts}
                toggleLevel={toggleLevel}
                categoryOptions={categoryOptions}
                selectedCategories={selectedCategories}
                setSelectedCategories={setSelectedCategories}
                toggleCategory={toggleCategory}
                visibleLoadedCount={visibleLoadedCount}
                totalEntries={totalEntries}
            />
            <PageBody>
                {error ? (
                    <div className="border-destructive/40 bg-destructive/10 text-destructive-foreground rounded-md border p-3 text-sm">
                        {error}
                    </div>
                ) : null}

                <div className="border-border bg-background relative min-h-0 flex-1 overflow-hidden rounded-md border">
                    {isEntriesLoading ? (
                        <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
                            <Spinner className="size-4" />
                            {t('view.tools.vrchat_log.loading')}
                        </div>
                    ) : !files.length ? (
                        <EmptyState
                            icon={FileSearchIcon}
                            className="h-full"
                            title={t('view.tools.vrchat_log.no_files')}
                            description={t(
                                'view.tools.vrchat_log.no_files_description'
                            )}
                        />
                    ) : !entries.length ? (
                        <EmptyState
                            icon={FileSearchIcon}
                            className="h-full"
                            title={t('view.tools.vrchat_log.no_entries')}
                            description={t(
                                'view.tools.vrchat_log.no_entries_description'
                            )}
                        />
                    ) : (
                        <VrchatLogTable
                            setLogScrollNode={setLogScrollNode}
                            logBodyOffset={logBodyOffset}
                            logVirtualHeight={logVirtualHeight}
                            visibleLogRows={visibleLogRows}
                            selectedLineNumbers={selectedLineNumbers}
                            toggleEntrySelected={toggleEntrySelected}
                            copyText={copyText}
                            copySelectedEntries={copySelectedEntries}
                            selectedCount={selectedCount}
                            isCopying={isCopying}
                            searchQuery={searchQuery}
                            searchCaseSensitive={searchCaseSensitive}
                            searchRegex={searchRegex}
                            olderOffset={olderOffset}
                            isLoadingMore={isLoadingMore}
                            onLoadOlder={() =>
                                loadEntries({
                                    reset: false,
                                    offset: olderOffset ?? 0
                                })
                            }
                        />
                    )}
                    {selectedCount ? (
                        <SelectionActionBar
                            status={t('view.tools.vrchat_log.selected_count', {
                                count: selectedCount
                            })}
                            selectAllLabel={
                                isAllSelected
                                    ? t('view.tools.vrchat_log.deselect_all')
                                    : t('view.tools.vrchat_log.select_all')
                            }
                            clearLabel={t('common.actions.clear')}
                            onSelectAll={toggleSelectAllEntries}
                            onClearSelection={clearSelectedEntries}
                        >
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={isCopying}
                                onClick={copySelectedEntries}
                            >
                                <ClipboardCopyIcon data-icon="inline-start" />
                                {t('view.tools.vrchat_log.copy_selected')}
                            </Button>
                        </SelectionActionBar>
                    ) : null}
                </div>
            </PageBody>
        </PageScaffold>
    );
}
