import {
    ChevronRightIcon,
    ClipboardCopyIcon,
    FileSearchIcon,
    RefreshCcwIcon,
    SearchIcon,
    XIcon
} from 'lucide-react';
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
    EmptyState,
    PageBackButton,
    PageBody,
    PageHeader,
    PageScaffold,
    PageTitle,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import { tauriClient } from '@/platform/tauri/client';
import type {
    VrchatLogEntriesReadOutput,
    VrchatLogEntryOutput,
    VrchatLogFileOutput,
    VrchatLogLevel
} from '@/platform/tauri/client';
import storageRepository from '@/repositories/storageRepository';
import { cn } from '@/lib/utils';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { formatDateFilter } from '@/lib/dateTime';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@/ui/shadcn/tooltip';

const LOG_LEVELS: VrchatLogLevel[] = ['Debug', 'Warning', 'Error'];
const ALL_CATEGORY_VALUE = '__all__';
const PREFS_KEY = 'prefs';
const PAGE_LIMIT = 350;
const TAIL_LIMIT = 300;
const MAX_CLIENT_ENTRIES = 2500;
const FOLLOW_INTERVAL_MS = 2000;
const LOG_ROW_HEIGHT = 30;
const LOG_HEADER_HEIGHT = 30;
const LOG_ROW_OVERSCAN = 18;
const LOG_TABLE_GRID_CLASS =
    'grid-cols-[32px_172px_78px_minmax(136px,190px)_minmax(420px,1fr)]';

const logViewerStorage = storageRepository.withPrefix('tool:vrchatLog:');

type VrchatLogViewerPrefs = {
    levels?: string[];
    categories?: string[];
    category?: string;
    searchQuery?: string;
    followLatest?: boolean;
    recentFileName?: string;
};

function normalizePrefs(value: VrchatLogViewerPrefs | null) {
    const levels = Array.isArray(value?.levels)
        ? value.levels.filter((level) => LOG_LEVELS.includes(level as any))
        : LOG_LEVELS;
    return {
        levels: levels.length ? levels : LOG_LEVELS,
        categories: Array.isArray(value?.categories)
            ? value.categories.filter(Boolean)
            : value?.category && value.category !== ALL_CATEGORY_VALUE
              ? [value.category]
              : [],
        searchQuery: value?.searchQuery || '',
        followLatest: value?.followLatest ?? true,
        recentFileName: value?.recentFileName || ''
    };
}

function fileLabel(file: VrchatLogFileOutput, latestLabel: string) {
    const size = formatBytes(file.size);
    return file.latest
        ? `${file.fileName} (${size}, ${latestLabel})`
        : `${file.fileName} (${size})`;
}

