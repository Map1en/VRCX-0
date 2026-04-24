import { useEffect, useState } from 'react';

import { configRepository } from '@/repositories/index.js';

const DEFAULT_BAR_WIDTH = 25;
const BAR_WIDTH_KEY = 'InstanceActivityBarWidth';
const DETAIL_VISIBLE_KEY = 'VRCX_InstanceActivityDetailVisible';
const SOLO_INSTANCE_VISIBLE_KEY = 'VRCX_InstanceActivitySoloInstanceVisible';
const NO_FRIEND_INSTANCE_VISIBLE_KEY =
    'VRCX_InstanceActivityNoFriendInstanceVisible';

function normalizeBarWidth(value) {
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

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getInt(BAR_WIDTH_KEY, DEFAULT_BAR_WIDTH),
            configRepository.getBool(DETAIL_VISIBLE_KEY, true),
            configRepository.getBool(SOLO_INSTANCE_VISIBLE_KEY, true),
            configRepository.getBool(NO_FRIEND_INSTANCE_VISIBLE_KEY, true)
        ])
            .then(
                ([
                    nextBarWidth,
                    nextDetailVisible,
                    nextSoloVisible,
                    nextNoFriendVisible
                ]) => {
                    if (!active) {
                        return;
                    }

                    setBarWidth(normalizeBarWidth(nextBarWidth));
                    setIsDetailVisible(Boolean(nextDetailVisible));
                    setIsSoloInstanceVisible(Boolean(nextSoloVisible));
                    setIsNoFriendInstanceVisible(Boolean(nextNoFriendVisible));
                }
            )
            .catch(() => {});

        return () => {
            active = false;
        };
    }, []);

    function handleBarWidthCommit(value) {
        const nextValue = normalizeBarWidth(
            Number.parseInt(value, 10) || DEFAULT_BAR_WIDTH
        );
        setBarWidth(nextValue);
        void configRepository.setInt(BAR_WIDTH_KEY, nextValue);
    }

    function setDetailVisible(value) {
        setIsDetailVisible(value);
        void configRepository.setBool(DETAIL_VISIBLE_KEY, value);
    }

    function setSoloInstanceVisible(value) {
        setIsSoloInstanceVisible(value);
        void configRepository.setBool(SOLO_INSTANCE_VISIBLE_KEY, value);
    }

    function setNoFriendInstanceVisible(value) {
        setIsNoFriendInstanceVisible(value);
        void configRepository.setBool(NO_FRIEND_INSTANCE_VISIBLE_KEY, value);
    }

    return {
        barWidth,
        isDetailVisible,
        isSoloInstanceVisible,
        isNoFriendInstanceVisible,
        handleBarWidthCommit,
        setDetailVisible,
        setSoloInstanceVisible,
        setNoFriendInstanceVisible
    };
}
