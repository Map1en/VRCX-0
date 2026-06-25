import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { commands } from '@/platform/tauri/bindings';
import type {
    VrchatLogEntriesReadOutput,
    VrchatLogEntryOutput,
    VrchatLogFileOutput
} from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    entryKey,
    entryToText,
    FOLLOW_INTERVAL_MS,
    LOG_HEADER_HEIGHT,
    LOG_LEVELS,
    LOG_ROW_HEIGHT,
    LOG_ROW_OVERSCAN,
    logViewerStorage,
    mergeEntries,
    mergeLogCategories,
    normalizePrefs,
    PAGE_LIMIT,
    PREFS_KEY,
    TAIL_LIMIT,
    type VrchatLogViewerPrefs
} from './vrchatLogHelpers';

export function useVrchatLogController() {
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
            Math.floor(Math.max(0, bodyScrollTop - overscanPx) / LOG_ROW_HEIGHT)
        );
        const endIndex = Math.min(
            entries.length,
            Math.ceil(
                (bodyScrollTop + scrollMetrics.viewportHeight + overscanPx) /
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
            query: searchQuery.trim() || null,
            levels,
            categories: selectedCategories.length ? selectedCategories : null
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
                const nextFiles = await commands.appVrchatLogFilesList();
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
                    const summary = await commands.appVrchatLogEntriesRead(
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
                        ? await commands.appVrchatLogEntriesRead(
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
                    response = await commands.appVrchatLogEntriesRead(
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
                if (!mountedRef.current || requestRef.current !== requestId) {
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
                if (mountedRef.current && requestRef.current === requestId) {
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
                    const nextFiles = await commands.appVrchatLogFilesList();
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
                        latestFile.modifiedAt === lastFileModifiedAtRef.current
                    ) {
                        return;
                    }

                    const response = await commands.appVrchatLogTailRead({
                        fileName: selectedFileName,
                        afterLineNumber: lastLineNumberRef.current,
                        fileSize: lastFileSizeRef.current,
                        limit: TAIL_LIMIT,
                        query: searchQuery.trim() || null,
                        levels,
                        categories: selectedCategories.length
                            ? selectedCategories
                            : null
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
                            const existingKeys = new Set(current.map(entryKey));
                            const nextEntries = mergeEntries(
                                current,
                                response.entries,
                                true
                            );
                            const addedCount = response.entries.filter(
                                (entry) => !existingKeys.has(entryKey(entry))
                            ).length;
                            if (addedCount) {
                                setTotalEntries(
                                    (currentTotal) => currentTotal + addedCount
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

    function toggleEntrySelected(
        entry: VrchatLogEntryOutput,
        checked: boolean
    ) {
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

    return {
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
        categoryButtonLabel,
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
    };
}
