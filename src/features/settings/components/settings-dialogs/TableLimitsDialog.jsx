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
    SEARCH_LIMIT_MAX,
    SEARCH_LIMIT_MIN,
    TABLE_MAX_SIZE_MAX,
    TABLE_MAX_SIZE_MIN
} from '@/shared/constants/settings.js';
import { Input } from '@/ui/shadcn/input';

import { Field, FieldGroup } from '../SettingsField.jsx';

export function TableLimitsDialog({
    t,
    open: tableLimitsDialogOpen,
    onOpenChange: setTableLimitsDialogOpen,
    draft: tableLimitsDraft,
    onDraftChange: setTableLimitsDraft,
    tableMaxSizeError,
    searchLimitError,
    saveDisabled: tableLimitsSaveDisabled,
    onSave: saveTableLimitsDialog
}) {
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
                            <Input
                                id="settings-table-max-entries"
                                type="number"
                                name="maxTableSize"
                                inputMode="numeric"
                                min={TABLE_MAX_SIZE_MIN}
                                max={TABLE_MAX_SIZE_MAX}
                                value={tableLimitsDraft.maxTableSize}
                                onChange={(event) =>
                                    setTableLimitsDraft((current) => ({
                                        ...current,
                                        maxTableSize: event.target.value
                                    }))
                                }
                            />
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
                            <Input
                                id="settings-search-limit"
                                type="number"
                                name="searchLimit"
                                inputMode="numeric"
                                min={SEARCH_LIMIT_MIN}
                                max={SEARCH_LIMIT_MAX}
                                value={tableLimitsDraft.searchLimit}
                                onChange={(event) =>
                                    setTableLimitsDraft((current) => ({
                                        ...current,
                                        searchLimit: event.target.value
                                    }))
                                }
                            />
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
                            onClick={() => void saveTableLimitsDialog()}
                        >
                            {t('prompt.table_entries_settings.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
    );
}
