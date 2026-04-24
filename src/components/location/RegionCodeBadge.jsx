import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils.js';

const regionCodeLabels = {
    us: 'US',
    use: 'USE',
    usw: 'USW',
    eu: 'EU',
    jp: 'JP'
};

export function RegionCodeBadge({ region, className }) {
    const { t } = useTranslation();

    const normalizedRegion = String(region || '')
        .trim()
        .toLowerCase();
    const label = regionCodeLabels[normalizedRegion];

    if (!label) {
        return null;
    }

    return (
        <span
            className={cn(
                'border-border/70 bg-muted/70 text-muted-foreground mr-1.5 inline-flex h-4 shrink-0 items-center rounded border px-1 font-mono text-[10px] leading-none font-semibold',
                className
            )}
            title={t('component.region_code_badge.generated_dynamic.region_value', { value: label })}
        >
            {label}
        </span>
    );
}
