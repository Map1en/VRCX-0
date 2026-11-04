import { useTranslation } from 'react-i18next';

import type {
    ScreenshotShareCompression,
    ScreenshotShareFields
} from '@/platform/tauri/bindings';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Label } from '@/ui/shadcn/label';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

type InfoField = 'world' | 'time' | 'playerCount' | 'people' | 'stay';

const INFO_FIELDS: { key: InfoField; label: string }[] = [
    { key: 'world', label: 'view.tools.screenshot_share.fields.world' },
    { key: 'time', label: 'view.tools.screenshot_share.fields.time' },
    {
        key: 'playerCount',
        label: 'view.tools.screenshot_share.fields.player_count'
    },
    { key: 'people', label: 'view.tools.screenshot_share.fields.people' },
    { key: 'stay', label: 'view.tools.screenshot_share.fields.stay' }
];

const COMPRESSIONS: ScreenshotShareCompression[] = [
    'high',
    'standard',
    'original'
];

function isCompression(value: unknown): value is ScreenshotShareCompression {
    return COMPRESSIONS.some((compression) => compression === value);
}

export function ScreenshotShareOptions({
    idPrefix,
    value,
    disabled,
    onChange
}: {
    idPrefix: string;
    value: ScreenshotShareFields;
    disabled?: boolean;
    onChange(value: ScreenshotShareFields): void;
}) {
    const { t } = useTranslation();
    const compressionItems = COMPRESSIONS.map((compression) => ({
        value: compression,
        label: t(`view.tools.screenshot_share.compression.${compression}`)
    }));

    return (
        <div className="grid gap-4">
            <div className="grid gap-2">
                <span className="text-sm font-medium">
                    {t('view.tools.screenshot_share.fields.title')}
                </span>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                    {INFO_FIELDS.map((field) => (
                        <label
                            key={field.key}
                            className="flex items-center gap-2 text-sm"
                        >
                            <Checkbox
                                checked={value[field.key]}
                                disabled={disabled}
                                onCheckedChange={(checked) =>
                                    onChange({ ...value, [field.key]: checked })
                                }
                            />
                            {t(field.label)}
                        </label>
                    ))}
                </div>
            </div>
            <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-compression`}>
                    {t('view.tools.screenshot_share.compression.title')}
                </Label>
                <Select
                    value={value.compression}
                    items={compressionItems}
                    disabled={disabled}
                    onValueChange={(next) => {
                        if (isCompression(next)) {
                            onChange({ ...value, compression: next });
                        }
                    }}
                >
                    <SelectTrigger
                        id={`${idPrefix}-compression`}
                        className="w-full"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {compressionItems.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                    {item.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
                <span className="text-muted-foreground text-xs">
                    {t(
                        `view.tools.screenshot_share.compression.${value.compression}_hint`
                    )}
                </span>
            </div>
            <div className="grid gap-2.5">
                <label className="flex items-start gap-3 text-sm">
                    <span className="flex flex-1 flex-col gap-0.5">
                        {t('view.tools.screenshot_share.print')}
                        <span className="text-muted-foreground text-xs">
                            {t('view.tools.screenshot_share.print_hint')}
                        </span>
                    </span>
                    <Switch
                        checked={value.print}
                        disabled={disabled}
                        onCheckedChange={(print) =>
                            onChange({ ...value, print })
                        }
                    />
                </label>
                <label className="flex items-center gap-3 text-sm">
                    <span className="flex-1">
                        {t('view.tools.screenshot_share.spoiler')}
                    </span>
                    <Switch
                        checked={value.spoiler}
                        disabled={disabled}
                        onCheckedChange={(spoiler) =>
                            onChange({ ...value, spoiler })
                        }
                    />
                </label>
                {value.compression === 'original' ? (
                    <label className="flex items-start gap-3 text-sm">
                        <span className="flex flex-1 flex-col gap-0.5">
                            {t('view.tools.screenshot_share.metadata')}
                            <span className="text-muted-foreground text-xs">
                                {t('view.tools.screenshot_share.metadata_hint')}
                            </span>
                        </span>
                        <Switch
                            checked={value.metadata}
                            disabled={disabled}
                            onCheckedChange={(metadata) =>
                                onChange({ ...value, metadata })
                            }
                        />
                    </label>
                ) : null}
            </div>
        </div>
    );
}
