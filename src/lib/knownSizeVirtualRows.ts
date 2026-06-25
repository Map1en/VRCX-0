type KnownSizeRow = Record<string, unknown> & {
    height?: unknown;
    top?: unknown;
};

type VisibleKnownSizeRowsOptions<T extends KnownSizeRow> = {
    rows?: readonly T[] | null;
    scrollTop?: unknown;
    viewportHeight?: unknown;
    overscan?: unknown;
};

export function positionKnownSizeRows<T extends KnownSizeRow>(
    rows: readonly T[] | null | undefined
) {
    let top = 0;
    const positionedRows = (Array.isArray(rows) ? rows : []).map((row) => {
        const height = Math.max(0, Number(row?.height) || 0);
        const positioned: T & { height: number; top: number } = {
            ...row,
            height,
            top
        };
        top += height;
        return positioned;
    });

    return {
        rows: positionedRows,
        totalHeight: top
    };
}

export function getVisibleKnownSizeRows<T extends KnownSizeRow>({
    rows,
    scrollTop,
    viewportHeight,
    overscan
}: VisibleKnownSizeRowsOptions<T>) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) {
        return [];
    }

    const safeScrollTop = Math.max(0, Number(scrollTop) || 0);
    const safeViewportHeight = Math.max(0, Number(viewportHeight) || 0);
    const safeOverscan = Math.max(0, Number(overscan) || 0);
    const start = Math.max(0, safeScrollTop - safeOverscan);
    const end = safeScrollTop + safeViewportHeight + safeOverscan;

    return safeRows.filter((row) => {
        const top = Math.max(0, Number(row?.top) || 0);
        const height = Math.max(0, Number(row?.height) || 0);
        return top + height >= start && top <= end;
    });
}
