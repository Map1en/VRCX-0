// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import { useSidebarAutoHideStore } from '@/state/sidebarAutoHideStore';

import { SidebarAutoHideSetting } from './SidebarAutoHideSetting';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));
vi.mock('@/services/sidebarAutoHideService', () => ({
    setSidebarAutoHideEnabled: vi.fn()
}));
vi.mock('@/services/shellIntegrationService', () => ({
    setTaskbarOverlayNotification: vi.fn(),
    setTrayIconNotification: vi.fn()
}));

let container: HTMLDivElement;
let root: Root;

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useShellStore.setState({ windowDisplayMode: 'sidebar' });
    useSidebarAutoHideStore.setState({
        enabled: false,
        failed: false,
        hydrated: true
    });
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

describe('sidebar auto-hide setting', () => {
    it.each(['windows', 'macos'] as const)(
        'shows only in sidebar mode on %s',
        async (platform) => {
            useRuntimeStore.setState((state) => ({
                hostCapabilities: { ...state.hostCapabilities, platform }
            }));
            await act(async () => root.render(<SidebarAutoHideSetting />));
            expect(container.textContent).toContain(
                'side_panel.settings.auto_hide.label'
            );
            expect(container.querySelector('[role="switch"]')).not.toBeNull();
            expect(
                container.querySelector('[data-slot="separator"]')
            ).toBeNull();
            await act(async () => {
                useShellStore.setState({ windowDisplayMode: 'normal' });
            });
            expect(container.textContent).toBe('');
        }
    );

    it('omits the setting on Linux even if an enabled preference was restored', async () => {
        useRuntimeStore.setState((state) => ({
            hostCapabilities: { ...state.hostCapabilities, platform: 'linux' }
        }));
        useSidebarAutoHideStore.setState({ enabled: true });
        await act(async () => root.render(<SidebarAutoHideSetting />));
        expect(container.textContent).toBe('');
    });
});
