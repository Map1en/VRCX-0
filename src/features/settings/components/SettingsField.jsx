import { Children, cloneElement, isValidElement, useId } from 'react';

import { cn } from '@/lib/utils.js';
import {
    Field as ShadcnField,
    FieldContent,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
    FieldTitle
} from '@/ui/shadcn/field';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

function getAttachableControl(children) {
    if (Children.count(children) !== 1) {
        return null;
    }

    const child = Children.only(children);

    if (!isValidElement(child)) {
        return null;
    }

    if (child.props.children != null) {
        return null;
    }

    return child;
}

function applyControlProps(children, controlId, invalid) {
    const child = getAttachableControl(children);

    if (!child) {
        return children;
    }

    return cloneElement(child, {
        id: child.props.id || controlId,
        'aria-invalid': child.props['aria-invalid'] || invalid || undefined
    });
}

export function Field({
    label,
    description,
    children,
    className = '',
    contentClassName = '',
    controlClassName = '',
    controlId,
    error,
    invalid = false,
    disabled = false
}) {
    const isInvalid = invalid || Boolean(error);
    const generatedControlId = useId();
    const attachableControl = getAttachableControl(children);
    const labelControlId =
        controlId ||
        attachableControl?.props.id ||
        (attachableControl ? generatedControlId : undefined);

    return (
        <ShadcnField
            data-disabled={disabled || undefined}
            data-invalid={isInvalid || undefined}
            className={cn(
                'grid gap-3 border-b py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-center',
                className
            )}
        >
            <FieldContent className={contentClassName}>
                <FieldLabel htmlFor={labelControlId}>{label}</FieldLabel>
                {description ? (
                    <FieldDescription>{description}</FieldDescription>
                ) : null}
                {error ? <FieldError>{error}</FieldError> : null}
            </FieldContent>
            <div
                className={cn(
                    'flex justify-self-start lg:w-full lg:justify-self-stretch lg:justify-end',
                    controlClassName
                )}
            >
                {applyControlProps(children, labelControlId, isInvalid)}
            </div>
        </ShadcnField>
    );
}

export function SettingsSectionHeading({ title, description }) {
    return (
        <div className="flex flex-col gap-1 border-b pt-2 pb-2 first:pt-0">
            <FieldTitle>{title}</FieldTitle>
            {description ? (
                <FieldDescription>{description}</FieldDescription>
            ) : null}
        </div>
    );
}

export { FieldDescription, FieldError, FieldGroup };

export function SegmentedPreference({ options, value, onChange }) {
    return (
        <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={value}
            onValueChange={(nextValue) => {
                if (nextValue) {
                    onChange?.(nextValue);
                }
            }}
        >
            {options.map((option) => (
                <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    aria-label={option.label}
                >
                    {option.label}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    );
}

export function JsonTreeView({ data, name = '', depth = 0 }) {
    if (data === null || typeof data !== 'object') {
        return (
            <div className="flex gap-2 font-mono text-xs">
                {name ? (
                    <span className="text-muted-foreground">{name}:</span>
                ) : null}
                <span>{JSON.stringify(data)}</span>
            </div>
        );
    }

    const entries = Array.isArray(data)
        ? data.map((value, index) => [String(index), value])
        : Object.entries(data);
    const summary = `${name ? `${name}: ` : ''}${Array.isArray(data) ? `Array(${entries.length})` : `Object(${entries.length})`}`;

    return (
        <details open={depth < 2} className="font-mono text-xs">
            <summary className="text-muted-foreground cursor-pointer select-none">
                {summary}
            </summary>
            <div className="ml-4 border-l pl-3">
                {entries.map(([key, value]) => (
                    <JsonTreeView
                        key={key}
                        name={key}
                        data={value}
                        depth={depth + 1}
                    />
                ))}
            </div>
        </details>
    );
}
