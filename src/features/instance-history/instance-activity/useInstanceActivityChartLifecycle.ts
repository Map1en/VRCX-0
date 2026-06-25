import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { echarts } from '@/lib/echarts';

import {
    buildChartOption,
    getMainChartClickedRow,
    type ChartEventParams
} from './instanceActivityChart';
import type { InstanceActivityChartRow } from './instanceActivityTypes';

type InstanceActivityChartLifecycleOptions = {
    barWidth: number;
    chartRows: InstanceActivityChartRow[];
    hour12: boolean;
    onRowActivate?: (row: InstanceActivityChartRow) => void;
    onYAxisClick?: (row: InstanceActivityChartRow) => void;
    resolvedTheme: string;
    selectedActivityKey?: string;
    selectedDate: string;
};

export function useInstanceActivityChartLifecycle({
    barWidth,
    chartRows,
    hour12,
    onRowActivate,
    onYAxisClick,
    resolvedTheme,
    selectedActivityKey = '',
    selectedDate
}: InstanceActivityChartLifecycleOptions) {
    const { t } = useTranslation();
    const [mainChartElement, setMainChartElement] =
        useState<HTMLDivElement | null>(null);
    const chartElementRef = useRef<HTMLDivElement | null>(null);
    const chartInstanceRef = useRef<ReturnType<typeof echarts.init> | null>(
        null
    );
    const chartThemeRef = useRef<string | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);

    const setMainChartElementRef = useCallback(
        (node: HTMLDivElement | null) => {
            if (chartElementRef.current && chartElementRef.current !== node) {
                resizeObserverRef.current?.disconnect();
                chartInstanceRef.current?.dispose();
                resizeObserverRef.current = null;
                chartInstanceRef.current = null;
                chartThemeRef.current = null;
            }
            chartElementRef.current = node;
            setMainChartElement(node);
        },
        []
    );

    useEffect(() => {
        return () => {
            resizeObserverRef.current?.disconnect();
            chartInstanceRef.current?.dispose();
            resizeObserverRef.current = null;
            chartInstanceRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!mainChartElement) {
            return;
        }

        const themeName = resolvedTheme === 'dark' ? 'dark' : null;
        let chart = chartInstanceRef.current;

        if (!chart || chartThemeRef.current !== themeName) {
            resizeObserverRef.current?.disconnect();
            chart?.dispose();

            chart = echarts.init(mainChartElement, themeName || undefined);
            chartInstanceRef.current = chart;
            chartThemeRef.current = themeName;

            resizeObserverRef.current = new ResizeObserver(() => {
                chartInstanceRef.current?.resize();
            });
            resizeObserverRef.current.observe(mainChartElement);
        }

        const chartHeight = Math.max(
            220,
            chartRows.length * (barWidth + 10) + 200
        );
        mainChartElement.style.height = `${chartHeight}px`;
        chart.resize({ height: chartHeight });
        chart.off('click');

        if (!chartRows.length) {
            chart.clear();
            return;
        }

        chart.setOption(
            buildChartOption({
                rows: chartRows,
                selectedDate,
                barWidth,
                hour12,
                selectedActivityKey,
                t
            }),
            true
        );
        chart.on('click', (params: ChartEventParams) => {
            const row = getMainChartClickedRow(params, chartRows);
            if (!row) {
                return;
            }

            if (typeof onRowActivate === 'function') {
                onRowActivate(row);
                return;
            }
            onYAxisClick?.(row);
        });
    }, [
        barWidth,
        chartRows,
        hour12,
        mainChartElement,
        onRowActivate,
        onYAxisClick,
        resolvedTheme,
        selectedActivityKey,
        selectedDate,
        t
    ]);

    return {
        setMainChartElementRef
    };
}
