import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { isTextEntryTarget } from '@/components/keyboard/keyboardShortcutGuards';
import {
    dispatchGlobalShortcut,
    useShortcutHandler
} from '@/components/keyboard/shortcutDispatcher';
import { toast } from '@/services/toastService';
import { toggleCommunityThemeLayersSuppressed } from '@/services/vrcx0CssLayerService';
import {
    restoreNormalWindowModeForIntent,
    runAfterRestoringNormalWindow
} from '@/services/windowModeService';
import { publishNavShortcutRequested } from '@/shared/events/navLayoutEvents';
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

    useShortcutHandler('nav-position', (event) => {
        if (useSessionStore.getState().sessionPhase !== 'ready') {
            return;
        }
        const navShortcutPosition = Number(event.key);
        runAfterRestoringNormalWindow(() => {
            publishNavShortcutRequested(navShortcutPosition);
        });
    });

    useShortcutHandler('theme-safe-mode', () => {
        const suppressed = toggleCommunityThemeLayersSuppressed();
        toast.add({
            type: 'info',
            title: t(
                suppressed
                    ? 'shortcuts.theme_safe_mode_on'
                    : 'shortcuts.theme_safe_mode_off'
            )
        });
    });

    useShortcutHandler('keyboard-shortcuts', () => {
        restoreNormalWindowModeForIntent();
        const keyboardShortcutsOpen =
            useRuntimeStore.getState().systemHosts.keyboardShortcutsOpen;
        setSystemHostOpen('keyboardShortcutsOpen', !keyboardShortcutsOpen);
    });

    useShortcutHandler(
        'settings',
        () => {
            void navigate('/settings');
        },
        sessionReady
    );

    useShortcutHandler('friends-sidebar', toggleSidePanelOpen, sessionReady);

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

            dispatchGlobalShortcut(event, isMacHost);
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
    }, [isMacHost, sessionReady, setShortcutHintsVisible]);
}
