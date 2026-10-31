import type { RowData } from '@tanstack/react-table';
import {
    useEffect,
    useEffectEvent,
    useRef,
    useState,
    type KeyboardEvent,
    type PointerEvent
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';

import type { AppHeader } from './appTable';
import { findColumnSizingRoot, getColumnSizeVarName } from './columnSizing';

type ColumnResizeSession = {
    handle: HTMLElement;
    pointerId: number;
    root: HTMLElement | null;
    size: number;
    startWidth: number;
    startX: number;
};

function clampColumnSize<TRow extends RowData>(
    header: AppHeader<TRow>,
    size: number
) {
    const minSize = header.column.columnDef.minSize ?? 20;
    const maxSize = header.column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;
    return Math.min(maxSize, Math.max(minSize, Math.round(size)));
}

function measureColumnWidth<TRow extends RowData>(
    handle: HTMLElement,
    header: AppHeader<TRow>
) {
    const cell = handle.closest('th') ?? handle.parentElement;
    return cell?.getBoundingClientRect().width || header.column.getSize();
}

function getResizeDirection<TRow extends RowData>(header: AppHeader<TRow>) {
    return header.getContext().table.options.columnResizeDirection === 'rtl'
        ? -1
        : 1;
}

function commitColumnSize<TRow extends RowData>(
    header: AppHeader<TRow>,
    size: number
) {
    header.getContext().table.setColumnSizing((current) => ({
        ...current,
        [header.column.id]: size
    }));
}

export function DataTableColumnResizeHandle<TRow extends RowData>({
    header,
    label
}: {
    header: AppHeader<TRow>;
    label: string;
}) {
    const { t } = useTranslation();
    const minSize = header.column.columnDef.minSize ?? 20;
    const maxSize = header.column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;
    const size = header.column.getSize();
    const sizeVarName = getColumnSizeVarName(header.column.id);
    const sessionRef = useRef<ColumnResizeSession | null>(null);
    const frameRef = useRef<number | null>(null);
    const [resizing, setResizing] = useState(false);

    function applyPreview(session: ColumnResizeSession) {
        session.root?.style.setProperty(sizeVarName, `${session.size}px`);
    }

    function cancelPreviewFrame() {
        if (frameRef.current !== null) {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }
    }

    function finishResize(commit: boolean) {
        const session = sessionRef.current;
        if (!session) {
            return;
        }
        sessionRef.current = null;
        cancelPreviewFrame();
        setResizing(false);
        if (session.handle.hasPointerCapture(session.pointerId)) {
            session.handle.releasePointerCapture(session.pointerId);
        }
        if (commit && session.size !== header.column.getSize()) {
            applyPreview(session);
            commitColumnSize(header, session.size);
            return;
        }
        session.root?.style.setProperty(
            sizeVarName,
            `${header.column.getSize()}px`
        );
    }

    function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const startWidth = measureColumnWidth(event.currentTarget, header);
        sessionRef.current = {
            handle: event.currentTarget,
            pointerId: event.pointerId,
            root: findColumnSizingRoot(event.currentTarget),
            size: clampColumnSize(header, startWidth),
            startWidth,
            startX: event.clientX
        };
        setResizing(true);
    }

    function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
        const session = sessionRef.current;
        if (!session || session.pointerId !== event.pointerId) {
            return;
        }
        session.size = clampColumnSize(
            header,
            session.startWidth +
                (event.clientX - session.startX) * getResizeDirection(header)
        );
        if (frameRef.current !== null) {
            return;
        }
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            applyPreview(session);
        });
    }

    function handlePointerEnd(event: PointerEvent<HTMLButtonElement>) {
        if (sessionRef.current?.pointerId !== event.pointerId) {
            return;
        }
        finishResize(event.type !== 'pointercancel');
    }

    const cancelResize = useEffectEvent(() => finishResize(false));

    useEffect(() => {
        if (!resizing) {
            return undefined;
        }
        const handleEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            cancelResize();
        };
        window.addEventListener('keydown', handleEscape, true);
        return () => window.removeEventListener('keydown', handleEscape, true);
    }, [resizing]);

    function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
            return;
        }
        event.preventDefault();
        const step = event.shiftKey ? 32 : 16;
        const delta =
            (event.key === 'ArrowRight' ? step : -step) *
            getResizeDirection(header);
        commitColumnSize(
            header,
            clampColumnSize(
                header,
                measureColumnWidth(event.currentTarget, header) + delta
            )
        );
    }

    return (
        <Button
            type="button"
            variant="ghost"
            role="separator"
            aria-label={t('accessibility.resize_column', { column: label })}
            aria-orientation="vertical"
            aria-valuemin={minSize}
            aria-valuemax={maxSize}
            aria-valuenow={size}
            aria-valuetext={t('accessibility.column_width_value', {
                value: size
            })}
            data-resizing={resizing ? '' : undefined}
            className="vrcx-0-column-resize absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none rounded-none border-0 bg-transparent p-0 hover:bg-transparent"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onLostPointerCapture={() => finishResize(true)}
            onKeyDown={handleKeyDown}
        />
    );
}
