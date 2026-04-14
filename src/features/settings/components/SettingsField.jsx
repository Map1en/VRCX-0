import { Button } from '@/ui/shadcn/button.jsx';

export function Field({ label, description, children }) {
    return (
        <div className="grid gap-3 rounded-lg border p-4 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-center">
            <div className="space-y-1">
                <div className="text-sm font-medium">{label}</div>
                {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
            </div>
            <div className="justify-self-start lg:justify-self-end">{children}</div>
        </div>
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
        <div className="inline-flex overflow-hidden rounded-md border">
            {options.map((option) => (
                <Button
                    key={option.value}
                    type="button"
                    variant={value === option.value ? 'default' : 'ghost'}
                    size="sm"
                    className="rounded-none border-r last:border-r-0"
                    aria-pressed={value === option.value}
                    onClick={() => onChange?.(option.value)}>
                    {option.label}
                </Button>
            ))}
        </div>
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
