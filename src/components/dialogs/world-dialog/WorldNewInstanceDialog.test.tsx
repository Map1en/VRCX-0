// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type {
    ButtonHTMLAttributes,
    ComponentProps,
    InputHTMLAttributes,
    PropsWithChildren,
    ReactNode
} from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorldProfileRecord } from '@/domain/entities/world';
import type { Button } from '@/ui/shadcn/button';
import type { InputGroupButton } from '@/ui/shadcn/input-group';

import type { WorldInstanceAccessType } from './worldNewInstanceTypes';

type ButtonMockProps = PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> &
        Pick<ComponentProps<typeof Button>, 'size' | 'variant'>
>;
type InputGroupButtonMockProps = PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> &
        Pick<ComponentProps<typeof InputGroupButton>, 'size'>
>;

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        variant: _variant,
        size: _size,
        ...props
    }: ButtonMockProps) => <button {...props}>{children}</button>
}));

vi.mock('@/ui/shadcn/checkbox', () => ({
    Checkbox: ({
        checked,
        onCheckedChange,
        ...props
    }: InputHTMLAttributes<HTMLInputElement> & {
        onCheckedChange(value: boolean): void;
    }) => (
        <input
            {...props}
            type="checkbox"
            checked={checked}
            onChange={(event) => onCheckedChange(event.currentTarget.checked)}
        />
    )
}));

vi.mock('@/ui/shadcn/toggle-group', () => ({
    ToggleGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
    ToggleGroupItem: ({
        children,
        value,
        onClick
    }: PropsWithChildren<{ value: string; onClick?: () => void }>) => (
        <button type="button" data-value={value} onClick={onClick}>
            {children}
        </button>
    )
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <div>{children}</div> : null,
    DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/ui/shadcn/field', () => ({
    Field: ({ children }: PropsWithChildren) => <div>{children}</div>,
    FieldDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    FieldGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
    FieldLabel: ({
        children,
        htmlFor
    }: PropsWithChildren<{ htmlFor?: string }>) => (
        <label htmlFor={htmlFor}>{children}</label>
    )
}));

vi.mock('@/ui/shadcn/input', () => ({
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => (
        <input {...props} />
    )
}));

vi.mock('@/ui/shadcn/input-group', async () => {
    const { forwardRef } = await import('react');
    return {
        InputGroup: forwardRef<HTMLDivElement, PropsWithChildren>(
            ({ children }, ref) => <div ref={ref}>{children}</div>
        ),
        InputGroupAddon: ({ children }: PropsWithChildren) => (
            <div>{children}</div>
        ),
        InputGroupButton: ({
            children,
            size: _size,
            ...props
        }: InputGroupButtonMockProps) => <button {...props}>{children}</button>,
        InputGroupInput: (props: InputHTMLAttributes<HTMLInputElement>) => (
            <input {...props} />
        )
    };
});

vi.mock('@/ui/shadcn/popover', () => ({
    Popover: ({ children }: PropsWithChildren) => <div>{children}</div>,
    PopoverContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    PopoverTrigger: ({ render }: { render: ReactNode }) => render
}));

