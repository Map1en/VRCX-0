// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GridIcon, TableIcon } from 'lucide-react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { Tabs, TabsContent } from '@/ui/shadcn/tabs';

import {
    ToolbarSearch,
    ToolbarSegmented,
    ToolbarTabs
} from './ToolbarControls';

afterEach(cleanup);

it('commits the search on Enter but not on the Enter that confirms an IME candidate', () => {
    const onCommit = vi.fn();
    render(
        <ToolbarSearch
            value="ねこ"
            ariaLabel="Search"
            commitOnBlur={false}
            onValueChange={() => {}}
            onCommit={onCommit}
        />
    );
    const input = screen.getByRole('textbox', { name: 'Search' });

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    expect(onCommit).toHaveBeenCalledOnce();
});

it('links counted navigation tabs to the selected page without losing its input state', async () => {
    const user = userEvent.setup();
    function Harness() {
        const [value, setValue] = useState('all');
        return (
            <Tabs value={value} onValueChange={setValue}>
                <ToolbarTabs
                    options={[
                        { value: 'all', label: 'All', count: 5 },
                        { value: 'friends', label: 'Friends', count: 2 }
                    ]}
                />
                <input aria-label="Search" />
                <TabsContent value={value}>{value}</TabsContent>
            </Tabs>
        );
    }
    render(<Harness />);
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'Alice');
    const friends = screen.getByRole('tab', { name: /Friends\s*2/ });
    await user.click(friends);
    expect(friends.getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel', { name: /Friends\s*2/ });
    expect(panel.textContent).toBe('friends');
    expect(friends.getAttribute('aria-controls')).toBe(panel.id);
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'Alice');
});

it('keeps one view selected and supports keyboard switching with icon tooltips', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Harness() {
        const [value, setValue] = useState<'table' | 'grid'>('table');
        return (
            <ToolbarSegmented
                iconOnly
                value={value}
                onValueChange={(next) => {
                    setValue(next);
                    onChange(next);
                }}
                options={[
                    { value: 'table', label: 'Table', icon: TableIcon },
                    { value: 'grid', label: 'Grid', icon: GridIcon }
                ]}
            />
        );
    }
    render(<Harness />);
    const table = screen.getByRole('button', { name: 'Table' });
    const grid = screen.getByRole('button', { name: 'Grid' });

    await user.click(table);
    expect(onChange).not.toHaveBeenCalled();
    expect(table.getAttribute('aria-pressed')).toBe('true');

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(grid);
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('grid');
    expect(grid.getAttribute('aria-pressed')).toBe('true');
    expect(table.getAttribute('aria-pressed')).toBe('false');
});
