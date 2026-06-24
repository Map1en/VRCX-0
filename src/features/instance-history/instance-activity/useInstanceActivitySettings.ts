import { useEffect, useState } from 'react';

import configRepository from '@/repositories/configRepository';

const DEFAULT_BAR_WIDTH = 25;
const BAR_WIDTH_KEY = 'InstanceActivityBarWidth';
const DETAIL_VISIBLE_KEY = 'VRCX_InstanceActivityDetailVisible';
const SOLO_INSTANCE_VISIBLE_KEY = 'VRCX_InstanceActivitySoloInstanceVisible';
const NO_FRIEND_INSTANCE_VISIBLE_KEY =
    'VRCX_InstanceActivityNoFriendInstanceVisible';
const CHART_COLLAPSED_KEY = 'VRCX_InstanceActivityChartCollapsed';

function normalizeBarWidth(value: number) {
    return Number.isFinite(value)
        ? Math.min(50, Math.max(1, value))
        : DEFAULT_BAR_WIDTH;
}

export function useInstanceActivitySettings() {
    const [barWidth, setBarWidth] = useState(DEFAULT_BAR_WIDTH);
    const [isDetailVisible, setIsDetailVisible] = useState(true);
    const [isSoloInstanceVisible, setIsSoloInstanceVisible] = useState(true);
    const [isNoFriendInstanceVisible, setIsNoFriendInstanceVisible] =
        useState(true);
    const [isChartCollapsed, setIsChartCollapsed] = useState(false);

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getInt(BAR_WIDTH_KEY, DEFAULT_BAR_WIDTH),
            configRepository.getBool(DETAIL_VISIBLE_KEY, true),
            configRepository.getBool(SOLO_INSTANCE_VISIBLE_KEY, true),
            configRepository.getBool(NO_FRIEND_INSTANCE_VISIBLE_KEY, true),
            configRepository.getBool(CHART_COLLAPSED_KEY, false)
        ])
            .then(
                ([
                    nextBarWidth,
                    nextDetailVisible,
                    nextSoloVisible,
                    nextNoFriendVisible,
                    nextChartCollapsed
                ]: [number, boolean, boolean, boolean, boolean]) => {
                    if (!active) {
                        return;
                    }

                    setBarWidth(normalizeBarWidth(nextBarWidth));
                    setIsDetailVisible(Boolean(nextDetailVisible));
                    setIsSoloInstanceVisible(Boolean(nextSoloVisible));
                    setIsNoFriendInstanceVisible(Boolean(nextNoFriendVisible));
                    setIsChartCollapsed(Boolean(nextChartCollapsed));
                }
            )
            .catch(() => {});

        return () => {
            active = false;
        };
    }, []);

    function handleBarWidthCommit(value: number | string) {
        const nextValue = normalizeBarWidth(
            Number.parseInt(String(value), 10) || DEFAULT_BAR_WIDTH
        );
        setBarWidth(nextValue);
        configRepository.setInt(BAR_WIDTH_KEY, nextValue);
    }

    function setDetailVisible(value: boolean) {
        setIsDetailVisible(value);
        configRepository.setBool(DETAIL_VISIBLE_KEY, value);
    }

    function setSoloInstanceVisible(value: boolean) {
        setIsSoloInstanceVisible(value);
        configRepository.setBool(SOLO_INSTANCE_VISIBLE_KEY, value);
    }

    function setNoFriendInstanceVisible(value: boolean) {
        setIsNoFriendInstanceVisible(value);
        configRepository.setBool(NO_FRIEND_INSTANCE_VISIBLE_KEY, value);
    }

    function setChartCollapsed(value: boolean) {
        setIsChartCollapsed(value);
        configRepository.setBool(CHART_COLLAPSED_KEY, value);
    }

    return {
        barWidth,
        isDetailVisible,
        isSoloInstanceVisible,
        isNoFriendInstanceVisible,
        isChartCollapsed,
        handleBarWidthCommit,
        setDetailVisible,
        setSoloInstanceVisible,
        setNoFriendInstanceVisible,
        setChartCollapsed
    };
}
