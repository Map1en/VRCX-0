// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    normalizePinnedToolKey,
    toolDefinitionMap,
    type ToolDefinition
} from '@/shared/constants/tools';

const mocks = vi.hoisted(() => ({
    triggerTool: vi.fn(),
    state: {} as Record<string, unknown>
}));

vi.mock('../useToolsPageState', () => ({
    useToolsPageState: () => mocks.state
}));

vi.mock('@/lib/useRouteScrollMemory', () => ({
    useRouteScrollMemory: () => undefined
}));

vi.mock('@/lib/useActiveScrollSection', () => ({
    useActiveScrollSection: () => ({ activeId: '', scrollTo: vi.fn() })
}));

import { ToolsPageContent } from './ToolsPageContent';

function tool(key: string): ToolDefinition {
    const definition = toolDefinitionMap.get(key);
    if (!definition) {
        throw new Error(`Unknown tool ${key}`);
    }
    return definition;
}

const gallery = tool('gallery');
const chatbox = tool('chatbox');

function setState({ quickAccess = [] as ToolDefinition[] } = {}) {
    mocks.state = {
        addQuickAccessToolByKeyWithFeedback: vi.fn(),
        categories: [
            {
                key: 'test',
                labelKey: 'view.tools.category.test',
                tools: [gallery, chatbox]
            }
        ],
        handleQuickAccessDragEnd: vi.fn(),
        isQuickAccessEditing: false,
        pinToolToNav: vi.fn(),
        pinnedToolKeys: new Set<string>(),
        quickAccessKeySet: new Set(
            quickAccess.map((entry) => normalizePinnedToolKey(entry.key))
        ),
        quickAccessTools: quickAccess,
        recentTools: [],
        removeQuickAccessToolByKey: vi.fn(),
        sensors: [],
        setIsQuickAccessEditing: vi.fn(),
        statusByToolKey: new Map(),
        triggerTool: mocks.triggerTool,
        unpinToolFromNav: vi.fn()
    };
}

describe('ToolsPageContent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setState();
    });

    afterEach(cleanup);

    it('opens a tool from the catalog', () => {
        render(<ToolsPageContent />);

        fireEvent.click(screen.getByText(gallery.titleKey));

        expect(mocks.triggerTool).toHaveBeenCalledWith(gallery);
    });

    it('lists a quick access tool once, outside the catalog', () => {
        setState({ quickAccess: [gallery] });
        render(<ToolsPageContent />);

        expect(screen.getAllByText(gallery.titleKey)).toHaveLength(1);
        expect(screen.getByText(chatbox.titleKey)).toBeTruthy();
    });

    it('searches every tool, including quick access ones, and reports when nothing matches', () => {
        setState({ quickAccess: [gallery] });
        render(<ToolsPageContent />);
        const search = screen.getByPlaceholderText(
            'view.tools.filter_placeholder'
        );

        fireEvent.change(search, { target: { value: gallery.titleKey } });

        expect(screen.queryByText('view.tools.quick_access.header')).toBeNull();
        expect(screen.getAllByText(gallery.titleKey)).toHaveLength(1);
        expect(screen.queryByText(chatbox.titleKey)).toBeNull();

        fireEvent.change(search, { target: { value: 'no such tool' } });

        expect(screen.getByText('view.tools.filter_empty')).toBeTruthy();
    });
});
