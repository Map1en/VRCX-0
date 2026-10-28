import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import { Field } from './SettingsField';

const RETENTION_OPTIONS = [-1, 7, 30, 90, 365, 0] as const;

function isRetentionOption(value: number) {
    return RETENTION_OPTIONS.some((option) => option === value);
}

export function BrowseHistoryRetentionField() {
    const { t } = useTranslation();
    const [retentionDays, setRetentionDays] = useState<number | null>(null);

    function retentionLabel(days: number) {
        if (days === -1) {
            return t('browse_history.retention.off');
        }
        if (days === 0) {
            return t('browse_history.retention.forever');
        }
        return t('browse_history.retention.days', { count: days });
    }

    useEffect(() => {
        let active = true;
        void commands
            .appBrowseHistoryRetentionDaysGet()
            .then((days) => {
                if (active) {
                    setRetentionDays(days);
                }
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, []);

    if (retentionDays === null) {
        return null;
    }

    function changeRetention(value: string | null) {
        const next = Number(value);
        if (!isRetentionOption(next)) {
            return;
        }
        const previous = retentionDays;
        setRetentionDays(next);
        void commands.appBrowseHistoryRetentionDaysSet(next).catch(() => {
            setRetentionDays(previous);
            toast.add({
                type: 'error',
                title: t('browse_history.retention.update_failed')
            });
        });
    }

    return (
        <Field
            settingId="advanced.storage.browse-history-retention"
            label={t('browse_history.retention.label')}
            description={t('browse_history.retention.description')}
        >
            <Select
                value={String(retentionDays)}
                onValueChange={changeRetention}
            >
                <SelectTrigger
                    size="sm"
                    aria-label={t('browse_history.retention.label')}
                >
                    <SelectValue>
                        {(value: string) => retentionLabel(Number(value))}
                    </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                    {RETENTION_OPTIONS.map((days) => (
                        <SelectItem key={days} value={String(days)}>
                            {retentionLabel(days)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </Field>
    );
}