vi.mock('@/ui/shadcn/select', async () => {
    const { createContext, useCallback, useContext } = await import('react');
    const MultiSelectContext = createContext<((value: string) => void) | null>(
        null
    );
    function PassThroughWhenMultiple({ children }: PropsWithChildren) {
        return useContext(MultiSelectContext) ? <div>{children}</div> : null;
    }
    return {
        Select: ({
            children,
            disabled,
            items = [],
            multiple,
            onValueChange,
            value
        }: PropsWithChildren<
            | {
                  disabled?: boolean;
                  items?: Array<{ label: ReactNode; value: string }>;
                  multiple?: false;
                  onValueChange(value: string): void;
                  value: string;
              }
            | {
                  disabled?: boolean;
                  items?: Array<{ label: ReactNode; value: string }>;
                  multiple: true;
                  onValueChange(value: string[]): void;
                  value: string[];
              }
        >) => {
            const select = useCallback(
                (item: string) => {
                    if (multiple) {
                        onValueChange([...value, item]);
                    }
                },
                [multiple, onValueChange, value]
            );
            if (multiple) {
                return (
                    <MultiSelectContext.Provider value={select}>
                        {children}
                    </MultiSelectContext.Provider>
                );
            }
            return (
                <select
                    disabled={disabled}
                    value={value}
                    onChange={(event) =>
                        onValueChange(event.currentTarget.value)
                    }
                >
                    {items.map((item) => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
                    ))}
                </select>
            );
        },
        SelectContent: PassThroughWhenMultiple,
        SelectGroup: PassThroughWhenMultiple,
        SelectItem: ({
            children,
            disabled,
            value
        }: PropsWithChildren<{ disabled?: boolean; value: string }>) => {
            const select = useContext(MultiSelectContext);
            return select ? (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => select(value)}
                >
                    {children}
                </button>
            ) : null;
        },
        SelectTrigger: () => null,
        SelectValue: () => null
    };
});

vi.mock('@/ui/shadcn/tabs', async () => {
    const { createContext, useContext, useMemo } = await import('react');
    type TabsContextValue = {
        onValueChange(value: string): void;
        value: string;
    };
    const TabsContext = createContext<TabsContextValue>({
        onValueChange: () => undefined,
        value: ''
    });
    return {
        Tabs: ({
            children,
            onValueChange,
            value
        }: PropsWithChildren<TabsContextValue>) => {
            const contextValue = useMemo(
                () => ({ onValueChange, value }),
                [onValueChange, value]
            );
            return (
                <TabsContext.Provider value={contextValue}>
                    {children}
                </TabsContext.Provider>
            );
        },
        TabsContent: ({
            children,
            value
        }: PropsWithChildren<{ value: string }>) => {
            const tabs = useContext(TabsContext);
            return tabs.value === value ? <div>{children}</div> : null;
        },
        TabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
        TabsTrigger: ({
            children,
            value
        }: PropsWithChildren<{ value: string }>) => {
            const tabs = useContext(TabsContext);
            return (
                <button type="button" onClick={() => tabs.onValueChange(value)}>
                    {children}
                </button>
            );
        }
    };
});

import { WorldNewInstanceDialog } from './WorldNewInstanceDialog';
import type { WorldNewInstanceRequest } from './worldNewInstanceTypes';

const world: WorldProfileRecord = {
    id: 'wrld_test',
    name: 'Test World',
    description: '',
    authorId: 'usr_author',
    authorName: 'Author',
    capacity: 32,
    createdAt: '2026-01-01T00:00:00Z',
    favorites: 0,
    heat: 0,
    imageUrl: '',
    isLabs: false,
    occupants: 0,
    platforms: ['standalonewindows'],
    popularity: 0,
    publicationDate: null,
    recommendedCapacity: 16,
    releaseStatus: 'public',
    tags: [],
    thumbnailImageUrl: '',
    updatedAt: '2026-01-01T00:00:00Z',
    visits: 0
};

const createOptions = {
    categories: [
        { id: 'icat_hangout', name: 'Hangout' },
        { id: 'icat_watch', name: 'Watch Party' }
    ],
    vibes: [
        { id: 'ivib_chill', name: 'Chill' },
        { id: 'ivib_cozy', name: 'Cozy' },
        { id: 'ivib_social', name: 'Social' },
        { id: 'ivib_anime', name: 'Anime' }
    ]
};

function makeRequest(
    defaults: WorldNewInstanceRequest['defaults'] = {},
    options: WorldNewInstanceRequest['createOptions'] = createOptions
): WorldNewInstanceRequest {
    return {
        selfInvite: false,
        afterCreateAction: '',
        defaults,
        createOptions: options
    };
}

function createCallbacks() {
    return {
        onOpenChange: vi.fn(),
        onChange: vi.fn(),
        onCommitDisplayName: vi.fn(),
        onSubmit: vi.fn(),
        onCopy: vi.fn(),
        onSelfInvite: vi.fn(),
        onInvite: vi.fn(),
        onLaunch: vi.fn(),
        onOpenInGame: vi.fn()
    };
}

