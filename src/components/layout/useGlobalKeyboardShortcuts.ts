import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { useRightSidePanelVisibility } from './useRightSidePanelVisibility';

export function isEditableTarget(target: any) {
    if (!target || typeof target.tagName !== 'string') {
        return false;
    }
    const tag = target.tagName.toLowerCase();
    return (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target.isContentEditable === true
    );
}

export function useGlobalKeyboardShortcuts() {
    const navigate = useNavigate();
    const location = useLocation();
    const { toggleSidePanelOpen } = useRightSidePanelVisibility(
        location.pathname
    );
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
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

            if (isEditableTarget(event.target)) {
                return;
            }
            const sessionReady =
                useSessionStore.getState().sessionPhase === 'ready';

            if (key === '/') {
                event.preventDefault();
                setSystemHostOpen('keyboardShortcutsOpen', true);
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

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [navigate, setSystemHostOpen, toggleSidePanelOpen]);
}
