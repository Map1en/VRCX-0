// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { useRuntimeStore } from '@/state/runtimeStore';

import { PlayerListGroupSelector } from './PlayerListGroupSelector';

const groupId = 'grp_12345678-1234-1234-1234-123456789abc';
const joinedId = 'grp_aaaaaaaa-1234-1234-1234-123456789abc';
const instanceId = 'grp_cccccccc-1234-1234-1234-123456789abc';
vi.mock('@/repositories/groupProfileRepository', () => ({
    default: {
        getUserGroups: vi.fn(async () => [
            { id: joinedId, name: 'Event staff', shortCode: 'STAFF' }
        ]),
        getGroupProfile: vi.fn(async () => ({
            id: instanceId,
            name: 'Instance host',
            iconUrl: ''
        }))
    }
}));
function renderSelector(instanceGroupId: string) {
    const onChange = vi.fn();
    const client = new QueryClient();
    function Harness() {
        const [value, setValue] = useState('auto');
        return (
            <QueryClientProvider client={client}>
                <PlayerListGroupSelector
                    active
                    onActiveChange={() => {}}
                    value={value}
                    groupId={value === 'auto' ? instanceGroupId : value}
                    instanceGroupId={instanceGroupId}
                    onChange={(id) => {
                        setValue(id);
                        onChange(id);
                    }}
                    onRefresh={() => {}}
                />
            </QueryClientProvider>
        );
    }
    useRuntimeStore.setState((state) => ({
        auth: { ...state.auth, currentUserId: 'owner', currentUserEndpoint: '' }
    }));
    render(<Harness />);
    return {
        onChange,
        client,
        user: userEvent.setup(),
        trigger: screen.getByRole('combobox', {
            name: 'view.player_list.group_roles.group'
        })
    };
}

afterEach(cleanup);

it('shows the detected instance group and lets a joined group or a typed group ID replace it', async () => {
    const { onChange, client, user, trigger } = renderSelector(instanceId);
    await waitFor(() => expect(trigger.textContent).toContain('Instance host'));
    expect(
        screen.getByRole('button', {
            name: 'view.player_list.group_roles.refresh'
        })
    ).toBeTruthy();
    await user.click(trigger);
    expect(
        (await screen.findByRole('option', { name: /Instance host/ }))
            .textContent
    ).toContain('view.player_list.group_roles.automatic');
    const search = await screen.findByPlaceholderText(
        'view.player_list.group_roles.placeholder'
    );
    await user.type(search, 'staff');
    await waitFor(() =>
        expect(screen.getByRole('option', { name: /Event staff/ })).toBeTruthy()
    );
    await user.click(screen.getByRole('option', { name: /Event staff/ }));
    expect(onChange).toHaveBeenCalledWith(joinedId);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(trigger.textContent).toContain('Event staff');
    await user.click(trigger);
    await user.type(
        await screen.findByPlaceholderText(
            'view.player_list.group_roles.placeholder'
        ),
        groupId
    );
    await waitFor(() =>
        expect(screen.getByRole('option', { name: groupId })).toBeTruthy()
    );
    await user.click(screen.getByRole('option', { name: groupId }));
    expect(onChange).toHaveBeenCalledWith(groupId);
    client.clear();
});

it('collapses to a group roles toggle until the column is turned on', async () => {
    const client = new QueryClient();
    const onActiveChange = vi.fn();
    render(
        <QueryClientProvider client={client}>
            <PlayerListGroupSelector
                active={false}
                onActiveChange={onActiveChange}
                value="auto"
                groupId=""
                instanceGroupId=""
                onChange={() => {}}
                onRefresh={() => {}}
            />
        </QueryClientProvider>
    );

    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent
        .setup()
        .click(
            screen.getByRole('button', { name: 'table.playerList.groupRoles' })
        );
    expect(onActiveChange).toHaveBeenCalledWith(true);
    client.clear();
});

it('labels the automatic choice outside group instances until a group is picked', async () => {
    const { client, user, trigger } = renderSelector('');
    expect(trigger.textContent).toBe('view.player_list.group_roles.automatic');
    expect(
        screen.queryByRole('button', {
            name: 'view.player_list.group_roles.refresh'
        })
    ).toBeNull();
    await user.click(trigger);
    const auto = await screen.findByRole('option', {
        name: 'view.player_list.group_roles.automatic'
    });
    expect(auto.querySelector('[data-slot="avatar"]')).toBeNull();
    await user.click(
        await screen.findByRole('option', { name: /Event staff/ })
    );
    await waitFor(() => expect(trigger.textContent).toContain('Event staff'));
    expect(
        screen.getByRole('button', {
            name: 'view.player_list.group_roles.refresh'
        })
    ).toBeTruthy();
    client.clear();
});