type DialogProps = ComponentProps<typeof WorldNewInstanceDialog>;

function defaultProps(
    overrides: Partial<DialogProps> = {}
): DialogProps & ReturnType<typeof createCallbacks> {
    const callbacks = createCallbacks();
    return {
        open: true,
        request: makeRequest(),
        world,
        currentUserId: 'usr_self',
        submitting: false,
        ...overrides,
        ...callbacks
    };
}

function inputByLabel(label: string): HTMLInputElement {
    const element = screen.getByLabelText(label);
    if (!(element instanceof HTMLInputElement)) {
        throw new Error(`Expected ${label} to label an input`);
    }
    return element;
}

function buttonByName(name: string): HTMLButtonElement {
    const element = screen.getByRole('button', { name });
    if (!(element instanceof HTMLButtonElement)) {
        throw new Error(`Expected ${name} to identify a button`);
    }
    return element;
}

describe('WorldNewInstanceDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(cleanup);

    it('restores request defaults and the current user when reopened', async () => {
        const request = makeRequest({
            selectedTab: 'Legacy',
            accessType: 'friends',
            instanceName: 'SeededRoom'
        });
        const props = defaultProps({ currentUserId: 'usr_first', request });
        const view = render(<WorldNewInstanceDialog {...props} />);

        await waitFor(() => {
            expect(inputByLabel('dialog.world.label.user_id').value).toBe(
                'usr_first'
            );
        });
        fireEvent.change(
            inputByLabel('table.previous_instances.instance_name'),
            { target: { value: 'ChangedRoom' } }
        );
        fireEvent.change(inputByLabel('dialog.world.label.user_id'), {
            target: { value: 'usr_custom' }
        });

        view.rerender(<WorldNewInstanceDialog {...props} open={false} />);
        view.rerender(
            <WorldNewInstanceDialog
                {...props}
                open
                currentUserId="usr_second"
            />
        );

        await waitFor(() => {
            expect(
                inputByLabel('table.previous_instances.instance_name').value
            ).toBe('SeededRoom');
            expect(inputByLabel('dialog.world.label.user_id').value).toBe(
                'usr_second'
            );
        });
    });

    it.each<[WorldInstanceAccessType]>([['friends'], ['invite']])(
        'disables inviting to a non-owned legacy %s instance',
        (accessType: WorldInstanceAccessType) => {
            const props = defaultProps({
                request: makeRequest({
                    selectedTab: 'Legacy',
                    accessType,
                    legacyUserId: 'usr_other'
                })
            });
            render(<WorldNewInstanceDialog {...props} />);

            expect(buttonByName('dialog.world.action.invite').disabled).toBe(
                true
            );
            expect(buttonByName('dialog.world.action.launch').disabled).toBe(
                false
            );
        }
    );

    it('requests the normalized display-name preset before submitting the normalized form', async () => {
        const props = defaultProps({
            request: makeRequest({ displayName: '  Alpha Room  ' })
        });
        render(<WorldNewInstanceDialog {...props} />);

        await waitFor(() => {
            expect(inputByLabel('dialog.new_instance.display_name').value).toBe(
                '  Alpha Room  '
            );
        });
        fireEvent.click(buttonByName('dialog.new_instance.create_instance'));

        expect(props.onCommitDisplayName).toHaveBeenCalledWith('Alpha Room');
        expect(props.onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ displayName: 'Alpha Room' })
        );
        expect(
            props.onCommitDisplayName.mock.invocationCallOrder[0]
        ).toBeLessThan(props.onSubmit.mock.invocationCallOrder[0]);
    });

    it('maps the group avatar-performance selection back to an omitted request value', async () => {
        const props = defaultProps({
            request: makeRequest({
                accessType: 'group',
                groupId: 'grp_test',
                minimumAvatarPerformance: 'Good'
            })
        });
        render(<WorldNewInstanceDialog {...props} />);

        const performanceSelect = await screen.findByDisplayValue(
            'dialog.new_instance.minimum_avatar_performance_good'
        );
        fireEvent.change(performanceSelect, { target: { value: 'none' } });
        fireEvent.click(buttonByName('dialog.new_instance.create_instance'));

        expect(props.onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ minimumAvatarPerformance: '' })
        );
    });

    it('submits the description, category and up to three vibes with translated labels', async () => {
        const props = defaultProps();
        render(<WorldNewInstanceDialog {...props} />);

        const description = await screen.findByLabelText(
            'dialog.new_instance.description'
        );
        expect(description.getAttribute('maxLength')).toBe('256');
        expect(inputByLabel('dialog.new_instance.display_name').maxLength).toBe(
            128
        );
        fireEvent.change(description, { target: { value: 'Bring snacks' } });
        fireEvent.click(buttonByName('Watch Party'));
        for (const name of ['Chill', 'Cozy', 'Social']) {
            fireEvent.click(
                buttonByName(
                    `${name} (dialog.new_instance.vibe_options.${name.toLowerCase()})`
                )
            );
        }

        expect(
            buttonByName('Anime (dialog.new_instance.vibe_options.anime)')
                .disabled
        ).toBe(true);
        expect(
            buttonByName('Chill (dialog.new_instance.vibe_options.chill)')
                .disabled
        ).toBe(false);
        fireEvent.click(buttonByName('dialog.new_instance.create_instance'));
        expect(props.onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                description: 'Bring snacks',
                categoryId: 'icat_watch',
                vibeIds: ['ivib_chill', 'ivib_cozy', 'ivib_social']
            })
        );
    });

    it('hides category and vibes when VRChat options are unavailable', async () => {
        const props = defaultProps({ request: makeRequest({}, null) });
        render(<WorldNewInstanceDialog {...props} />);

        await screen.findByLabelText('dialog.new_instance.description');
        expect(screen.queryByText('dialog.new_instance.category')).toBeNull();
        expect(screen.queryByText('dialog.new_instance.vibes')).toBeNull();
    });

    it('resets the normal tab to the defaults but keeps name presets', async () => {
        const props = defaultProps({
            request: makeRequest({
                accessType: 'group',
                groupId: 'grp_test',
                region: 'Japan',
                displayName: 'Movie night',
                displayNamePresets: ['Movie night'],
                description: 'Bring snacks',
                categoryId: 'icat_watch',
                vibeIds: ['ivib_chill'],
                languages: ['jpn']
            })
        });
        render(<WorldNewInstanceDialog {...props} />);

        fireEvent.click(
            await screen.findByRole('button', {
                name: 'dialog.new_instance.reset_defaults'
            })
        );

        expect(props.onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({
                accessType: 'public',
                region: 'US West',
                groupId: '',
                displayName: '',
                displayNamePresets: ['Movie night'],
                description: '',
                categoryId: 'icat_hangout',
                vibeIds: [],
                languages: []
            })
        );
    });

    it('keeps the normal tab on create-only actions', async () => {
        const props = defaultProps({ request: makeRequest() });
        render(<WorldNewInstanceDialog {...props} />);

        await waitFor(() => {
            expect(
                buttonByName('dialog.new_instance.create_instance')
            ).toBeTruthy();
        });
        expect(
            screen.queryByRole('button', {
                name: 'dialog.world.action.launch'
            })
        ).toBeNull();
        expect(
            screen.queryByLabelText('dialog.world.label.location')
        ).toBeNull();
    });

    it('disables every legacy instance side effect while submitting', () => {
        const props = defaultProps({
            isGameRunning: true,
            request: makeRequest({ selectedTab: 'Legacy' }),
            submitting: true
        });
        render(<WorldNewInstanceDialog {...props} />);

        for (const name of [
            'dialog.world.info.copy_url',
            'dialog.world.label.self_invite',
            'dialog.world.action.invite',
            'dialog.world.action.launch',
            'dialog.world.action.open_in_game'
        ]) {
            expect(buttonByName(name).disabled).toBe(true);
        }
    });
});
