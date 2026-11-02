import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { useLlmEndpointsStore } from '@/state/llmEndpointsStore';
import {
    Combobox,
    ComboboxCollection,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxGroup,
    ComboboxInput,
    ComboboxItem,
    ComboboxLabel,
    ComboboxList,
    ComboboxTrigger
} from '@/ui/shadcn/combobox';
import { InputGroupButton } from '@/ui/shadcn/input-group';

const RUNTIME_SEPARATOR = '::';

export type RuntimeModelRef = {
    endpointId: string;
    model: string;
};

type RuntimeModelGroup = {
    value: string;
    items: string[];
};

function runtimeModelValue(endpointId: string, model: string): string {
    return `${endpointId}${RUNTIME_SEPARATOR}${model}`;
}

function parseRuntimeModelValue(value: string): RuntimeModelRef | null {
    const separatorIndex = value.indexOf(RUNTIME_SEPARATOR);
    if (separatorIndex < 0) {
        return null;
    }
    return {
        endpointId: value.slice(0, separatorIndex),
        model: value.slice(separatorIndex + RUNTIME_SEPARATOR.length)
    };
}

function runtimeModelLabel(value: string): string {
    return parseRuntimeModelValue(value)?.model ?? value;
}

type RuntimeModelSelectProps = {
    endpointId: string | null;
    model: string | null;
    placeholder: string;
    emptyLabel: string;
    id?: string;
    children?: ReactNode;
    onOpenChange?: (open: boolean) => void;
    onSelect: (ref: RuntimeModelRef) => void;
};

export function RuntimeModelSelect({
    endpointId,
    model,
    placeholder,
    emptyLabel,
    id,
    children,
    onOpenChange,
    onSelect
}: RuntimeModelSelectProps) {
    const endpoints = useLlmEndpointsStore((state) => state.endpoints);
    const groups: RuntimeModelGroup[] = endpoints
        .filter((endpoint) => endpoint.models.length)
        .map((endpoint) => ({
            value: endpoint.name,
            items: endpoint.models.map((endpointModel) =>
                runtimeModelValue(endpoint.id, endpointModel)
            )
        }));
    const values = groups.flatMap((group) => group.items);
    const selected =
        endpointId && model ? runtimeModelValue(endpointId, model) : null;
    const value = selected && values.includes(selected) ? selected : null;

    function handleValueChange(next: string | null) {
        const parsed = next ? parseRuntimeModelValue(next) : null;
        if (parsed) {
            onSelect(parsed);
        }
    }

    return (
        <Combobox
            items={groups}
            value={value}
            itemToStringLabel={runtimeModelLabel}
            onValueChange={handleValueChange}
            onOpenChange={onOpenChange}
        >
            {children ? (
                <ComboboxTrigger
                    id={id}
                    render={<InputGroupButton size="sm" />}
                >
                    {children}
                </ComboboxTrigger>
            ) : (
                <ComboboxInput
                    id={id}
                    className="w-full"
                    disabled={!values.length}
                    placeholder={placeholder}
                />
            )}
            <ComboboxContent className={cn(children && 'w-72')}>
                {children ? (
                    <ComboboxInput
                        showTrigger={false}
                        placeholder={placeholder}
                    />
                ) : null}
                <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
                <ComboboxList>
                    {(group: RuntimeModelGroup) => (
                        <ComboboxGroup key={group.value} items={group.items}>
                            <ComboboxLabel>{group.value}</ComboboxLabel>
                            <ComboboxCollection>
                                {(item: string) => (
                                    <ComboboxItem key={item} value={item}>
                                        {runtimeModelLabel(item)}
                                    </ComboboxItem>
                                )}
                            </ComboboxCollection>
                        </ComboboxGroup>
                    )}
                </ComboboxList>
            </ComboboxContent>
        </Combobox>
    );
}
