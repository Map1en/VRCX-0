import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { echarts } from '@/lib/echarts';

import { buildChartOption } from './instanceActivityChart';

export function useInstanceActivityChartLifecycle({
    barWidth,
    chartRows,
    hour12,
    onYAxisClick,
    resolvedTheme,
    selectedDate
}: any) {
    const { t } = useTranslation();
    const [mainChartElement, setMainChartElement] = useState(null);
    const chartElementRef = useRef<any>(null);
    const chartInstanceRef = useRef<any>(null);
    const chartThemeRef = useRef<any>(null);
    const resizeObserverRef = useRef<any>(null);

    const setMainChartElementRef = useCallback((node: any) => {
        if (chartElementRef.current && chartElementRef.current !== node) {
            resizeObserverRef.current?.disconnect();
            chartInstanceRef.current?.dispose();
            resizeObserverRef.current = null;
            chartInstanceRef.current = null;
            chartThemeRef.current = null;
        }
        chartElementRef.current = node;
        setMainChartElement(node);
    }, []);

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
                chart.resize();
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
                t
            }),
            true
        );
        chart.on('click', (params: any) => {
            if (params.componentType !== 'yAxis') {
                return;
            }

            onYAxisClick(chartRows[params.dataIndex]);
        });
    }, [
        barWidth,
        chartRows,
        hour12,
        mainChartElement,
        onYAxisClick,
        resolvedTheme,
        selectedDate,
        t
    ]);

    return {
        setMainChartElementRef
    };
}
