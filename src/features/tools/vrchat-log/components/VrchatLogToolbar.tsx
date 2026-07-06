import { ChevronRightIcon, RefreshCcwIcon, SearchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import { formatDateFilter } from '@/lib/dateTime';
import type { VrchatLogFileOutput } from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import { fileLabel, LOG_LEVELS } from '../vrchatLogHelpers';

export function VrchatLogToolbar({
    selectedFileName,
    setSelectedFileName,
    files,
    isFilesLoading,
    selectedFile,
    isEntriesLoading,
    refresh,
    followLatest,
    setFollowLatest,
    searchQuery,
    setSearchQuery,
    levels,
    toggleLevel,
    categoryButtonLabel,
    categoryOptions,
    selectedCategories,
    setSelectedCategories,
    toggleCategory
}: any) {
    const { t } = useTranslation();

    return (
        <PageToolbar className="gap-2 border-b pb-3">
            <PageToolbarRow className="items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
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
                        <SelectTrigger className="h-9 max-w-[760px] min-w-[360px] flex-1">
                            <SelectValue
                                placeholder={t(
                                    'view.tools.vrchat_log.file_placeholder'
                                )}
                            />
                        </SelectTrigger>
                        <SelectContent align="start">
                            {files.map((file: any) => (
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
                        </SelectContent>
                    </Select>
                    {selectedFile ? (
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            {selectedFile.modifiedAt
                                ? formatDateFilter(
                                      selectedFile.modifiedAt,
                                      'long'
                                  )
                                : ''}
                        </span>
                    ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9"
                        disabled={isFilesLoading || isEntriesLoading}
                        onClick={() => {
                            refresh();
                        }}
                    >
                        <RefreshCcwIcon
                            data-icon="inline-start"
                            className={
                                isFilesLoading || isEntriesLoading
                                    ? 'animate-spin'
                                    : undefined
                            }
                        />
                        {t('common.actions.refresh')}
                    </Button>

                    <Button
                        type="button"
                        variant={followLatest ? 'default' : 'outline'}
                        size="sm"
                        className="h-9"
                        disabled={!selectedFileName}
                        onClick={() => setFollowLatest((value: any) => !value)}
                    >
                        <RefreshCcwIcon
                            data-icon="inline-start"
                            className={
                                followLatest ? 'animate-spin' : undefined
                            }
                        />
                        {t('view.tools.vrchat_log.follow_latest')}
                    </Button>
                </div>
            </PageToolbarRow>

            <PageToolbarRow className="items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <div className="relative w-[420px] max-w-[34vw] min-w-72 shrink-0">
                        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                        <Input
                            value={searchQuery}
                            className="h-9 pl-8 text-sm"
                            placeholder={t(
                                'view.tools.vrchat_log.search_placeholder'
                            )}
                            onChange={(event) =>
                                setSearchQuery(event.target.value)
                            }
                        />
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                        {LOG_LEVELS.map((level) => (
                            <label
                                key={level}
                                className="border-border bg-background text-foreground flex h-9 items-center gap-2 rounded-md border px-2.5 text-sm"
                            >
                                <Checkbox
                                    checked={levels.includes(level)}
                                    onCheckedChange={(checked) =>
                                        toggleLevel(level, checked === true)
                                    }
                                />
                                <span>{level}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                type="button"
                                variant="outline"
                                className="h-9 min-w-44 justify-between"
                            >
                                <span className="truncate">
                                    {categoryButtonLabel}
                                </span>
                                <ChevronRightIcon
                                    data-icon="inline-end"
                                    className="text-muted-foreground rotate-90"
                                />
                            </Button>
                        }
                    />
                    <DropdownMenuContent align="end" className="w-72">
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
                                    {categoryOptions.map((option: any) => (
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
                    </DropdownMenuContent>
                </DropdownMenu>
            </PageToolbarRow>
        </PageToolbar>
    );
}
