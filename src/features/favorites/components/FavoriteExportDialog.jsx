import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import { Textarea } from '@/ui/shadcn/textarea';
import {
    buildFavoriteExportCsv,
    FAVORITES_EXPORT_ALL_VALUE as EXPORT_ALL_VALUE,
    FAVORITES_EXPORT_NONE_VALUE as EXPORT_NONE_VALUE,
    getFavoriteExportFieldOptions
} from '../favoritesExport.js';

function FavoriteExportDialog({
    open,
    onOpenChange,
    kind,
    remoteGroups,
    localGroups,
    remoteItemsByGroup,
    localItemsByGroup
}) {
    const { t } = useTranslation();

    const fieldOptions = getFavoriteExportFieldOptions(kind);
    const [selectedFields, setSelectedFields] = useState(() =>
        fieldOptions.map((option) => option.value)
    );
    const [remoteGroupKey, setRemoteGroupKey] = useState(EXPORT_ALL_VALUE);
    const [localGroupKey, setLocalGroupKey] = useState(EXPORT_NONE_VALUE);
    const items = useMemo(() => {
        const remoteItems =
            remoteGroupKey === EXPORT_ALL_VALUE
                ? Object.values(remoteItemsByGroup || {}).flat()
                : remoteItemsByGroup?.[remoteGroupKey] || [];
        const localItems =
            localGroupKey === EXPORT_NONE_VALUE
                ? []
                : localItemsByGroup?.[localGroupKey] || [];

        return [...remoteItems, ...localItems];
    }, [localGroupKey, localItemsByGroup, remoteGroupKey, remoteItemsByGroup]);
    const content = useMemo(
        () => buildFavoriteExportCsv(items, kind, selectedFields),
        [items, kind, selectedFields]
    );

    useEffect(() => {
        if (open) {
            setSelectedFields(fieldOptions.map((option) => option.value));
            setRemoteGroupKey(EXPORT_ALL_VALUE);
            setLocalGroupKey(EXPORT_NONE_VALUE);
        }
    }, [fieldOptions, open]);

    function toggleField(field, checked) {
        setSelectedFields((current) => {
            if (checked) {
                return Array.from(new Set([...current, field]));
            }
            return current.filter((entry) => entry !== field);
        });
    }

    async function copyExportContent() {
        try {
            await navigator.clipboard.writeText(content);
            toast.success(t('view.favorite.generated.copied_favorite_export_data'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.favorites.generated_toast.failed_to_copy_favorite_export_data')
            );
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('view.favorite.generated.export_favorite')} {kind}{t('common.time_units.s')}</DialogTitle>
                    <DialogDescription>
                        {t('view.favorite.generated.review_the_csv_content_before_copying_it_to_the_clipboard')}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup
                    data-slot="checkbox-group"
                    className="flex flex-row flex-wrap gap-3"
                >
                    {fieldOptions.map((option) => (
                        <Field
                            key={option.value}
                            orientation="horizontal"
                            className="w-auto items-center"
                        >
                            <Checkbox
                                id={`favorite-export-field-${kind}-${option.value}`}
                                checked={selectedFields.includes(option.value)}
                                onCheckedChange={(checked) =>
                                    toggleField(option.value, Boolean(checked))
                                }
                            />
                            <FieldLabel
                                htmlFor={`favorite-export-field-${kind}-${option.value}`}
                            >
                                {option.label}
                            </FieldLabel>
                        </Field>
                    ))}
                </FieldGroup>
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        value={remoteGroupKey}
                        onValueChange={setRemoteGroupKey}
                    >
                        <SelectTrigger size="sm" className="min-w-52">
                            <SelectValue placeholder={t('view.favorite.generated.vrchat_group')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value={EXPORT_ALL_VALUE}>
                                    {t('view.favorite.generated.all_vrchat_favorites')}
                                </SelectItem>
                                {remoteGroups.map((group) => (
                                    <SelectItem
                                        key={group.key}
                                        value={group.key}
                                    >
                                        {group.label} (
                                        {group.capacity
                                            ? `${group.count}/${group.capacity}`
                                            : group.count}
                                        )
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <Select
                        value={localGroupKey}
                        onValueChange={setLocalGroupKey}
                    >
                        <SelectTrigger size="sm" className="min-w-52">
                            <SelectValue placeholder={t('view.favorite.generated.local_group')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value={EXPORT_NONE_VALUE}>
                                    {t('view.favorite.generated.no_local_group')}
                                </SelectItem>
                                {localGroups.map((group) => (
                                    <SelectItem
                                        key={group.key}
                                        value={group.key}
                                    >
                                        {group.label} ({group.count})
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <span className="text-muted-foreground text-sm">
                        {items.length} {t('view.favorite.generated.item_s')}
                    </span>
                </div>
                <Textarea
                    readOnly
                    rows={16}
                    value={content}
                    className="min-h-80 resize-none font-mono text-xs"
                    onClick={(event) => event.currentTarget.select()}
                />
                <div className="flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.close')}
                    </Button>
                    <Button
                        type="button"
                        disabled={!items.length || !selectedFields.length}
                        onClick={() => void copyExportContent()}
                    >
                        {t('common.actions.copy')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { FavoriteExportDialog };
