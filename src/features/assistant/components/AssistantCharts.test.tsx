// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const echartsMock = vi.hoisted(() => {
    const instances: Array<{
        setOption: ReturnType<typeof vi.fn>;
        dispose: ReturnType<typeof vi.fn>;
        resize: ReturnType<typeof vi.fn>;
    }> = [];
    return {
        instances,
        echarts: {
            init: vi.fn(() => {
                const instance = {
                    setOption: vi.fn(),
                    dispose: vi.fn(),
                    resize: vi.fn()
                };
                instances.push(instance);
                return instance;
            }),
            format: { encodeHTML: (text: string) => text }
        }
    };
});
vi.mock('@/lib/echarts', () => ({ echarts: echartsMock.echarts }));

import type { AssistantChart, UIToolCall } from '@/domain/assistant/types';

import { AssistantCharts } from './AssistantCharts';

const observed: Array<{
    element: Element;
    callback: IntersectionObserverCallback;
}> = [];

function setVisible(index: number, isIntersecting: boolean) {
    const { element, callback } = observed[index];
    act(() => {
        callback(
            [{ target: element, isIntersecting } as IntersectionObserverEntry],
            {} as IntersectionObserver
        );
    });
}

function call(name: string, charts: AssistantChart[]): UIToolCall {
    return {
        id: `${name}-${charts.length}`,
        name,
        args: '{}',
        status: 'done',
        summary: '',
        entities: [],
        charts
    };
}

function ranking(kind: AssistantChart['kind'], top: string): AssistantChart {
    return {
        kind,
        axis: 'label',
        points: [
            { key: top, value: 120 },
            { key: 'Other', value: 60 }
        ]
    };
}

describe('AssistantCharts', () => {
    beforeEach(() => {
        observed.length = 0;
        echartsMock.instances.length = 0;
        vi.stubGlobal(
            'IntersectionObserver',
            class {
                constructor(private callback: IntersectionObserverCallback) {}
                observe(element: Element) {
                    observed.push({ element, callback: this.callback });
                }
                disconnect() {}
            }
        );
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe() {}
                disconnect() {}
            }
        );
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('draws charts only near the viewport and frees them when scrolled away', () => {
        render(
            <AssistantCharts
                toolCalls={[
                    call('get_copresence_summary', [
                        ranking('topCompanions', 'Alice')
                    ])
                ]}
            />
        );
        expect(echartsMock.instances).toHaveLength(0);

        setVisible(0, true);
        expect(echartsMock.instances).toHaveLength(1);
        const option =
            echartsMock.instances[0].setOption.mock.calls.at(-1)?.[0];
        expect(option.yAxis.data).toEqual(['Alice', 'Other']);
        expect(option.yAxis.inverse).toBe(true);
        expect(option.series[0].data).toEqual([2, 1]);

        setVisible(0, false);
        expect(echartsMock.instances[0].dispose).toHaveBeenCalledOnce();

        setVisible(0, true);
        expect(echartsMock.instances).toHaveLength(2);
    });

    it('keeps the latest call per tool and reveals charts past the limit on demand', () => {
        render(
            <AssistantCharts
                toolCalls={[
                    call('get_copresence_summary', [
                        ranking('topCompanions', 'Old')
                    ]),
                    call('summarize_social_period', [
                        ranking('topCompanions', 'Hana'),
                        ranking('topWorlds', 'Home')
                    ]),
                    call('get_copresence_summary', [
                        ranking('topCompanions', 'New')
                    ]),
                    call('get_friend_profile', [])
                ]}
            />
        );

        expect(screen.getAllByRole('figure')).toHaveLength(2);
        fireEvent.click(
            screen.getByRole('button', { name: 'assistant.chart.show_more' })
        );
        expect(screen.getAllByRole('figure')).toHaveLength(3);
        expect(screen.queryByRole('button')).toBeNull();

        setVisible(2, true);
        const option =
            echartsMock.instances[0].setOption.mock.calls.at(-1)?.[0];
        expect(option.yAxis.data[0]).toBe('New');
    });
});
