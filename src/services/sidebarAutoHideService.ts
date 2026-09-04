import {
    commands,
    type SidebarAutoHideContext,
    type SidebarAutoHideSnapshot
} from '@/platform/tauri/bindings';
import { tauriEvents } from '@/platform/tauri/events';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import { useSidebarAutoHideStore } from '@/state/sidebarAutoHideStore';

let operations = Promise.resolve();
let interactionBlocked = false;
let lastContext: SidebarAutoHideContext | null = null;
let statusUpdates = 0;

function enqueue(action: () => Promise<void>): Promise<void> {
    const result = operations.then(action, action);
    operations = result.catch(() => undefined);
    return result;
}

export async function initializeSidebarAutoHide(): Promise<void> {
    await enqueue(async () => {
        const generation = statusUpdates;
        const snapshot = await commands.appGetSidebarAutoHide();
        if (generation === statusUpdates) {
            useSidebarAutoHideStore.setState(snapshot);
        }
        useSidebarAutoHideStore.setState({ hydrated: true });
    });
}

export function subscribeSidebarAutoHideState(): Promise<() => void> {
    return tauriEvents.subscribe<SidebarAutoHideSnapshot>(
        'sidebarAutoHideState',
        (snapshot) => {
            statusUpdates += 1;
            useSidebarAutoHideStore.setState(snapshot);
        }
    );
}

export async function setSidebarAutoHideEnabled(
    enabled: boolean
): Promise<void> {
    await enqueue(async () => {
        const generation = statusUpdates;
        const saved = await commands.appSetSidebarAutoHide(enabled);
        if (generation === statusUpdates) {
            useSidebarAutoHideStore.setState({ enabled: saved, failed: false });
        }
    });
}

function readWindowFrameInset(): number {
    const root = document.getElementById('root');
    if (!root) {
        return 0;
    }
    const inset = Number.parseFloat(window.getComputedStyle(root).paddingLeft);
    return Number.isFinite(inset) ? inset : 0;
}

export function syncSidebarAutoHideContext(
    blocked = interactionBlocked
): Promise<void> {
    interactionBlocked = blocked;
    return enqueue(async () => {
        const context: SidebarAutoHideContext = {
            sidebarMode:
                useShellStore.getState().windowDisplayMode === 'sidebar',
            blocked: interactionBlocked,
            reducedMotion:
                usePreferencesStore.getState().reducedMotionAndBlur ||
                window.matchMedia?.('(prefers-reduced-motion: reduce)')
                    .matches === true,
            frameInset: readWindowFrameInset()
        };
        if (
            lastContext?.sidebarMode === context.sidebarMode &&
            lastContext.blocked === context.blocked &&
            lastContext.reducedMotion === context.reducedMotion &&
            lastContext.frameInset === context.frameInset
        ) {
            return;
        }
        await commands.appSetSidebarAutoHideContext(context);
        lastContext = context;
    });
}

export async function suspendSidebarAutoHide(
    suspended: boolean
): Promise<void> {
    const platform = useRuntimeStore.getState().hostCapabilities.platform;
    if (platform !== 'windows' && platform !== 'macos') {
        return;
    }
    if (!suspended) {
        await syncSidebarAutoHideContext();
    }
    await enqueue(async () => {
        await commands.appSuspendSidebarAutoHide(suspended);
    });
}

export function isSidebarAutoHideInteractionBlocked(): boolean {
    if (
        document.hasFocus() &&
        document.activeElement?.matches(
            'input, textarea, [contenteditable="true"], [role="textbox"]'
        )
    ) {
        return true;
    }
    return Array.from(
        document.querySelectorAll<HTMLElement>(
            '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"]'
        )
    ).some(
        (element) =>
            !element.closest(
                '[hidden], [inert], [data-base-ui-inert], [aria-hidden="true"], [data-closed]'
            ) && element.closest('[data-open], [aria-modal="true"]') !== null
    );
}

export function observeSidebarAutoHideInteractions(
    onChange: (blocked: boolean) => void
): () => void {
    let disposed = false;
    let queued = false;
    let composing = false;
    const update = () => {
        if (queued || disposed) {
            return;
        }
        queued = true;
        queueMicrotask(() => {
            queued = false;
            if (!disposed && document.visibilityState !== 'hidden') {
                onChange(composing || isSidebarAutoHideInteractionBlocked());
            }
        });
    };
    const overlays = new MutationObserver(update);
    const refreshPortals = () => {
        overlays.disconnect();
        for (const element of document.body.children) {
            if (element.id === 'root') {
                continue;
            }
            overlays.observe(element, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: [
                    'data-open',
                    'data-closed',
                    'data-base-ui-inert',
                    'aria-hidden',
                    'hidden',
                    'inert',
                    'role',
                    'aria-modal'
                ]
            });
        }
        update();
    };
    const portals = new MutationObserver(refreshPortals);
    portals.observe(document.body, { childList: true });
    refreshPortals();
    const setComposing = (event: Event) => {
        composing = event.type === 'compositionstart';
        update();
    };
    const listeners: [EventTarget, string, EventListener][] = [
        [document, 'focusin', update],
        [document, 'focusout', update],
        [document, 'visibilitychange', update],
        [document, 'compositionstart', setComposing],
        [document, 'compositionend', setComposing],
        [window, 'focus', update],
        [window, 'blur', update]
    ];
    for (const [target, type, listener] of listeners) {
        target.addEventListener(type, listener);
    }
    return () => {
        disposed = true;
        portals.disconnect();
        overlays.disconnect();
        for (const [target, type, listener] of listeners) {
            target.removeEventListener(type, listener);
        }
    };
}
