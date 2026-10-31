import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

import {
    getSettingsManifestEntry,
    type SettingsManifestEntry
} from '@/shared/constants/settingsManifest';
import { useNavigationCacheStore } from '@/state/navigationCacheStore';

import { useSettingsHighlightStore } from './settingsHighlightStore';

const HIGHLIGHT_DURATION_MS = 2000;
const REVEAL_FRAME_LIMIT = 10;
const FOCUSABLE_CONTROL_SELECTOR = [
    'button:not([disabled]):not([data-setting-reset])',
    'input:not([disabled]):not([aria-hidden="true"]):not([tabindex="-1"])',
    'textarea:not([disabled])',
    '[role="switch"]:not([aria-disabled="true"])',
    '[tabindex]:not([tabindex="-1"])'
].join(', ');

function findSettingRow(entry: SettingsManifestEntry) {
    return document.querySelector<HTMLElement>(
        `[data-setting-id="${CSS.escape(entry.id)}"]`
    );
}

function findSettingCard(entry: SettingsManifestEntry) {
    return document.querySelector<HTMLElement>(
        `[data-settings-card-id="${CSS.escape(entry.cardId)}"]`
    );
}

function revealSetting(row: HTMLElement) {
    row.scrollIntoView({ block: 'center' });
    row.querySelector<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR)?.focus({
        preventScroll: true
    });
}

export function useSettingDeepLink() {
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedSettingId = searchParams.get('setting');
    const setSettingsCardOpen = useNavigationCacheStore(
        (state) => state.setSettingsCardOpen
    );
    const setHighlightedSetting = useSettingsHighlightStore(
        (state) => state.setHighlightedSetting
    );
    const pendingRef = useRef<{ frame: number; timer: number } | null>(null);

    useEffect(
        () => () => {
            if (pendingRef.current) {
                cancelAnimationFrame(pendingRef.current.frame);
                window.clearTimeout(pendingRef.current.timer);
            }
            useSettingsHighlightStore.getState().setHighlightedSetting(null);
        },
        []
    );

    useEffect(() => {
        if (!requestedSettingId) {
            return;
        }
        const entry = getSettingsManifestEntry(requestedSettingId);
        setSearchParams(
            (current) => {
                current.delete('setting');
                if (entry) {
                    current.set('tab', entry.tab);
                }
                return current;
            },
            { replace: true }
        );
        if (!entry) {
            return;
        }
        if (pendingRef.current) {
            cancelAnimationFrame(pendingRef.current.frame);
            window.clearTimeout(pendingRef.current.timer);
        }
        setSettingsCardOpen(entry.cardId, true);
        setHighlightedSetting(entry.id);

        const pending = {
            frame: 0,
            timer: window.setTimeout(() => {
                setHighlightedSetting(null);
            }, HIGHLIGHT_DURATION_MS)
        };
        pendingRef.current = pending;
        let attempts = 0;
        const tryReveal = () => {
            attempts += 1;
            const row = findSettingRow(entry);
            const exhausted = attempts >= REVEAL_FRAME_LIMIT;
            if (row && (row.offsetParent !== null || exhausted)) {
                revealSetting(row);
                return;
            }
            if (!exhausted) {
                pending.frame = requestAnimationFrame(tryReveal);
                return;
            }
            findSettingCard(entry)?.scrollIntoView({ block: 'center' });
        };
        pending.frame = requestAnimationFrame(tryReveal);
    }, [
        requestedSettingId,
        setHighlightedSetting,
        setSearchParams,
        setSettingsCardOpen
    ]);
}
