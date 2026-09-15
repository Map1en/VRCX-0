import { CaseSensitiveIcon, ChevronsDownIcon, RegexIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarFilterMenu,
    ToolbarRefreshButton,
    ToolbarSearch,
    ToolbarViews
} from '@/components/layout/ToolbarControls';
import { cn } from '@/lib/utils';
import type { VrchatLogFileOutput } from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenuCheckboxItem,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator
} from '@/ui/shadcn/dropdown-menu';
import { InputGroupButton } from '@/ui/shadcn/input-group';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { useVrchatLogController } from '../useVrchatLogController';
import { fileLabel, levelChipClassName, LOG_LEVELS } from '../vrchatLogHelpers';

type VrchatLogController = ReturnType<typeof useVrchatLogController>;
type VrchatLogToolbarProps = Pick<
    VrchatLogController,
    | 'selectedFileName'
    | 'setSelectedFileName'
    | 'files'
    | 'isFilesLoading'
    | 'isEntriesLoading'
    | 'refresh'
    | 'followLatest'
    | 'setFollowLatest'
    | 'searchQuery'
    | 'setSearchQuery'
    | 'searchCaseSensitive'
    | 'setSearchCaseSensitive'
    | 'searchRegex'
    | 'setSearchRegex'
    | 'levels'
    | 'levelCounts'
    | 'toggleLevel'
    | 'categoryOptions'
    | 'selectedCategories'
    | 'setSelectedCategories'
    | 'toggleCategory'
    | 'visibleLoadedCount'
    | 'totalEntries'
>;

