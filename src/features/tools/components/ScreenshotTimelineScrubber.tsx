import { useMemo, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { formatScreenshotMonth } from '@/lib/dateTime';
import { cn } from '@/lib/utils';

import {
    findTimelineMarkAt,
    type ScreenshotTimelineMark
} from '../screenshotTimeline';

const YEAR_LABEL_MIN_GAP = 0.06;

function clampRatio(value: number) {
    return Math.min(1, Math.max(0, value));
}

export function ScreenshotTimelineScrubber({
    marks,
    totalHeight,
    viewportHeight,
    scrollTop,
    onScrub
}: {
    marks: readonly ScreenshotTimelineMark[];
    totalHeight: number;
    viewportHeight: number;
    scrollTop: number;
    onScrub: (scrollTop: number) => void;
}) {
    const { i18n, t } = useTranslation();
    const locale = i18n.resolvedLanguage || i18n.language;
    const [hoverRatio, setHoverRatio] = useState<number | null>(null);
    const [scrubbing, setScrubbing] = useState(false);
    const maxScroll = Math.max(1, totalHeight - viewportHeight);
    const yearLabels = useMemo(() => {
        const labels: Array<{ year: string; ratio: number }> = [];
        for (const mark of marks) {
            const ratio = clampRatio(mark.top / maxScroll);
            const previous = labels.at(-1);
            if (
                previous?.year !== mark.year &&
                (!previous || ratio - previous.ratio >= YEAR_LABEL_MIN_GAP)
            ) {
                labels.push({ year: mark.year, ratio });
            }
        }
        return labels;
    }, [marks, maxScroll]);

    if (totalHeight <= viewportHeight) {
        return null;
    }

    const scrollRatio = clampRatio(scrollTop / maxScroll);
    const activeRatio = hoverRatio ?? scrollRatio;
    const activeMark = findTimelineMarkAt(marks, activeRatio * maxScroll);

    function ratioFromPointer(event: PointerEvent<HTMLDivElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        return rect.height > 0
            ? clampRatio((event.clientY - rect.top) / rect.height)
            : 0;
    }

    return (
        <div
            role="slider"
            aria-label={t('dialog.screenshot_metadata.timeline_scrubber')}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(scrollRatio * 100)}
            aria-valuetext={
                activeMark
                    ? formatScreenshotMonth(activeMark.monthStartMs, locale)
                    : undefined
            }
            tabIndex={-1}
            className="group/scrubber relative ml-1 w-12 shrink-0 cursor-ns-resize touch-none select-none"
            onPointerDown={(event) => {
                if (event.button !== 0) {
                    return;
                }
                event.currentTarget.setPointerCapture?.(event.pointerId);
                setScrubbing(true);
                onScrub(ratioFromPointer(event) * maxScroll);
            }}
            onPointerMove={(event) => {
                const ratio = ratioFromPointer(event);
                setHoverRatio(ratio);
                if (scrubbing) {
                    onScrub(ratio * maxScroll);
                }
            }}
            onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                setScrubbing(false);
            }}
            onPointerCancel={() => setScrubbing(false)}
            onPointerLeave={() => {
                if (!scrubbing) {
                    setHoverRatio(null);
                }
            }}
        >
            <div className="absolute inset-y-2 right-2 left-0">
                {marks.map((mark) => (
                    <span
                        key={mark.monthKey}
                        aria-hidden="true"
                        className="bg-muted-foreground/40 absolute right-0 size-1 -translate-y-1/2 rounded-full"
                        style={{
                            top: `${clampRatio(mark.top / maxScroll) * 100}%`
                        }}
                    />
                ))}
                {yearLabels.map((label) => (
                    <span
                        key={label.year}
                        aria-hidden="true"
                        className="text-muted-foreground absolute right-2 -translate-y-1/2 text-[10px] tabular-nums"
                        style={{ top: `${label.ratio * 100}%` }}
                    >
                        {label.year}
                    </span>
                ))}
                <span
                    aria-hidden="true"
                    className="bg-foreground absolute right-0 h-0.5 w-5 -translate-y-1/2 rounded-full"
                    style={{ top: `${scrollRatio * 100}%` }}
                />
                {activeMark ? (
                    <span
                        aria-hidden="true"
                        className={cn(
                            'bg-popover text-popover-foreground pointer-events-none absolute right-7 -translate-y-1/2 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap shadow-sm transition-opacity',
                            hoverRatio === null && !scrubbing
                                ? 'opacity-0'
                                : 'opacity-100'
                        )}
                        style={{ top: `${activeRatio * 100}%` }}
                    >
                        {formatScreenshotMonth(activeMark.monthStartMs, locale)}
                    </span>
                ) : null}
            </div>
        </div>
    );
}
