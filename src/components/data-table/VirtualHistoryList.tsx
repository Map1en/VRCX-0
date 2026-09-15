import { ArrowUpToLineIcon } from 'lucide-react';
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode
} from 'react';

import { useVirtualSidebarRows } from '@/components/sidebar/useVirtualSidebarRows';
import { Button } from '@/ui/shadcn/button';

export function VirtualHistoryList<TRow extends { key: string }>({
    rows,
    estimatedRowHeight,
    resetKey,
    minWidth,
    header,
    renderRow,
    rowClassName,
    emptyState,
    footer,
    hasMore,
    loadingOlder,
    onLoadOlder,
    hasUnloadedLatest = false,
    onReloadLatest,
    onViewingLatestChange,
    latestLabel
}: {
    rows: TRow[];
    estimatedRowHeight: number;
    resetKey: string;
    minWidth: number;
    header: ReactNode;
    renderRow(row: TRow): ReactNode;
    rowClassName?(row: TRow): string | undefined;
    emptyState?: ReactNode;
    footer: ReactNode;
    hasMore: boolean;
    loadingOlder: boolean;
    onLoadOlder(): void;
    hasUnloadedLatest?: boolean;
    onReloadLatest?(): void;
    onViewingLatestChange?(value: boolean): void;
    latestLabel: string;
}) {
    const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
    const estimateSize = useCallback(
        () => estimatedRowHeight,
        [estimatedRowHeight]
    );
    const {
        getRowRef,
        scrollToStart,
        scrollTop,
        totalSize,
        viewportRef,
        virtualItems
    } = useVirtualSidebarRows(rows, estimateSize, {
        preserveScrollAnchor: true,
        resetKey,
        keepMountedKey: focusedRowKey
    });
    const [viewportElement, setViewportElement] =
        useState<HTMLDivElement | null>(null);
    const headerViewportRef = useRef<HTMLDivElement | null>(null);
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const setViewportRef = useCallback(
        (element: HTMLDivElement | null) => {
            setViewportElement(element);
            viewportRef(element);
        },
        [viewportRef]
    );

    useEffect(() => {
        if (!viewportElement) return;
        const syncScroll = () => {
            if (headerViewportRef.current) {
                headerViewportRef.current.scrollLeft =
                    viewportElement.scrollLeft;
            }
            onViewingLatestChange?.(
                viewportElement.scrollTop <= estimatedRowHeight
            );
        };
        syncScroll();
        viewportElement.addEventListener('scroll', syncScroll, {
            passive: true
        });
        return () => viewportElement.removeEventListener('scroll', syncScroll);
    }, [estimatedRowHeight, onViewingLatestChange, viewportElement]);

    useEffect(() => {
        if (
            !hasMore ||
            loadingOlder ||
            typeof IntersectionObserver !== 'function'
        )
            return;
        const sentinel = sentinelRef.current;
        if (!viewportElement || !sentinel) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting))
                    onLoadOlder();
            },
            { root: viewportElement, rootMargin: '320px' }
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, loadingOlder, onLoadOlder, rows.length, viewportElement]);

    return (
        <div className="vrcx-0-data-table relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
                ref={headerViewportRef}
                className="shrink-0 overflow-hidden border-b bg-[var(--vrcx-0-table-header-surface)]"
            >
                {header}
            </div>
            {hasUnloadedLatest || scrollTop > estimatedRowHeight ? (
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="bg-popover/95 absolute top-[calc(var(--vrcx-0-table-header-height)+0.5rem)] left-1/2 z-20 h-7 -translate-x-1/2 rounded-full border px-3 text-xs shadow-md backdrop-blur"
                    onClick={hasUnloadedLatest ? onReloadLatest : scrollToStart}
                >
                    <ArrowUpToLineIcon data-icon="inline-start" />
                    {latestLabel}
                </Button>
            ) : null}
            <div
                ref={setViewportRef}
                className="min-h-0 flex-1 overflow-auto [overflow-anchor:none]"
                onFocusCapture={(event) =>
                    setFocusedRowKey(
                        event.target.closest<HTMLElement>(
                            '[data-virtual-row-key]'
                        )?.dataset.virtualRowKey ?? null
                    )
                }
                onBlurCapture={(event) => {
                    if (event.relatedTarget instanceof HTMLElement) {
                        setFocusedRowKey(
                            event.relatedTarget.closest<HTMLElement>(
                                '[data-virtual-row-key]'
                            )?.dataset.virtualRowKey ?? null
                        );
                    } else {
                        setFocusedRowKey(null);
                    }
                }}
            >
                {rows.length || hasMore ? (
                    <>
                        <div
                            className="relative"
                            style={{ height: totalSize, minWidth }}
                        >
                            {virtualItems.map(({ key, row, start }) => (
                                <div
                                    key={key}
                                    ref={getRowRef(key)}
                                    data-virtual-row-key={key}
                                    className={`absolute right-0 left-0 ${rowClassName?.(row) ?? ''}`}
                                    style={{
                                        transform: `translateY(${start}px)`
                                    }}
                                >
                                    {renderRow(row)}
                                </div>
                            ))}
                        </div>
                        <div
                            ref={sentinelRef}
                            className="text-muted-foreground flex min-h-10 items-center justify-center px-3 py-2 text-sm"
                        >
                            {footer}
                        </div>
                    </>
                ) : (
                    <div
                        className="text-muted-foreground flex h-full min-h-24 items-center justify-center px-4 text-center text-sm"
                        style={{ minWidth }}
                    >
                        {emptyState}
                    </div>
                )}
            </div>
        </div>
    );
}
