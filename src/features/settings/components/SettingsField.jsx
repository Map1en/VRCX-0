import { cn } from '@/lib/utils.js';
import {
    Field as ShadcnField,
    FieldContent,
    FieldDescription,
    FieldLabel
} from '@/ui/shadcn/field.jsx';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group.jsx';

export function Field({ label, description, children, className = '' }) {
    return (
        <ShadcnField
            className={cn(
                'grid gap-3 border-b py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-center',
                className
            )}>
            <FieldContent>
                <FieldLabel>{label}</FieldLabel>
                {description ? <FieldDescription>{description}</FieldDescription> : null}
            </FieldContent>
            <div className="justify-self-start lg:justify-self-end">{children}</div>
        </ShadcnField>
    );
}

export function SettingsSectionHeading({ title, description }) {
    return (
        <div className="border-b pb-2 pt-2 first:pt-0">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            {description ? <div className="mt-1 text-xs text-muted-foreground">{description}</div> : null}
        </div>
    );
}

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
            }}>
            {options.map((option) => (
                <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    aria-label={option.label}>
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
                {name ? <span className="text-muted-foreground">{name}:</span> : null}
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
            <summary className="cursor-pointer select-none text-muted-foreground">{summary}</summary>
            <div className="ml-4 border-l pl-3">
                {entries.map(([key, value]) => (
                    <JsonTreeView key={key} name={key} data={value} depth={depth + 1} />
                ))}
            </div>
        </details>
    );
}
