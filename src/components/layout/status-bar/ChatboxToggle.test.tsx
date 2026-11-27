// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    commands,
    type ChatboxConfig,
    type ChatboxStatus
} from '@/platform/tauri/bindings';
import { useChatboxStore } from '@/state/chatboxStore';
import { useRuntimeStore } from '@/state/runtimeStore';

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));

vi.mock('@/ui/shadcn/hover-card', () => ({
    HoverCard: ({ children }: PropsWithChildren) => <>{children}</>,
    HoverCardContent: ({ children }: PropsWithChildren) => (
        <div role="tooltip">{children}</div>
    ),
    HoverCardTrigger: ({ render }: { render?: ReactNode }) => <>{render}</>
}));

import { ChatboxToggle } from './ChatboxToggle';

function chatboxConfig(patch: Partial<ChatboxConfig> = {}): ChatboxConfig {
    return {
        enabled: false,
        statusEnabled: false,
        pages: [
            { id: 'clock', enabled: true, seconds: 8, lines: [] },
            { id: 'music', enabled: false, seconds: 8, lines: [] }
        ],
        afk: { text: 'AFK', showDuration: true, autoWhenHeadsetRemoved: false },
        messages: {
            quickPhrases: [],
            typingIndicator: false,
            notifySound: false
        },
        oscHost: '127.0.0.1',
        oscPort: 9000,
        ...patch
    };
}

function chatboxStatus(patch: Partial<ChatboxStatus> = {}): ChatboxStatus {
    return {
        activity: 'status',
        pauseReason: null,
        preview: '',
        pageId: 'clock',
        pageNumber: 1,
        pageCount: 1,
        pageDurationSeconds: 8,
        pageElapsedSeconds: 0,
        manualAfk: false,
        vrMode: false,
        ...patch
    };
}

function monitorAvailable(available: boolean) {
    useRuntimeStore.setState((state) => ({
        hostCapabilities: {
            ...state.hostCapabilities,
            gameProcessMonitor: {
                supported: true,
                enabled: true,
                available,
                reason: ''
            }
        }
    }));
}

function renderToggle() {
    return render(
        <MemoryRouter>
            <ChatboxToggle />
        </MemoryRouter>
    );
}

function toggle() {
    return screen.queryByRole('button');
}

beforeEach(() => {
    monitorAvailable(true);
    useChatboxStore.setState({ status: null, savedConfig: null });
    vi.mocked(commands.appChatboxEditorStateGet).mockResolvedValue({
        config: chatboxConfig(),
        limits: {} as never,
        variables: [],
        defaultFormats: {} as never
    });
    vi.mocked(commands.appChatboxStatusGet).mockResolvedValue(null);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('status bar chatbox toggle', () => {
    it('is not offered where the local game cannot be monitored', () => {
        monitorAvailable(false);

        renderToggle();

        expect(toggle()).toBeNull();
        expect(commands.appChatboxEditorStateGet).not.toHaveBeenCalled();
    });

    it('loads the saved settings when the app starts', async () => {
        renderToggle();

        expect(await screen.findByRole('button')).toBeTruthy();
        expect(toggle()?.getAttribute('aria-pressed')).toBe('false');
    });

    it('turns the Chatbox on with one click', async () => {
        vi.mocked(commands.appChatboxEnabledSet).mockResolvedValue(
            chatboxConfig({ enabled: true })
        );
        renderToggle();

        await act(async () => {
            fireEvent.click(await screen.findByRole('button'));
        });

        expect(commands.appChatboxEnabledSet).toHaveBeenCalledWith(true);
        expect(commands.appChatboxStatusEnabledSet).not.toHaveBeenCalled();
        expect(toggle()?.getAttribute('aria-pressed')).toBe('true');
    });

    it('switches a single page from the right-click menu', async () => {
        useChatboxStore.setState({
            savedConfig: chatboxConfig({ statusEnabled: true })
        });
        vi.mocked(commands.appChatboxPageEnabledSet).mockResolvedValue(
            chatboxConfig({ statusEnabled: true })
        );
        renderToggle();

        fireEvent.contextMenu(toggle()!);
        const items = await screen.findAllByRole('menuitemcheckbox');
        const musicPage = items[2];
        expect(musicPage.getAttribute('aria-checked')).toBe('false');
        await act(async () => {
            fireEvent.click(musicPage);
        });

        expect(commands.appChatboxPageEnabledSet).toHaveBeenCalledWith(
            'music',
            true
        );
    });

    it('explains why the status is paused', () => {
        useChatboxStore.setState({
            savedConfig: chatboxConfig({ enabled: true, statusEnabled: true }),
            status: chatboxStatus({ pauseReason: 'gameNotRunning' })
        });

        renderToggle();

        expect(toggle()?.getAttribute('aria-label')).toContain(
            'view.tools.chatbox.status.game_not_running'
        );
    });
});
