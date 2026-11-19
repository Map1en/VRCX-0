import { formatDateFilter } from '@/lib/dateTime';
import type { DateFilterFormat } from '@/shared/utils/dateTime';
import { useShellStore } from '@/state/shellStore';
import { IntentTooltip } from '@/ui/hint-tooltip';

export function useDateFormatPreferenceKey() {
    return useShellStore(
        (state) =>
            `${state.locale}|${state.dateCulture}|${state.dateIsoFormat}|${state.dateHour12}`
    );
}

export function TimestampText({
    value,
    format = 'short',
    tooltip = true,
    tooltipSide,
    emptyText,
    className
}: {
    value: unknown;
    format?: DateFilterFormat;
    tooltip?: boolean;
    tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
    emptyText?: string;
    className?: string;
}) {
    useDateFormatPreferenceKey();
    const formatted = formatDateFilter(value, format);
    const text = formatted === '-' && emptyText ? emptyText : formatted;

    if (!tooltip || formatted === '-') {
        return <span className={className}>{text}</span>;
    }

    return (
        <IntentTooltip
            side={tooltipSide}
            content={formatDateFilter(value, 'long')}
        >
            <span className={className}>{text}</span>
        </IntentTooltip>
    );
}
