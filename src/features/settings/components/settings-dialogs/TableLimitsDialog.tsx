import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import {
    SEARCH_LIMIT_MAX,
    SEARCH_LIMIT_MIN,
    TABLE_MAX_SIZE_MAX,
    TABLE_MAX_SIZE_MIN
} from '@/shared/constants/settings';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
} from '@/ui/shadcn/number-field';

import { Field, FieldGroup } from '../SettingsField';

type TableLimitsDraft = {
    maxTableSize: string;
    searchLimit: string;
};

type TableLimitsDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    draft: TableLimitsDraft;
    onDraftChange: Dispatch<SetStateAction<TableLimitsDraft>>;
    tableMaxSizeError?: ReactNode;
    searchLimitError?: ReactNode;
    saveDisabled?: boolean;
    onSave: () => void;
};

export function TableLimitsDialog({
    open: tableLimitsDialogOpen,
    onOpenChange: setTableLimitsDialogOpen,
    draft: tableLimitsDraft,
    onDraftChange: setTableLimitsDraft,
    tableMaxSizeError,
    searchLimitError,
    saveDisabled: tableLimitsSaveDisabled,
    onSave: saveTableLimitsDialog
}: TableLimitsDialogProps) {
    const { t } = useTranslation();

    return (
        <Dialog
            open={tableLimitsDialogOpen}
            onOpenChange={setTableLimitsDialogOpen}
        >
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {t('prompt.table_entries_settings.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('prompt.table_entries_settings.description')}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Field
                        label={t(
                            'prompt.table_entries_settings.table_max_entries'
                        )}
                        description={
                            tableMaxSizeError
                                ? undefined
                                : t(
                                      'prompt.table_entries_settings.table_max_entries_hint',
                                      {
                                          min: TABLE_MAX_SIZE_MIN,
                                          max: TABLE_MAX_SIZE_MAX
                                      }
                                  )
                        }
                        controlId="settings-table-max-entries"
                        error={tableMaxSizeError}
                        invalid={Boolean(tableMaxSizeError)}
                    >
                        <NumberField
                            id="settings-table-max-entries"
                            name="maxTableSize"
                            min={TABLE_MAX_SIZE_MIN}
                            max={TABLE_MAX_SIZE_MAX}
                            allowOutOfRange
                            value={
                                tableLimitsDraft.maxTableSize === ''
                                    ? null
                                    : Number(tableLimitsDraft.maxTableSize)
                            }
                            onValueChange={(value) =>
                                setTableLimitsDraft((current) => ({
                                    ...current,
                                    maxTableSize:
                                        value === null ? '' : String(value)
                                }))
                            }
                        >
                            <NumberFieldGroup>
                                <NumberFieldDecrement />
                                <NumberFieldInput />
                                <NumberFieldIncrement />
                            </NumberFieldGroup>
                        </NumberField>
                    </Field>
                    <Field
                        label={t(
                            'prompt.table_entries_settings.search_limit_returns'
                        )}
                        description={
                            searchLimitError ? (
                                t(
                                    'prompt.table_entries_settings.search_limit_returns_warning'
                                )
                            ) : (
                                <span className="flex flex-col gap-1">
                                    <span>
                                        {t(
                                            'prompt.table_entries_settings.search_limit_returns_hint',
                                            {
                                                min: SEARCH_LIMIT_MIN,
                                                max: SEARCH_LIMIT_MAX
                                            }
                                        )}
                                    </span>
                                    <span>
                                        {t(
                                            'prompt.table_entries_settings.search_limit_returns_warning'
                                        )}
                                    </span>
                                </span>
                            )
                        }
                        controlId="settings-search-limit"
                        error={searchLimitError}
                        invalid={Boolean(searchLimitError)}
                    >
                        <NumberField
                            id="settings-search-limit"
                            name="searchLimit"
                            min={SEARCH_LIMIT_MIN}
                            max={SEARCH_LIMIT_MAX}
                            allowOutOfRange
                            value={
                                tableLimitsDraft.searchLimit === ''
                                    ? null
                                    : Number(tableLimitsDraft.searchLimit)
                            }
                            onValueChange={(value) =>
                                setTableLimitsDraft((current) => ({
                                    ...current,
                                    searchLimit:
                                        value === null ? '' : String(value)
                                }))
                            }
                        >
                            <NumberFieldGroup>
                                <NumberFieldDecrement />
                                <NumberFieldInput />
                                <NumberFieldIncrement />
                            </NumberFieldGroup>
                        </NumberField>
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => setTableLimitsDialogOpen(false)}
                    >
                        {t('prompt.table_entries_settings.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={tableLimitsSaveDisabled}
                        onClick={() => {
                            saveTableLimitsDialog();
                        }}
                    >
                        {t('prompt.table_entries_settings.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
