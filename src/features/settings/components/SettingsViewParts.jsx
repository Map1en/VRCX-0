import { PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { setTablePageSizesPreference } from '@/services/preferencesService.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
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

import { Field, FieldGroup } from './SettingsField.jsx';
import {
    buildTablePageSizeOptions,
    filterTablePageSizeOptions,
    normalizeTablePageSizes,
    TABLE_PAGE_SIZE_DEFAULTS
} from '../settingsValues.js';

export function SettingsTabContent({ value, children }) {
    return (
        <TabsContent
            value={value}
            className="m-0 min-h-0 w-full min-w-0 gap-4 overflow-x-hidden overflow-y-auto pt-3 pb-4 data-[state=active]:flex data-[state=active]:flex-1 data-[state=active]:flex-col [&>[data-slot=card]]:shrink-0"
        >
            {children}
        </TabsContent>
    );
}

export function TablePageSizesDialog({ open, onOpenChange, onSaved }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(() => [...TABLE_PAGE_SIZE_DEFAULTS]);
    const [input, setInput] = useState('');
    const options = buildTablePageSizeOptions(draft);
    const filteredOptions = filterTablePageSizeOptions(options, input);

    useEffect(() => {
        if (!open) {
            return;
        }
        setDraft(
            normalizeTablePageSizes(
                usePreferencesStore.getState().tablePageSizes
            )
        );
        setInput('');
    }, [open]);

    async function persist(
        nextSizes,
        { close = false, showToast = false } = {}
    ) {
        const normalizedSizes = normalizeTablePageSizes(nextSizes);
        setDraft(normalizedSizes);
        try {
            const saved = await setTablePageSizesPreference(normalizedSizes);
            onSaved?.(saved);
            if (close) {
                onOpenChange(false);
            }
            if (showToast) {
                toast.success(t('common.settings_saved'));
            }
            return true;
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.settings.generated_toast.failed_to_save_setting')
            );
            return false;
        }
    }

    function addPageSize(value = input, opts = {}) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) {
            toast.error(
                t('view.settings.appearance.appearance.table_page_sizes_error')
            );
            return;
        }
        void persist([...draft, parsed], opts);
        setInput('');
    }

    function removePageSize(value) {
        const next = draft.filter((entry) => entry !== value);
        void persist(next.length ? next : [...TABLE_PAGE_SIZE_DEFAULTS]);
    }

    function togglePageSize(value) {
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
                                    aria-label={`Remove ${size}`}
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
                                    aria-label="Table Page Sizes"
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
                    <Button type="button" onClick={() => void save()}>
                        {t('dialog.alertdialog.ok')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
