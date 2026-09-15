import {
    Fragment,
    Children,
    cloneElement,
    isValidElement,
    type ReactElement,
    type ReactNode,
    useId
} from 'react';

import { cn } from '@/lib/utils';
import {
    Field as ShadcnField,
    FieldContent,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
    FieldTitle
} from '@/ui/shadcn/field';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

type AttachableControlProps = {
    id?: string;
    'aria-invalid'?: boolean;
    children?: ReactNode;
};

type FieldProps = {
    label?: ReactNode;
    description?: ReactNode;
    children?: ReactNode;
    className?: string;
    contentClassName?: string;
    controlClassName?: string;
    controlId?: string;
    error?: ReactNode;
    invalid?: boolean;
    disabled?: boolean;
};

type SettingsSectionHeadingProps = {
    title?: ReactNode;
    description?: ReactNode;
};

type SegmentedPreferenceOption = {
    value: string;
    label: string;
};

type SegmentedPreferenceProps = {
    options: readonly SegmentedPreferenceOption[];
    value?: string;
    onChange?: (value: string) => void;
};

type JsonTreeViewProps = {
    data: unknown;
    name?: string;
    depth?: number;
};

function getAttachableControl(
    children: ReactNode
): ReactElement<AttachableControlProps> | null {
    if (Children.count(children) !== 1) {
        return null;
    }

    const child = Children.only(children);

    if (!isValidElement<AttachableControlProps>(child)) {
        return null;
    }

    const childProps = child.props;
    if (childProps.children != null) {
        return null;
    }

    return child;
}

function applyControlProps(
    children: ReactNode,
    controlId: string | undefined,
    invalid: boolean
): ReactNode {
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
}: FieldProps) {
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
                'border-stroke-subtle grid gap-3 border-b py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-center',
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
                    'flex justify-self-start lg:w-full lg:justify-end lg:justify-self-stretch',
                    controlClassName
                )}
            >
                {applyControlProps(children, labelControlId, isInvalid)}
            </div>
        </ShadcnField>
    );
}

export function SettingsSectionHeading({
    title,
    description
}: SettingsSectionHeadingProps) {
    return (
        <div className="border-stroke-subtle flex flex-col gap-1 border-b pt-2 pb-2 first:pt-0">
            <FieldTitle>{title}</FieldTitle>
            {description ? (
                <FieldDescription>{description}</FieldDescription>
            ) : null}
        </div>
    );
}

export { FieldGroup };

export function SegmentedPreference({
    options,
    value,
    onChange
}: SegmentedPreferenceProps) {
    return (
        <ToggleGroup
            variant="outline"
            size="sm"
            value={value ? [value] : []}
            onValueChange={(nextValue) => {
                if (nextValue[0]) {
                    onChange?.(nextValue[0]);
                }
            }}
        >
            {options.map((option, index) => (
                <Fragment key={option.value}>
                    {index > 0 ? <ToggleGroupSeparator /> : null}
                    <ToggleGroupItem
                        value={option.value}
                        aria-label={option.label}
                    >
                        {option.label}
                    </ToggleGroupItem>
                </Fragment>
            ))}
        </ToggleGroup>
    );
}

export function JsonTreeView({
    data,
    name = '',
    depth = 0
}: JsonTreeViewProps) {
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
        ? data.map((value, index): [string, unknown] => [String(index), value])
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