export function VrchatLogToolbar({
    selectedFileName,
    setSelectedFileName,
    files,
    isFilesLoading,
    isEntriesLoading,
    refresh,
    followLatest,
    setFollowLatest,
    searchQuery,
    setSearchQuery,
    searchCaseSensitive,
    setSearchCaseSensitive,
    searchRegex,
    setSearchRegex,
    levels,
    levelCounts,
    toggleLevel,
    categoryOptions,
    selectedCategories,
    setSelectedCategories,
    toggleCategory,
    visibleLoadedCount,
    totalEntries
}: VrchatLogToolbarProps) {
    const { t } = useTranslation();
    const hasQuery = Boolean(searchQuery.trim());

    return (
        <PageToolbar>
            <PageToolbarRow>
                <ToolbarViews className="min-w-0">
                    <Select
                        value={selectedFileName}
                        onValueChange={(value) =>
                            setSelectedFileName(value ?? '')
                        }
                        disabled={isFilesLoading || !files.length}
                        items={files.map((file: VrchatLogFileOutput) => ({
                            value: file.fileName,
                            label: fileLabel(
                                file,
                                t('view.tools.vrchat_log.latest')
                            )
                        }))}
                    >
                        <SelectTrigger className="max-w-120 min-w-64 flex-1">
                            <SelectValue
                                placeholder={t(
                                    'view.tools.vrchat_log.file_placeholder'
                                )}
                            />
                        </SelectTrigger>
                        <SelectContent align="start">
                            <SelectGroup>
                                {files.map((file) => (
                                    <SelectItem
                                        key={file.fileName}
                                        value={file.fileName}
                                    >
                                        {fileLabel(
                                            file,
                                            t('view.tools.vrchat_log.latest')
                                        )}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    {totalEntries ? (
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            {t(
                                hasQuery
                                    ? 'view.tools.vrchat_log.matched_count'
                                    : 'view.tools.vrchat_log.loaded_count',
                                {
                                    loaded: visibleLoadedCount,
                                    total: totalEntries
                                }
                            )}
                        </span>
                    ) : null}
                </ToolbarViews>

                <ToolbarActions>
                    <Button
                        type="button"
                        size="sm"
                        variant={followLatest ? 'secondary' : 'ghost'}
                        disabled={!selectedFileName}
                        aria-pressed={followLatest}
                        onClick={() => setFollowLatest((value) => !value)}
                    >
                        <ChevronsDownIcon data-icon="inline-start" />
                        {t('view.tools.vrchat_log.follow_latest')}
                    </Button>
                    <ToolbarRefreshButton
                        onRefresh={refresh}
                        loading={isFilesLoading || isEntriesLoading}
                    />
                </ToolbarActions>
            </PageToolbarRow>

            <PageToolbarRow>
                <ToolbarSearch
                    className="w-auto min-w-64 flex-1 shrink sm:w-auto"
                    value={searchQuery}
                    onValueChange={setSearchQuery}
                    placeholder={t('view.tools.vrchat_log.search_placeholder')}
                    trailing={
                        <>
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <InputGroupButton
                                            type="button"
                                            size="icon-xs"
                                            variant={
                                                searchCaseSensitive
                                                    ? 'secondary'
                                                    : 'ghost'
                                            }
                                            aria-pressed={searchCaseSensitive}
                                            aria-label={t(
                                                'view.tools.vrchat_log.match_case'
                                            )}
                                            onClick={() =>
                                                setSearchCaseSensitive(
                                                    (value) => !value
                                                )
                                            }
                                        >
                                            <CaseSensitiveIcon data-icon="icon" />
                                        </InputGroupButton>
                                    }
                                />
                                <TooltipContent>
                                    {t('view.tools.vrchat_log.match_case')}
                                </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <InputGroupButton
                                            type="button"
                                            size="icon-xs"
                                            variant={
                                                searchRegex
                                                    ? 'secondary'
                                                    : 'ghost'
                                            }
                                            aria-pressed={searchRegex}
                                            aria-label={t(
                                                'view.tools.vrchat_log.use_regex'
                                            )}
                                            onClick={() =>
                                                setSearchRegex(
                                                    (value) => !value
                                                )
                                            }
                                        >
                                            <RegexIcon data-icon="icon" />
                                        </InputGroupButton>
                                    }
                                />
                                <TooltipContent>
                                    {t('view.tools.vrchat_log.use_regex')}
                                </TooltipContent>
                            </Tooltip>
                        </>
                    }
                />

                <ToolbarActions>
                    <div className="flex shrink-0 items-center gap-1">
                        {LOG_LEVELS.map((level) => {
                            const active = levels.includes(level);
                            const count =
                                levelCounts.find(
                                    (entry) => entry.level === level
                                )?.count ?? 0;

                            return (
                                <Button
                                    key={level}
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    aria-pressed={active}
                                    className={cn(
                                        'gap-1.5 tabular-nums',
                                        levelChipClassName(level, active)
                                    )}
                                    onClick={() => toggleLevel(level, !active)}
                                >
                                    {level}
                                    <span className="text-[11px] opacity-70">
                                        {count}
                                    </span>
                                </Button>
                            );
                        })}
                    </div>

                    <ToolbarFilterMenu
                        activeCount={selectedCategories.length}
                        contentClassName="w-72"
                    >
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                disabled={!selectedCategories.length}
                                closeOnClick={false}
                                onClick={(event) => {
                                    event.preventDefault();
                                    setSelectedCategories([]);
                                }}
                            >
                                {t('view.tools.vrchat_log.clear_categories')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        {categoryOptions.length ? (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    {categoryOptions.map((option) => (
                                        <DropdownMenuCheckboxItem
                                            key={option}
                                            checked={selectedCategories.includes(
                                                option
                                            )}
                                            onClick={(event) =>
                                                event.preventDefault()
                                            }
                                            onCheckedChange={(checked) =>
                                                toggleCategory(
                                                    option,
                                                    checked === true
                                                )
                                            }
                                        >
                                            <span className="truncate">
                                                {option}
                                            </span>
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuGroup>
                            </>
                        ) : null}
                    </ToolbarFilterMenu>
                </ToolbarActions>
            </PageToolbarRow>
        </PageToolbar>
    );
}