function formatBytes(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function levelClassName(level: string) {
    if (level === 'Error') {
        return 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300';
    }
    if (level === 'Warning') {
        return 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    }
    return 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300';
}

function entryKey(entry: VrchatLogEntryOutput) {
    return `${entry.fileName}:${entry.lineNumber}`;
}

function mergeEntries(
    currentEntries: VrchatLogEntryOutput[],
    incomingEntries: VrchatLogEntryOutput[],
    trimToNewest = false
) {
    const byKey = new Map<string, VrchatLogEntryOutput>();
    for (const entry of currentEntries) {
        byKey.set(entryKey(entry), entry);
    }
    for (const entry of incomingEntries) {
        byKey.set(entryKey(entry), entry);
    }
    const sortedEntries = Array.from(byKey.values()).sort(
        (left, right) => left.lineNumber - right.lineNumber
    );
    return trimToNewest
        ? sortedEntries.slice(-MAX_CLIENT_ENTRIES)
        : sortedEntries;
}

function mergeLogCategories(
    currentCategories: string[],
    incomingEntries: VrchatLogEntryOutput[]
) {
    const categories = new Set(currentCategories);
    for (const entry of incomingEntries) {
        if (entry.category) {
            categories.add(entry.category);
        }
    }
    return Array.from(categories).sort((left, right) =>
        left.localeCompare(right)
    );
}

function entryToText(entry: VrchatLogEntryOutput) {
    return [entry.raw || `${entry.timestamp} ${entry.level} - ${entry.message}`]
        .concat(entry.continuationLines || [])
        .join('\n');
}

function entryMessageText(entry: VrchatLogEntryOutput) {
    return [entry.message].concat(entry.continuationLines || []).join('\n');
}

export function VrchatLogPage() {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const vrchatPathStatus = useRuntimeStore(
        (state: any) => state.hostCapabilities.vrchatPathDiscovery
    );
    const mountedRef = useRef(true);
    const requestRef = useRef(0);
    const lastLineNumberRef = useRef(0);
    const selectedFileNameRef = useRef('');
    const logScrollRef = useRef<HTMLDivElement | null>(null);
    const pendingPrependHeightRef = useRef(0);
    const lastFileSizeRef = useRef(0);
    const lastFileModifiedAtRef = useRef<string | null>(null);
    const [logScrollElement, setLogScrollElement] =
        useState<HTMLDivElement | null>(null);
    const [scrollMetrics, setScrollMetrics] = useState({
        scrollTop: 0,
        viewportHeight: 0
    });
    const [prefsLoaded, setPrefsLoaded] = useState(false);
    const [files, setFiles] = useState<VrchatLogFileOutput[]>([]);
    const [selectedFileName, setSelectedFileName] = useState('');
    const [entries, setEntries] = useState<VrchatLogEntryOutput[]>([]);
    const [selectedLineNumbers, setSelectedLineNumbers] = useState<Set<number>>(
        () => new Set()
    );
    const [levels, setLevels] = useState<string[]>(LOG_LEVELS);
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    const [knownCategories, setKnownCategories] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [followLatest, setFollowLatest] = useState(true);
    const [tailReady, setTailReady] = useState(false);
    const [followScrollVersion, setFollowScrollVersion] = useState(0);
    const [olderOffset, setOlderOffset] = useState<number | null>(null);
    const [totalEntries, setTotalEntries] = useState(0);
    const [isFilesLoading, setIsFilesLoading] = useState(false);
    const [isEntriesLoading, setIsEntriesLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [error, setError] = useState('');

    const selectedFile = files.find(
        (file) => file.fileName === selectedFileName
    );
    const selectedIsLatest = Boolean(selectedFile?.latest);
    const vrchatPathUnavailable = vrchatPathStatus?.available === false;
    const categoryOptions = useMemo(() => {
        const nextCategories = [...knownCategories];
        for (const category of selectedCategories) {
            if (category && !nextCategories.includes(category)) {
                nextCategories.unshift(category);
            }
        }
        return nextCategories;
    }, [knownCategories, selectedCategories]);
    const categoryButtonLabel =
        selectedCategories.length === 1
            ? selectedCategories[0]
            : selectedCategories.length
              ? t('view.tools.vrchat_log.categories_selected', {
                    count: selectedCategories.length
                })
              : t('view.tools.vrchat_log.all_categories');
    const selectedCount = selectedLineNumbers.size;
    const visibleLoadedCount = entries.length;
    const logTotalHeight = entries.length * LOG_ROW_HEIGHT;
    const logVirtualHeight = LOG_HEADER_HEIGHT + logTotalHeight;
    const visibleLogRows = useMemo(() => {
        if (!entries.length) {
            return [];
        }
        const bodyScrollTop = Math.max(
            0,
            scrollMetrics.scrollTop - LOG_HEADER_HEIGHT
        );
        const overscanPx = LOG_ROW_HEIGHT * LOG_ROW_OVERSCAN;
        const startIndex = Math.max(
            0,
            Math.floor(
                Math.max(0, bodyScrollTop - overscanPx) / LOG_ROW_HEIGHT
            )
        );
        const endIndex = Math.min(
            entries.length,
            Math.ceil(
                (bodyScrollTop +
                    scrollMetrics.viewportHeight +
                    overscanPx) /
                    LOG_ROW_HEIGHT
            )
        );

        return entries.slice(startIndex, endIndex).map((entry, offset) => {
            const index = startIndex + offset;
            return {
                entry,
                index,
                key: entryKey(entry),
                start: index * LOG_ROW_HEIGHT
            };
        });
    }, [entries, scrollMetrics.scrollTop, scrollMetrics.viewportHeight]);

    const setLogScrollNode = useCallback((node: HTMLDivElement | null) => {
        logScrollRef.current = node;
        setLogScrollElement(node);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestRef.current += 1;
        };
    }, []);

    useEffect(() => {
        selectedFileNameRef.current = selectedFileName;
    }, [selectedFileName]);

    useEffect(() => {
        const container = logScrollElement;
        if (!container) {
            return undefined;
        }

        let frameId = 0;
        const updateScrollMetrics = () => {
            if (frameId) {
                window.cancelAnimationFrame(frameId);
            }
            frameId = window.requestAnimationFrame(() => {
                frameId = 0;
                setScrollMetrics({
                    scrollTop: container.scrollTop,
                    viewportHeight: container.clientHeight || 0
                });
            });
        };

        updateScrollMetrics();
        container.addEventListener('scroll', updateScrollMetrics, {
            passive: true
        });

        let observer: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(updateScrollMetrics);
            observer.observe(container);
        }
        window.addEventListener('resize', updateScrollMetrics);

        return () => {
            if (frameId) {
                window.cancelAnimationFrame(frameId);
            }
            container.removeEventListener('scroll', updateScrollMetrics);
            observer?.disconnect();
            window.removeEventListener('resize', updateScrollMetrics);
        };
    }, [logScrollElement]);

    useLayoutEffect(() => {
        const container = logScrollRef.current;
        if (!container) {
            return;
        }

        const prependHeight = pendingPrependHeightRef.current;
        if (prependHeight > 0) {
            pendingPrependHeightRef.current = 0;
            if (!followLatest) {
                container.scrollTop += prependHeight;
            }
        }

        if (followLatest) {
            container.scrollTop = container.scrollHeight;
        }

        setScrollMetrics({
            scrollTop: container.scrollTop,
            viewportHeight: container.clientHeight || 0
        });
    }, [followLatest, followScrollVersion, logTotalHeight, selectedFileName]);

    function resetLogEntries() {
        setEntries([]);
        setSelectedLineNumbers(new Set());
        setKnownCategories([]);
        setTailReady(false);
        setTotalEntries(0);
        setOlderOffset(null);
        pendingPrependHeightRef.current = 0;
        lastLineNumberRef.current = 0;
        lastFileSizeRef.current = 0;
        lastFileModifiedAtRef.current = null;
    }

    const buildReadInput = useCallback(
        (offset = 0, limit = PAGE_LIMIT) => ({
            fileName: selectedFileName,
            offset,
            limit,
            query: searchQuery.trim() || undefined,
            levels,
            categories: selectedCategories.length
                ? selectedCategories
                : undefined
        }),
        [levels, searchQuery, selectedCategories, selectedFileName]
    );

    const loadFiles = useCallback(
        async (preferredFileName = '') => {
            if (!mountedRef.current) {
                return '';
            }
            setIsFilesLoading(true);
            try {
                const nextFiles = await tauriClient.app.VrchatLogFilesList();
                if (!mountedRef.current) {
                    return '';
                }
                setFiles(nextFiles);
                const nextSelected =
                    nextFiles.find(
                        (file) => file.fileName === preferredFileName
                    )?.fileName ||
                    nextFiles.find((file) => file.latest)?.fileName ||
                    nextFiles[0]?.fileName ||
                    '';
                const selectionChanged =
                    nextSelected !== selectedFileNameRef.current;
                setSelectedFileName(nextSelected);
                if (!nextFiles.length || selectionChanged) {
                    resetLogEntries();
                }
                return nextSelected;
            } catch (loadError) {
                if (!mountedRef.current) {
                    return '';
                }
                const message =
                    loadError instanceof Error
                        ? loadError.message
                        : t('view.tools.vrchat_log.error_load_files');
                setError(message);
                toast.error(message);
                return '';
            } finally {
                if (mountedRef.current) {
                    setIsFilesLoading(false);
                }
            }
        },
        [t]
    );

    const loadEntries = useCallback(
        async ({ reset = true, offset = 0 } = {}) => {
            if (vrchatPathUnavailable || !selectedFileName) {
                return;
            }
            if (!mountedRef.current) {
                return;
            }
            if (reset) {
                setTailReady(false);
            }
            if (!levels.length) {
                setEntries([]);
                setTotalEntries(0);
                setOlderOffset(null);
                lastLineNumberRef.current = 0;
                setTailReady(false);
                return;
            }

            const requestId = requestRef.current + 1;
            requestRef.current = requestId;
            setError('');
            setIsEntriesLoading(reset);
            setIsLoadingMore(!reset);

            try {
                let response: VrchatLogEntriesReadOutput;
                if (reset) {
                    const summary = await tauriClient.app.VrchatLogEntriesRead(
                        buildReadInput(0, 1)
                    );
                    if (
                        !mountedRef.current ||
                        requestRef.current !== requestId
                    ) {
                        return;
                    }
                    const startOffset = Math.max(
                        summary.totalEntries - PAGE_LIMIT,
                        0
                    );
                    response = summary.totalEntries
                        ? await tauriClient.app.VrchatLogEntriesRead(
                              buildReadInput(startOffset, PAGE_LIMIT)
                          )
                        : summary;
                    if (
                        !mountedRef.current ||
                        requestRef.current !== requestId
                    ) {
                        return;
                    }
                    setEntries(response.entries);
                    setKnownCategories((current) =>
                        mergeLogCategories(current, response.entries)
                    );
                    setSelectedLineNumbers(new Set());
                    setOlderOffset(startOffset > 0 ? startOffset : null);
                } else {
                    const currentStartOffset = Math.max(0, offset);
                    const pageOffset = Math.max(
                        0,
                        currentStartOffset - PAGE_LIMIT
                    );
                    const pageLimit = currentStartOffset - pageOffset;
                    if (pageLimit <= 0) {
                        setOlderOffset(null);
                        return;
                    }
                    response = await tauriClient.app.VrchatLogEntriesRead(
                        buildReadInput(pageOffset, pageLimit)
                    );
                    if (
                        !mountedRef.current ||
                        requestRef.current !== requestId
                    ) {
                        return;
                    }
                    setEntries((current) => {
                        const nextEntries = mergeEntries(
                            current,
                            response.entries
                        );
                        const addedRows = Math.max(
                            0,
                            nextEntries.length - current.length
                        );
                        pendingPrependHeightRef.current +=
                            addedRows * LOG_ROW_HEIGHT;
                        return nextEntries;
                    });
                    setKnownCategories((current) =>
                        mergeLogCategories(current, response.entries)
                    );
                    setOlderOffset(pageOffset > 0 ? pageOffset : null);
                }
                setTotalEntries(response.totalEntries);
                if (reset) {
                    lastLineNumberRef.current = response.lastLineNumber;
                    lastFileSizeRef.current = response.fileSize;
                    lastFileModifiedAtRef.current =
                        response.fileModifiedAt ?? null;
                    setTailReady(true);
                }
            } catch (loadError) {
                if (
                    !mountedRef.current ||
                    requestRef.current !== requestId
                ) {
                    return;
                }
                const message =
                    loadError instanceof Error
                        ? loadError.message
                        : t('view.tools.vrchat_log.error_load_entries');
                setError(message);
                toast.error(message);
                loadFiles('').catch(() => {});
            } finally {
                if (
                    mountedRef.current &&
                    requestRef.current === requestId
                ) {
                    setIsEntriesLoading(false);
                    setIsLoadingMore(false);
                }
            }
        },
        [
            buildReadInput,
            levels.length,
            loadFiles,
            selectedFileName,
            t,
            vrchatPathUnavailable
        ]
    );

    useEffect(() => {
        if (vrchatPathUnavailable) {
            setPrefsLoaded(true);
            return undefined;
        }

        let active = true;
        logViewerStorage
            .getJson<VrchatLogViewerPrefs>(PREFS_KEY, null)
            .then(async (value) => {
                if (!active) {
                    return;
                }
                const prefs = normalizePrefs(value);
                setLevels(prefs.levels);
                setSelectedCategories(prefs.categories);
                setSearchQuery(prefs.searchQuery);
                setFollowLatest(prefs.followLatest);
                await loadFiles(prefs.recentFileName);
                if (active) {
                    setPrefsLoaded(true);
                }
            })
            .catch(async () => {
                if (active) {
                    await loadFiles('');
                    if (active) {
                        setPrefsLoaded(true);
                    }
                }
            });

        return () => {
            active = false;
        };
    }, [loadFiles, vrchatPathUnavailable]);

    useEffect(() => {
        if (!prefsLoaded) {
            return;
        }
        logViewerStorage
            .setJson(PREFS_KEY, {
                levels,
                categories: selectedCategories,
                searchQuery,
                followLatest,
                recentFileName: selectedFileName
            } satisfies VrchatLogViewerPrefs)
            .catch(() => {});
    }, [
        followLatest,
        levels,
        prefsLoaded,
        searchQuery,
        selectedCategories,
        selectedFileName
    ]);

    useEffect(() => {
        if (vrchatPathUnavailable || !prefsLoaded || !selectedFileName) {
            return;
        }
        loadEntries({ reset: true, offset: 0 });
    }, [
        levels,
        loadEntries,
        prefsLoaded,
        searchQuery,
        selectedCategories,
        selectedFileName,
        vrchatPathUnavailable
    ]);

    useEffect(() => {
        if (
            vrchatPathUnavailable ||
            !prefsLoaded ||
            !followLatest ||
            !selectedFileName ||
            !levels.length ||
            !tailReady
        ) {
            return undefined;
        }

        let active = true;
        let inFlight = false;
        const timer = window.setInterval(() => {
            if (inFlight) {
                return;
            }
            inFlight = true;

            Promise.resolve()
                .then(async () => {
                    const nextFiles = await tauriClient.app.VrchatLogFilesList();
                    if (!active) {
                        return;
                    }
                    setFiles(nextFiles);
                    if (!nextFiles.length) {
                        setSelectedFileName('');
                        resetLogEntries();
                        setError('');
                        return;
                    }

                    const latestFile =
                        nextFiles.find((file) => file.latest) ?? nextFiles[0];
                    if (
                        latestFile?.fileName &&
                        latestFile.fileName !== selectedFileName
                    ) {
                        resetLogEntries();
                        setSelectedFileName(latestFile.fileName);
                        return;
                    }
                    if (!selectedIsLatest) {
                        return;
                    }
                    if (
                        latestFile.fileName === selectedFileName &&
                        latestFile.size === lastFileSizeRef.current &&
                        latestFile.modifiedAt ===
                            lastFileModifiedAtRef.current
                    ) {
                        return;
                    }

                    const response = await tauriClient.app.VrchatLogTailRead({
                        fileName: selectedFileName,
                        afterLineNumber: lastLineNumberRef.current,
                        fileSize: lastFileSizeRef.current,
                        limit: TAIL_LIMIT,
                        query: searchQuery.trim() || undefined,
                        levels,
                        categories: selectedCategories.length
                            ? selectedCategories
                            : undefined
                    });
                    if (!active || response.fileName !== selectedFileName) {
                        return;
                    }
                    if (
                        response.resetRequired ||
                        response.totalLines < lastLineNumberRef.current
                    ) {
                        resetLogEntries();
                        await loadEntries({ reset: true, offset: 0 });
                        return;
                    }
                    lastLineNumberRef.current = response.lastLineNumber;
                    lastFileSizeRef.current = response.fileSize;
                    lastFileModifiedAtRef.current =
                        response.fileModifiedAt ?? null;
                    if (response.entries.length) {
                        setEntries((current) => {
                            const existingKeys = new Set(
                                current.map(entryKey)
                            );
                            const nextEntries = mergeEntries(
                                current,
                                response.entries,
                                true
                            );
                            const addedCount = response.entries.filter(
                                (entry) => !existingKeys.has(entryKey(entry))
                            ).length;
                            if (addedCount) {
                                setTotalEntries((currentTotal) =>
                                    currentTotal + addedCount
                                );
                            }
                            const liveLineNumbers = new Set(
                                nextEntries.map((entry) => entry.lineNumber)
                            );
                            setSelectedLineNumbers((currentSelection) => {
                                const nextSelection = new Set(
                                    Array.from(currentSelection).filter(
                                        (lineNumber) =>
                                            liveLineNumbers.has(lineNumber)
                                    )
                                );
                                return nextSelection.size ===
                                    currentSelection.size
                                    ? currentSelection
                                    : nextSelection;
                            });
                            return nextEntries;
                        });
                        setKnownCategories((current) =>
                            mergeLogCategories(current, response.entries)
                        );
                        setFollowScrollVersion((version) => version + 1);
                    }
                })
                .catch((tailError) => {
                    if (!active) {
                        return;
                    }
                    const message =
                        tailError instanceof Error
                            ? tailError.message
                            : t('view.tools.vrchat_log.error_tail');
                    setError(message);
                    loadFiles('').catch(() => {});
                })
                .finally(() => {
                    inFlight = false;
                });
        }, FOLLOW_INTERVAL_MS);

        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [
        followLatest,
        levels,
        loadEntries,
        prefsLoaded,
        searchQuery,
        selectedCategories,
        selectedFileName,
        selectedIsLatest,
        tailReady,
        loadFiles,
        t,
        vrchatPathUnavailable
    ]);

    function toggleLevel(level: string, checked: boolean) {
        setLevels((current) => {
            const next = new Set(current);
            if (checked) {
                next.add(level);
            } else {
                next.delete(level);
            }
            return LOG_LEVELS.filter((value) => next.has(value));
        });
    }

    function toggleEntrySelected(entry: VrchatLogEntryOutput, checked: boolean) {
        setSelectedLineNumbers((current) => {
            const next = new Set(current);
            if (checked) {
                next.add(entry.lineNumber);
            } else {
                next.delete(entry.lineNumber);
            }
            return next;
        });
    }

    function toggleCategory(category: string, checked: boolean) {
        setSelectedCategories((current) => {
            if (checked) {
                return current.includes(category)
                    ? current
                    : [...current, category].sort((left, right) =>
                          left.localeCompare(right)
                      );
            }
            return current.filter((value) => value !== category);
        });
    }

    async function refresh() {
        const activeFile = await loadFiles(selectedFileName);
        if (activeFile && activeFile === selectedFileName) {
            await loadEntries({ reset: true, offset: 0 });
        }
    }

    async function copySelectedEntries() {
        setIsCopying(true);
        try {
            const sourceEntries = selectedCount
                ? entries.filter((entry) =>
                      selectedLineNumbers.has(entry.lineNumber)
                  )
                : [];
            if (!sourceEntries.length) {
                return;
            }
            const text = sourceEntries.map(entryToText).join('\n\n');
            await navigator.clipboard.writeText(text);
            toast.success(t('view.tools.vrchat_log.copied'));
        } catch {
            toast.error(t('view.tools.vrchat_log.copy_failed'));
        } finally {
            setIsCopying(false);
        }
    }

    function clearSelectedEntries() {
        setSelectedLineNumbers(new Set());
    }

    async function copyText(text: string) {
        if (!text.trim()) {
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            toast.success(t('view.tools.vrchat_log.copied'));
        } catch {
            toast.error(t('view.tools.vrchat_log.copy_failed'));
        }
    }

    const header = (
        <PageToolbar>
            <PageToolbarRow className="items-center">
                <PageBackButton
                    label={t('nav_tooltip.tools')}
                    onClick={() => navigate('/tools')}
                />
                <PageHeader className="min-w-0 p-0">
                    <PageTitle>{t('view.tools.vrchat_log.title')}</PageTitle>
                </PageHeader>
            </PageToolbarRow>
        </PageToolbar>
    );

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
                <PageToolbar className="gap-2 border-b pb-3">
                    <PageToolbarRow className="items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                            <Select
                                value={selectedFileName}
                                onValueChange={setSelectedFileName}
                                disabled={isFilesLoading || !files.length}
                            >
                                <SelectTrigger className="h-9 min-w-[360px] max-w-[760px] flex-1">
                                    <SelectValue
                                        placeholder={t(
                                            'view.tools.vrchat_log.file_placeholder'
                                        )}
                                    />
                                </SelectTrigger>
                                <SelectContent align="start">
                                    {files.map((file) => (
                                        <SelectItem
                                            key={file.fileName}
                                            value={file.fileName}
                                        >
                                            {fileLabel(
                                                file,
                                                t(
                                                    'view.tools.vrchat_log.latest'
                                                )
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
                                onClick={() =>
                                    setFollowLatest((value) => !value)
                                }
                            >
                                <RefreshCcwIcon
                                    data-icon="inline-start"
                                    className={
                                        followLatest
                                            ? 'animate-spin'
                                            : undefined
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
                                                toggleLevel(
                                                    level,
                                                    checked === true
                                                )
                                            }
                                        />
                                        <span>{level}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
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
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="end"
                                className="w-72"
                            >
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        disabled={!selectedCategories.length}
                                        onSelect={(event: any) => {
                                            event.preventDefault();
                                            setSelectedCategories([])
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
                                                    onSelect={(event: any) =>
                                                        event.preventDefault()
                                                    }
                                                    onCheckedChange={(
                                                        checked: any
                                                    ) =>
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
                        <div
                            ref={setLogScrollNode}
                            className="h-full overflow-auto"
                        >
                            <div
                                className="relative min-w-[980px]"
                                style={{ height: `${logVirtualHeight}px` }}
                            >
                                <div
                                    className={cn(
                                        'border-border bg-background/95 text-muted-foreground sticky top-0 z-10 grid h-[30px] items-center gap-2 border-b px-2 text-[11px] font-medium uppercase backdrop-blur',
                                        LOG_TABLE_GRID_CLASS
                                    )}
                                >
                                    <div />
                                    <div>
                                        {t(
                                            'view.tools.vrchat_log.column_time'
                                        )}
                                    </div>
                                    <div>
                                        {t(
                                            'view.tools.vrchat_log.column_level'
                                        )}
                                    </div>
                                    <div>
                                        {t(
                                            'view.tools.vrchat_log.column_category'
                                        )}
                                    </div>
                                    <div>
                                        {t(
                                            'view.tools.vrchat_log.column_message'
                                        )}
                                    </div>
                                </div>
                                {visibleLogRows.map((row) => {
                                    const { entry } = row;
                                    const categoryLabel =
                                        entry.category ||
                                        t('view.tools.vrchat_log.no_category');
                                    const selected = selectedLineNumbers.has(
                                        entry.lineNumber
                                    );

                                    return (
                                        <ContextMenu key={row.key}>
                                            <ContextMenuTrigger asChild>
                                                <div
                                                    style={{
                                                        height: `${LOG_ROW_HEIGHT}px`,
                                                        transform: `translateY(${row.start + LOG_HEADER_HEIGHT}px)`
                                                    }}
                                                    onClick={(event) => {
                                                        const target =
                                                            event.target as HTMLElement;
                                                        if (
                                                            target.closest(
                                                                '[data-log-select-control]'
                                                            )
                                                        ) {
                                                            return;
                                                        }
                                                        toggleEntrySelected(
                                                            entry,
                                                            !selected
                                                        );
                                                    }}
                                                    className={cn(
                                                        'border-border hover:bg-accent/25 absolute top-0 right-0 left-0 grid cursor-default items-center gap-2 border-b px-2 text-[13px] leading-5',
                                                        LOG_TABLE_GRID_CLASS,
                                                        selected &&
                                                            'bg-accent/30'
                                                    )}
                                                >
                                                    <div
                                                        className="flex justify-center"
                                                        data-log-select-control
                                                    >
                                                        <Checkbox
                                                            checked={selected}
                                                            onCheckedChange={(
                                                                checked
                                                            ) =>
                                                                toggleEntrySelected(
                                                                    entry,
                                                                    checked ===
                                                                        true
                                                                )
                                                            }
                                                        />
                                                    </div>
                                                    <div className="text-muted-foreground whitespace-nowrap tabular-nums">
                                                        {entry.timestamp}
                                                    </div>
                                                    <div>
                                                        <Badge
                                                            className={cn(
                                                                'h-5 px-2 text-[11px] font-semibold',
                                                                levelClassName(
                                                                    entry.level
                                                                )
                                                            )}
                                                        >
                                                            {entry.level}
                                                        </Badge>
                                                    </div>
                                                    <div className="text-muted-foreground min-w-0">
                                                        {entry.category ? (
                                                            <Tooltip>
                                                                <TooltipTrigger
                                                                    asChild
                                                                >
                                                                    <span className="block truncate">
                                                                        {
                                                                            categoryLabel
                                                                        }
                                                                    </span>
                                                                </TooltipTrigger>
                                                                <TooltipContent className="max-w-md break-words">
                                                                    {
                                                                        categoryLabel
                                                                    }
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        ) : (
                                                            <span className="block truncate">
                                                                {categoryLabel}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div
                                                        className="text-foreground flex min-w-0 items-center gap-2"
                                                        title={entryMessageText(
                                                            entry
                                                        )}
                                                    >
                                                        <span className="min-w-0 truncate">
                                                            {entry.message}
                                                        </span>
                                                        {entry.continuationLines
                                                            .length ? (
                                                            <Badge
                                                                className="bg-muted text-muted-foreground h-5 shrink-0 px-1.5 text-[11px] font-medium"
                                                            >
                                                                {t(
                                                                    'view.tools.vrchat_log.continuation_count',
                                                                    {
                                                                        count: entry
                                                                            .continuationLines
                                                                            .length
                                                                    }
                                                                )}
                                                            </Badge>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </ContextMenuTrigger>
                                            <ContextMenuContent>
                                                <ContextMenuItem
                                                    onSelect={() => {
                                                        copyText(
                                                            entryToText(entry)
                                                        );
                                                    }}
                                                >
                                                    <ClipboardCopyIcon />
                                                    {t(
                                                        'view.tools.vrchat_log.copy_entry'
                                                    )}
                                                </ContextMenuItem>
                                                <ContextMenuItem
                                                    onSelect={() => {
                                                        copyText(
                                                            entryMessageText(
                                                                entry
                                                            )
                                                        );
                                                    }}
                                                >
                                                    <ClipboardCopyIcon />
                                                    {t(
                                                        'view.tools.vrchat_log.copy_message'
                                                    )}
                                                </ContextMenuItem>
                                                <ContextMenuSeparator />
                                                <ContextMenuItem
                                                    disabled={
                                                        !selectedCount ||
                                                        isCopying
                                                    }
                                                    onSelect={
                                                        copySelectedEntries
                                                    }
                                                >
                                                    <ClipboardCopyIcon />
                                                    {t(
                                                        'view.tools.vrchat_log.copy_selected'
                                                    )}
                                                </ContextMenuItem>
                                            </ContextMenuContent>
                                        </ContextMenu>
                                    );
                                })}
                            </div>
                        </div>
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
