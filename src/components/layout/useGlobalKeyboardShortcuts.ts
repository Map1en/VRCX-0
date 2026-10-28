import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { isTextEntryTarget } from '@/components/keyboard/keyboardShortcutGuards';
import { toast } from '@/services/toastService';
import { toggleCommunityThemeLayersSuppressed } from '@/services/vrcx0CssLayerService';
import {
    restoreNormalWindowModeForIntent,
    runAfterRestoringNormalWindow
} from '@/services/windowModeService';
import {
    NAV_SHORTCUT_POSITION_LIMIT,
    publishNavShortcutRequested
} from '@/shared/events/navLayoutEvents';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';

import { useRightSidePanelVisibility } from './useRightSidePanelVisibility';

const SHORTCUT_HINT_HOLD_DELAY_MS = 160;

export function useGlobalKeyboardShortcuts() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const { toggleSidePanelOpen } = useRightSidePanelVisibility(
        location.pathname
    );
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const isMacHost = useRuntimeStore(
        (state) => state.hostCapabilities.platform === 'macos'
    );
    const sessionReady = useSessionStore(
        (state) => state.sessionPhase === 'ready'
    );
    const setShortcutHintsVisible = useShellStore(
        (state) => state.setShortcutHintsVisible
    );

    useEffect(() => {
        const primaryModifierKey = isMacHost ? 'Meta' : 'Control';
        let primaryModifierHeld = false;
        let shortcutHintsSuppressed = false;
        let shortcutHintTimer: number | null = null;

        function clearShortcutHintTimer() {
            if (shortcutHintTimer === null) {
                return;
            }
            window.clearTimeout(shortcutHintTimer);
            shortcutHintTimer = null;
        }

        function hideShortcutHints() {
            clearShortcutHintTimer();
            setShortcutHintsVisible(false);
        }

        function resetShortcutHints() {
            primaryModifierHeld = false;
            shortcutHintsSuppressed = false;
            hideShortcutHints();
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === primaryModifierKey) {
                primaryModifierHeld = true;
                if (
                    event.repeat ||
                    event.defaultPrevented ||
                    shortcutHintsSuppressed ||
                    isTextEntryTarget(event.target) ||
                    !sessionReady
                ) {
                    return;
                }

                clearShortcutHintTimer();
                shortcutHintTimer = window.setTimeout(() => {
                    shortcutHintTimer = null;
                    if (
                        primaryModifierHeld &&
                        !shortcutHintsSuppressed &&
                        !isTextEntryTarget(document.activeElement) &&
                        sessionReady
                    ) {
                        setShortcutHintsVisible(true);
                    }
                }, SHORTCUT_HINT_HOLD_DELAY_MS);
                return;
            }

            if (primaryModifierHeld) {
                shortcutHintsSuppressed = true;
                hideShortcutHints();
            }

            if (!(event.ctrlKey || event.metaKey)) {
                return;
            }

            const key = event.key.toLowerCase();

            // Suppress the WebView2 print dialog everywhere, including while a
            // text field is focused, so it must run before the editable guard.
            if (key === 'p' && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                return;
            }

            const navShortcutPosition = Number(key);
            if (
                Number.isInteger(navShortcutPosition) &&
                navShortcutPosition >= 1 &&
                navShortcutPosition <= NAV_SHORTCUT_POSITION_LIMIT &&
                !event.shiftKey &&
                !event.altKey
            ) {
                const handledElsewhere = event.defaultPrevented;
                event.preventDefault();
                if (
                    handledElsewhere ||
                    event.repeat ||
                    isTextEntryTarget(event.target) ||
                    useSessionStore.getState().sessionPhase !== 'ready'
                ) {
                    return;
                }
                runAfterRestoringNormalWindow(() => {
                    publishNavShortcutRequested(navShortcutPosition);
                });
                return;
            }

            if (isTextEntryTarget(event.target)) {
                return;
            }
            if (key === 't' && event.altKey && event.shiftKey) {
                event.preventDefault();
                const suppressed = toggleCommunityThemeLayersSuppressed();
                toast.add({
                    type: 'info',
                    title: t(
                        suppressed
                            ? 'shortcuts.theme_safe_mode_on'
                            : 'shortcuts.theme_safe_mode_off'
                    )
                });
                return;
            }
            if (key === '/') {
                event.preventDefault();
                restoreNormalWindowModeForIntent();
                const keyboardShortcutsOpen =
                    useRuntimeStore.getState().systemHosts
                        .keyboardShortcutsOpen;
                setSystemHostOpen(
                    'keyboardShortcutsOpen',
                    !keyboardShortcutsOpen
                );
                return;
            }

            if (!sessionReady) {
                return;
            }

            if (key === ',') {
                event.preventDefault();
                navigate('/settings');
                return;
            }

            if (key === 'b' && event.shiftKey) {
                event.preventDefault();
                toggleSidePanelOpen();
            }
        }

        function handleKeyUp(event: KeyboardEvent) {
            if (event.key !== primaryModifierKey) {
                return;
            }
            primaryModifierHeld = isMacHost ? event.metaKey : event.ctrlKey;
            if (!primaryModifierHeld) {
                shortcutHintsSuppressed = false;
                hideShortcutHints();
            }
        }

        function handleVisibilityChange() {
            if (document.visibilityState === 'hidden') {
                resetShortcutHints();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', resetShortcutHints);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', resetShortcutHints);
            document.removeEventListener(
                'visibilitychange',
                handleVisibilityChange
            );
            hideShortcutHints();
        };
    }, [
        isMacHost,
        navigate,
        sessionReady,
        setShortcutHintsVisible,
        setSystemHostOpen,
        t,
        toggleSidePanelOpen
    ]);
}
