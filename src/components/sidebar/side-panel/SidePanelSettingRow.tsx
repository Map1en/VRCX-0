import { cloneElement, isValidElement, type ReactNode } from 'react';

import {
    Field,
    FieldContent,
    FieldDescription,
    FieldLabel
} from '@/ui/shadcn/field';

export function SidePanelSettingRow({
    id,
    label,
    description,
    disabled = false,
    children
}: {
    id?: string;
    label: ReactNode;
    description?: ReactNode;
    disabled?: boolean;
    children: ReactNode;
}) {
    const control =
        id && isValidElement<{ id?: string }>(children)
            ? cloneElement(children, { id })
            : children;
    return (
        <Field
            orientation="horizontal"
            className="gap-3 text-xs"
            data-disabled={disabled || undefined}
        >
            <FieldContent>
                <FieldLabel htmlFor={id} className="text-xs">
                    {label}
                </FieldLabel>
                {description ? (
                    <FieldDescription className="text-xs">
                        {description}
                    </FieldDescription>
                ) : null}
            </FieldContent>
            {control}
        </Field>
    );
}
