import { useEffect, useState } from 'react';

import {
    STORAGE_KEYS,
    readStoredText,
    writeStoredText
} from '@/lib/browserStorage';
import configRepository from '@/repositories/configRepository';

const DEFAULT_BAR_WIDTH = 25;
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
    const [barWidth, setBarWidth] = useState(() =>
        normalizeBarWidth(
            Number.parseInt(
                readStoredText(STORAGE_KEYS.instanceActivityBarWidth) ?? '',
                10
            )
        )
    );
    const [isSoloInstanceVisible, setIsSoloInstanceVisible] = useState(true);
    const [isNoFriendInstanceVisible, setIsNoFriendInstanceVisible] =
        useState(true);
    const [isChartCollapsed, setIsChartCollapsed] = useState(false);

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getBool(SOLO_INSTANCE_VISIBLE_KEY, true),
            configRepository.getBool(NO_FRIEND_INSTANCE_VISIBLE_KEY, true),
            configRepository.getBool(CHART_COLLAPSED_KEY, false)
        ])
            .then(
                ([
                    nextSoloVisible,
                    nextNoFriendVisible,
                    nextChartCollapsed
                ]) => {
                    if (!active) {
                        return;
                    }

                    setIsSoloInstanceVisible(nextSoloVisible);
                    setIsNoFriendInstanceVisible(nextNoFriendVisible);
                    setIsChartCollapsed(nextChartCollapsed);
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
        writeStoredText(
            STORAGE_KEYS.instanceActivityBarWidth,
            String(nextValue)
        );
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
        isSoloInstanceVisible,
        isNoFriendInstanceVisible,
        isChartCollapsed,
        handleBarWidthCommit,
        setSoloInstanceVisible,
        setNoFriendInstanceVisible,
        setChartCollapsed
    };
}
