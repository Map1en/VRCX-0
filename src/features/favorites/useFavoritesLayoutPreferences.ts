// @ts-nocheck
import { useEffect, useRef, useState } from 'react';

import { configRepository } from '@/repositories/index.js';

const SPLITTER_CONFIG_KEYS = {
    friend: 'VRCX_FavoritesFriendSplitter',
    world: 'VRCX_FavoritesWorldSplitter',
    avatar: 'VRCX_FavoritesAvatarSplitter'
};
const SPLITTER_DEFAULT_SIZE_PX = 260;
const SPLITTER_MIN_SIZE_PX = 0;
const CARD_SCALE_CONFIG_KEYS = {
    friend: 'VRCX_FavoritesFriendCardScale',
    world: 'VRCX_FavoritesWorldCardScale',
    avatar: 'VRCX_FavoritesAvatarCardScale'
};
const CARD_SPACING_CONFIG_KEYS = {
    friend: 'VRCX_FavoritesFriendCardSpacing',
    world: 'VRCX_FavoritesWorldCardSpacing',
    avatar: 'VRCX_FavoritesAvatarCardSpacing'
};
const SORT_CONFIG_KEYS = {
    friend: 'VRCX_FavoritesFriendSort',
    world: 'VRCX_FavoritesWorldSort',
    avatar: 'VRCX_FavoritesAvatarSort'
};
const SORT_VALUES_BY_KIND = {
    friend: new Set(['name', 'date']),
    world: new Set(['name', 'date', 'players']),
    avatar: new Set(['name', 'date'])
};
const DEFAULT_SORT_VALUE = 'date';
const CARD_SCALE_SLIDER = { min: 0.6, max: 1, step: 0.01 };
const CARD_SPACING_SLIDER = { min: 0.5, max: 1.5, step: 0.05 };

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function normalizeSplitterSizePx(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return SPLITTER_DEFAULT_SIZE_PX;
    }
    return Math.max(SPLITTER_MIN_SIZE_PX, Math.round(parsed));
}

function normalizeFavoriteSortValue(kind, value) {
    const normalizedValue = String(value ?? '').trim();
    const allowedValues =
        SORT_VALUES_BY_KIND[kind] || SORT_VALUES_BY_KIND.friend;
    return allowedValues.has(normalizedValue)
        ? normalizedValue
        : DEFAULT_SORT_VALUE;
}

