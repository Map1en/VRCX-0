import { ClipboardCopyIcon, FileSearchIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    EmptyState,
    PageBody,
    PageScaffold
} from '@/components/layout/PageScaffold';
import { ToolPageHeader } from '@/components/layout/ToolPageHeader';
import { Badge } from '@/ui/shadcn/badge';
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
        selectedFile,
        selectedFileName,
        setSelectedFileName,
        entries,
        visibleLogRows,
        logVirtualHeight,
        selectedLineNumbers,
        selectedCount,
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
            <PageBody>
                <VrchatLogToolbar
                    selectedFileName={selectedFileName}
                    setSelectedFileName={setSelectedFileName}
                    files={files}
                    isFilesLoading={isFilesLoading}
                    selectedFile={selectedFile}
                    isEntriesLoading={isEntriesLoading}
                    refresh={refresh}
                    followLatest={followLatest}
                    setFollowLatest={setFollowLatest}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    levels={levels}
                    toggleLevel={toggleLevel}
                    categoryOptions={categoryOptions}
                    selectedCategories={selectedCategories}
                    setSelectedCategories={setSelectedCategories}
                    toggleCategory={toggleCategory}
                />

                {error ? (
                    <div className="border-destructive/40 bg-destructive/10 text-destructive-foreground rounded-md border p-3 text-sm">
                        {error}
                    </div>
                ) : null}

                <div className="border-border bg-background min-h-0 flex-1 overflow-hidden rounded-md border">
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
                            logVirtualHeight={logVirtualHeight}
                            visibleLogRows={visibleLogRows}
                            selectedLineNumbers={selectedLineNumbers}
                            toggleEntrySelected={toggleEntrySelected}
                            copyText={copyText}
                            copySelectedEntries={copySelectedEntries}
                            selectedCount={selectedCount}
                            isCopying={isCopying}
                        />
                    )}
                </div>

                {entries.length ? (
                    <div className="text-muted-foreground flex shrink-0 items-center justify-between gap-3 pb-3 text-xs">
                        <div className="flex min-w-0 items-center gap-3">
                            {olderOffset !== null ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    disabled={isLoadingMore}
                                    onClick={() =>
                                        loadEntries({
                                            reset: false,
                                            offset: olderOffset
                                        })
                                    }
                                >
                                    {isLoadingMore ? (
                                        <Spinner className="size-3.5" />
                                    ) : null}
                                    {t('view.tools.vrchat_log.load_more')}
                                </Button>
                            ) : null}
                            <span className="tabular-nums">
                                {t('view.tools.vrchat_log.loaded_count', {
                                    loaded: visibleLoadedCount,
                                    total: totalEntries
                                })}
                            </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            {selectedCount ? (
                                <Badge className="bg-purple-50/70 text-purple-600 dark:bg-purple-950/50 dark:text-purple-300">
                                    {t('view.tools.vrchat_log.selected_count', {
                                        count: selectedCount
                                    })}
                                </Badge>
                            ) : null}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8"
                                disabled={!selectedCount || isCopying}
                                onClick={copySelectedEntries}
                            >
                                <ClipboardCopyIcon data-icon="inline-start" />
                                {t('view.tools.vrchat_log.copy_selected')}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8"
                                disabled={!selectedCount}
                                onClick={clearSelectedEntries}
                            >
                                <XIcon data-icon="inline-start" />
                                {t('view.tools.vrchat_log.clear_selected')}
                            </Button>
                        </div>
                    </div>
                ) : null}
            </PageBody>
        </PageScaffold>
    );
}
