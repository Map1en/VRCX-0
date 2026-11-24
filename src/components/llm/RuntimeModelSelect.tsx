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
const FOLLOW_DEFAULT_VALUE = 'follow-default';

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
    followDefault?: {
        label: string;
        onSelect: () => void;
    };
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
    followDefault,
    onOpenChange,
    onSelect
}: RuntimeModelSelectProps) {
    const endpoints = useLlmEndpointsStore((state) => state.endpoints);
    const endpointGroups: RuntimeModelGroup[] = endpoints
        .filter((endpoint) => endpoint.models.length)
        .map((endpoint) => ({
            value: endpoint.name,
            items: endpoint.models.map((endpointModel) =>
                runtimeModelValue(endpoint.id, endpointModel)
            )
        }));
    const groups: RuntimeModelGroup[] = followDefault
        ? [{ value: '', items: [FOLLOW_DEFAULT_VALUE] }, ...endpointGroups]
        : endpointGroups;
    const values = groups.flatMap((group) => group.items);
    const selected =
        endpointId && model
            ? runtimeModelValue(endpointId, model)
            : followDefault
              ? FOLLOW_DEFAULT_VALUE
              : null;
    const value = selected && values.includes(selected) ? selected : null;

    function itemLabel(item: string): string {
        if (followDefault && item === FOLLOW_DEFAULT_VALUE) {
            return followDefault.label;
        }
        return runtimeModelLabel(item);
    }

    function handleValueChange(next: string | null) {
        if (followDefault && next === FOLLOW_DEFAULT_VALUE) {
            followDefault.onSelect();
            return;
        }
        const parsed = next ? parseRuntimeModelValue(next) : null;
        if (parsed) {
            onSelect(parsed);
        }
    }

    return (
        <Combobox
            items={groups}
            value={value}
            itemToStringLabel={itemLabel}
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
                        <ComboboxGroup
                            key={group.value || FOLLOW_DEFAULT_VALUE}
                            items={group.items}
                        >
                            {group.value ? (
                                <ComboboxLabel>{group.value}</ComboboxLabel>
                            ) : null}
                            <ComboboxCollection>
                                {(item: string) => (
                                    <ComboboxItem key={item} value={item}>
                                        {itemLabel(item)}
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
