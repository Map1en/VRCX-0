import { useEffect, useEffectEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
    hasPrimaryModifier,
    useShortcutHandler
} from '@/components/keyboard/shortcutDispatcher';
import { formatZoomPercentage } from '@/services/themeService';
import { toast } from '@/services/toastService';
import {
    queueZoomLevelPreference,
    stepQueuedZoomLevelPreference
} from '@/services/zoomPreferenceService';
import { DEFAULT_ZOOM_LEVEL, ZOOM_STEP } from '@/shared/constants/themes';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

const ZOOM_TOAST_ID = 'app-zoom-level';
const ZOOM_TOAST_TIMEOUT_MS = 1500;
const WHEEL_ZOOM_THRESHOLD = 50;
const WHEEL_GESTURE_IDLE_MS = 200;
const WHEEL_LINE_HEIGHT_PX = 40;
const WHEEL_PAGE_HEIGHT_PX = 800;

function wheelDeltaPixels(event: WheelEvent) {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        return event.deltaY * WHEEL_LINE_HEIGHT_PX;
    }
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        return event.deltaY * WHEEL_PAGE_HEIGHT_PX;
    }
    return event.deltaY;
}

export function useAppZoomShortcuts() {
    const { t } = useTranslation();
    const isMacHost = useRuntimeStore(
        (state) => state.hostCapabilities.platform === 'macos'
    );
    const ctrlWheelZoom = usePreferencesStore((state) => state.ctrlWheelZoom);

    function showZoomError(error: unknown) {
        toast.add({
            type: 'error',
            title:
                error instanceof Error
                    ? error.message
                    : t('app_menu.messages.zoom_failed')
        });
    }

    function showZoomLevel(zoom: number) {
        toast.add({
            id: ZOOM_TOAST_ID,
            position: 'bottom-center',
            timeout: ZOOM_TOAST_TIMEOUT_MS,
            title: t('app_menu.messages.zoom_level', {
                value: formatZoomPercentage(zoom)
            }),
            actionProps:
                zoom === DEFAULT_ZOOM_LEVEL
                    ? undefined
                    : {
                          children: t('app_menu.reset_zoom'),
                          onClick: () => {
                              queueZoomLevelPreference(DEFAULT_ZOOM_LEVEL, {
                                  onError: showZoomError
                              });
                          }
                      }
        });
    }

    function stepZoom(delta: number) {
        showZoomLevel(
            stepQueuedZoomLevelPreference(delta, { onError: showZoomError })
        );
    }

    useShortcutHandler('zoom-in', () => stepZoom(ZOOM_STEP));
    useShortcutHandler('zoom-in-plus', () => stepZoom(ZOOM_STEP));
    useShortcutHandler('zoom-out', () => stepZoom(-ZOOM_STEP));
    useShortcutHandler('zoom-reset', () => {
        showZoomLevel(
            queueZoomLevelPreference(DEFAULT_ZOOM_LEVEL, {
                onError: showZoomError
            })
        );
    });

    const onWheelStep = useEffectEvent((direction: 1 | -1) => {
        stepZoom(direction * ZOOM_STEP);
    });

    useEffect(() => {
        if (!ctrlWheelZoom) {
            return undefined;
        }
        let accumulated = 0;
        let lastEventTime = 0;

        function handleWheel(event: WheelEvent) {
            if (
                event.defaultPrevented ||
                !hasPrimaryModifier(event, isMacHost)
            ) {
                return;
            }
            event.preventDefault();
            const delta = wheelDeltaPixels(event);
            if (delta === 0) {
                return;
            }
            if (
                event.timeStamp - lastEventTime > WHEEL_GESTURE_IDLE_MS ||
                Math.sign(delta) !== Math.sign(accumulated)
            ) {
                accumulated = 0;
            }
            lastEventTime = event.timeStamp;
            accumulated += delta;
            if (Math.abs(accumulated) < WHEEL_ZOOM_THRESHOLD) {
                return;
            }
            accumulated = 0;
            onWheelStep(delta < 0 ? 1 : -1);
        }

        window.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            window.removeEventListener('wheel', handleWheel);
        };
    }, [ctrlWheelZoom, isMacHost]);
}
