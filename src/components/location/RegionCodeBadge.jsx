import { cn } from '@/lib/utils.js';

const regionCodeLabels = {
    us: 'US',
    use: 'USE',
    usw: 'USW',
    eu: 'EU',
    jp: 'JP'
};

export function RegionCodeBadge({ region, className }) {
    const normalizedRegion = String(region || '').trim().toLowerCase();
    const label = regionCodeLabels[normalizedRegion];

    if (!label) {
        return null;
    }

    return (
        <span
            className={cn(
                'mr-1.5 inline-flex h-4 shrink-0 items-center rounded border border-border/70 bg-muted/70 px-1 font-mono text-[10px] font-semibold leading-none text-muted-foreground',
                className
            )}
            title={`Region: ${label}`}
        >
            {label}
        </span>
    );
}