export function useFavoritesLayoutPreferences(kind) {
    const [splitterSizePx, setSplitterSizePx] = useState(
        SPLITTER_DEFAULT_SIZE_PX
    );
    const [splitterLayoutVersion, setSplitterLayoutVersion] = useState(0);
    const [cardScale, setCardScale] = useState(1);
    const [cardSpacing, setCardSpacing] = useState(1);
    const [sortValue, setSortValue] = useState(DEFAULT_SORT_VALUE);
    const pendingSplitterSizePxRef = useRef(null);
    const sortLoadVersionRef = useRef(0);

    useEffect(() => {
        let active = true;
        const configKey = SPLITTER_CONFIG_KEYS[kind];
        configRepository
            .getString(configKey, '260')
            .then((value) => {
                if (!active) {
                    return;
                }
                const parsed = Number(value);
                if (!Number.isFinite(parsed) || parsed < 0) {
                    setSplitterSizePx(SPLITTER_DEFAULT_SIZE_PX);
                    setSplitterLayoutVersion((version) => version + 1);
                    return;
                }
                setSplitterSizePx(normalizeSplitterSizePx(parsed));
                setSplitterLayoutVersion((version) => version + 1);
            })
            .catch(() => {
                if (active) {
                    setSplitterSizePx(SPLITTER_DEFAULT_SIZE_PX);
                    setSplitterLayoutVersion((version) => version + 1);
                }
            });

        return () => {
            active = false;
        };
    }, [kind]);

    useEffect(() => {
        let active = true;
        const scaleKey = CARD_SCALE_CONFIG_KEYS[kind];
        const spacingKey = CARD_SPACING_CONFIG_KEYS[kind];

        Promise.all([
            configRepository.getString(scaleKey, '1'),
            configRepository.getString(spacingKey, '1')
        ])
            .then(([nextScale, nextSpacing]) => {
                if (!active) {
                    return;
                }
                setCardScale(
                    clampNumber(
                        nextScale,
                        CARD_SCALE_SLIDER.min,
                        CARD_SCALE_SLIDER.max,
                        1
                    )
                );
                setCardSpacing(
                    clampNumber(
                        nextSpacing,
                        CARD_SPACING_SLIDER.min,
                        CARD_SPACING_SLIDER.max,
                        1
                    )
                );
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setCardScale(1);
                setCardSpacing(1);
            });

        return () => {
            active = false;
        };
    }, [kind]);

    useEffect(() => {
        let active = true;
        const loadVersion = sortLoadVersionRef.current;
        const sortKey = SORT_CONFIG_KEYS[kind];

        setSortValue((current) => normalizeFavoriteSortValue(kind, current));

        configRepository
            .getString(sortKey, DEFAULT_SORT_VALUE)
            .then((value) => {
                if (active && sortLoadVersionRef.current === loadVersion) {
                    setSortValue(normalizeFavoriteSortValue(kind, value));
                }
            })
            .catch(() => {
                if (active && sortLoadVersionRef.current === loadVersion) {
                    setSortValue(DEFAULT_SORT_VALUE);
                }
            });

        return () => {
            active = false;
        };
    }, [kind]);

    const handleCardScaleChange = (value) => {
        const nextValue = clampNumber(
            value,
            CARD_SCALE_SLIDER.min,
            CARD_SCALE_SLIDER.max,
            1
        );
        setCardScale(nextValue);
        void configRepository.setString(
            CARD_SCALE_CONFIG_KEYS[kind],
            String(nextValue)
        );
    };

    const handleCardSpacingChange = (value) => {
        const nextValue = clampNumber(
            value,
            CARD_SPACING_SLIDER.min,
            CARD_SPACING_SLIDER.max,
            1
        );
        setCardSpacing(nextValue);
        void configRepository.setString(
            CARD_SPACING_CONFIG_KEYS[kind],
            String(nextValue)
        );
    };

    const handleSortValueChange = (value) => {
        const nextValue = normalizeFavoriteSortValue(kind, value);
        sortLoadVersionRef.current += 1;
        setSortValue(nextValue);
        void configRepository.setString(SORT_CONFIG_KEYS[kind], nextValue);
    };

    function persistSplitterSizePx(nextSizePx) {
        const normalizedSizePx = normalizeSplitterSizePx(nextSizePx);
        setSplitterSizePx(normalizedSizePx);
        void configRepository.setString(
            SPLITTER_CONFIG_KEYS[kind],
            String(normalizedSizePx)
        );
    }

    function handleSplitterResize(panelSize) {
        const nextSizePx = Number(panelSize?.inPixels);
        if (!Number.isFinite(nextSizePx) || nextSizePx < 0) {
            return;
        }
        pendingSplitterSizePxRef.current = normalizeSplitterSizePx(nextSizePx);
    }

    function persistSplitterLayout() {
        const pendingSizePx = pendingSplitterSizePxRef.current;
        pendingSplitterSizePxRef.current = null;
        if (Number.isFinite(pendingSizePx)) {
            persistSplitterSizePx(pendingSizePx);
        }
    }

    return {
        cardScale,
        cardSpacing,
        handleCardScaleChange,
        handleCardSpacingChange,
        handleSortValueChange,
        handleSplitterResize,
        persistSplitterLayout,
        sortValue: normalizeFavoriteSortValue(kind, sortValue),
        splitterLayoutVersion,
        splitterSizePx
    };
}
