import { PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { setTablePageSizesPreference } from '@/services/preferencesService';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field as ShadcnField,
    FieldLabel as ShadcnFieldLabel
} from '@/ui/shadcn/field';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { TabsContent } from '@/ui/shadcn/tabs';

import {
    buildTablePageSizeOptions,
    filterTablePageSizeOptions,
    normalizeTablePageSizes,
    TABLE_PAGE_SIZE_DEFAULTS
} from '../settingsValues';
import { Field, FieldGroup } from './SettingsField';

type SettingsTabContentProps = PropsWithChildren<{
    value: string;
}>;

type TablePageSizesDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved?: (sizes: number[]) => void;
};

type PersistOptions = {
    close?: boolean;
    showToast?: boolean;
};

export function SettingsTabContent({
    value,
    children
}: SettingsTabContentProps) {
    return (
        <TabsContent
            value={value}
            className="m-0 flex min-h-0 w-full max-w-[820px] min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-px pt-1 pb-4 data-hidden:hidden [&>[data-slot=card]]:shrink-0"
        >
            {children}
        </TabsContent>
    );
}

export function TablePageSizesDialog({
    open,
    onOpenChange,
    onSaved
}: TablePageSizesDialogProps) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(() => [...TABLE_PAGE_SIZE_DEFAULTS]);
    const [input, setInput] = useState('');
    const committedSizesRef = useRef([...TABLE_PAGE_SIZE_DEFAULTS]);
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
    const latestSaveIdRef = useRef(0);
    const options = buildTablePageSizeOptions(draft);
    const filteredOptions = filterTablePageSizeOptions(options, input);

    useEffect(() => {
        if (!open) {
            return;
        }
        const savedSizes = normalizeTablePageSizes(
            usePreferencesStore.getState().tablePageSizes
        );
        committedSizesRef.current = savedSizes;
        setDraft(savedSizes);
        setInput('');
    }, [open]);

    async function persist(
        nextSizes: unknown,
        { close = false, showToast = false }: PersistOptions = {}
    ): Promise<void> {
        const normalizedSizes = normalizeTablePageSizes(nextSizes);
        const saveId = latestSaveIdRef.current + 1;
        latestSaveIdRef.current = saveId;
        setDraft(normalizedSizes);

        const saveTask = saveQueueRef.current
            .catch(() => undefined)
            .then(async () => {
                const saved =
                    await setTablePageSizesPreference(normalizedSizes);
                committedSizesRef.current = saved;
                onSaved?.(saved);
            });
        saveQueueRef.current = saveTask.catch(() => undefined);

        try {
            await saveTask;
            if (saveId !== latestSaveIdRef.current) {
                return;
            }
            if (close) {
                onOpenChange(false);
            }
            if (showToast) {
                toast.success(t('common.settings_saved'));
            }
        } catch (error) {
            if (saveId === latestSaveIdRef.current) {
                setDraft(committedSizesRef.current);
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.settings.toast.failed_to_save_setting')
            );
        }
    }

    function addPageSize(
        value: string | number = input,
        options: PersistOptions = {}
    ) {
        const parsed = Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) {
            toast.error(
                t('view.settings.appearance.appearance.table_page_sizes_error')
            );
            return;
        }
        void persist([...draft, parsed], options);
        setInput('');
    }

    function removePageSize(value: number) {
        const next = draft.filter((entry) => entry !== value);
        void persist(next.length ? next : [...TABLE_PAGE_SIZE_DEFAULTS]);
    }

    function togglePageSize(value: number) {
        if (draft.includes(value)) {
            removePageSize(value);
            return;
        }
        void persist([...draft, value]);
    }

    function save() {
        if (input.trim()) {
            addPageSize(input, {
                close: true,
                showToast: true
            });
            return;
        }
        onOpenChange(false);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {t(
                            'view.settings.appearance.appearance.table_page_sizes'
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'view.settings.appearance.appearance.table_page_sizes_description'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <div className="flex flex-wrap gap-2">
                        {draft.map((size) => (
                            <Badge
                                key={size}
                                variant="secondary"
                                className="gap-2"
                            >
                                {size}
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={t(
                                        'accessibility.remove_value',
                                        { value: size }
                                    )}
                                    onClick={() => removePageSize(size)}
                                >
                                    <XIcon data-icon="inline-start" />
                                </Button>
                            </Badge>
                        ))}
                    </div>
                    <Field
                        label={t(
                            'view.settings.appearance.appearance.table_page_sizes'
                        )}
                        description="1-1000"
                        controlId="settings-table-page-size-input"
                    >
                        <InputGroup>
                            <InputGroupInput
                                id="settings-table-page-size-input"
                                type="number"
                                name="tablePageSize"
                                inputMode="numeric"
                                min={1}
                                max={1000}
                                value={input}
                                placeholder={t(
                                    'view.settings.appearance.appearance.table_page_sizes'
                                )}
                                onChange={(event) =>
                                    setInput(event.target.value)
                                }
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        addPageSize();
                                    }
                                }}
                            />
                            <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                    type="button"
                                    size="icon-xs"
                                    aria-label={t(
                                        'accessibility.add_table_page_size'
                                    )}
                                    onClick={() => addPageSize()}
                                >
                                    <PlusIcon data-icon="inline-start" />
                                </InputGroupButton>
                            </InputGroupAddon>
                        </InputGroup>
                    </Field>
                    <div className="max-h-64 overflow-y-auto rounded-md border p-1">
                        <FieldGroup>
                            {filteredOptions.map((size) => {
                                const optionId = `settings-table-page-size-option-${size}`;
                                return (
                                    <ShadcnField
                                        key={size}
                                        orientation="horizontal"
                                        className="hover:bg-accent hover:text-accent-foreground rounded-sm px-2 py-1.5"
                                    >
                                        <Checkbox
                                            id={optionId}
                                            checked={draft.includes(size)}
                                            onCheckedChange={() =>
                                                togglePageSize(size)
                                            }
                                        />
                                        <ShadcnFieldLabel
                                            htmlFor={optionId}
                                            className="w-full cursor-pointer"
                                        >
                                            {size}
                                        </ShadcnFieldLabel>
                                    </ShadcnField>
                                );
                            })}
                        </FieldGroup>
                    </div>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        onClick={() => {
                            save();
                        }}
                    >
                        {t('dialog.alertdialog.ok')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
