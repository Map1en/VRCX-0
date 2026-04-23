import { Trash2Icon } from 'lucide-react';

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
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import { Field } from '../SettingsField.jsx';

export function PurgeConfirmDialog({
    t,
    open: purgeDialogOpen,
    onOpenChange: setPurgeDialogOpen,
    period: purgePeriod,
    onPeriodChange: setPurgePeriod,
    inProgress: purgeInProgress,
    onConfirm: purgeAvatarFeedData
}) {
    return (
            <Dialog open={purgeDialogOpen} onOpenChange={setPurgeDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {t(
                                'view.settings.advanced.advanced.database_cleanup.purge_confirm_title'
                            )}
                        </DialogTitle>
                        <DialogDescription>
                            {t(
                                'view.settings.advanced.advanced.database_cleanup.purge_confirm_alert'
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="text-muted-foreground flex flex-col gap-4 text-sm">
                        <p>
                            {t(
                                'view.settings.advanced.advanced.database_cleanup.purge_confirm_description_1'
                            )}
                        </p>
                        <p>
                            {t(
                                'view.settings.advanced.advanced.database_cleanup.purge_confirm_description_2'
                            )}
                        </p>
                        <p>
                            {t(
                                'view.settings.advanced.advanced.database_cleanup.purge_confirm_description_3'
                            )}
                        </p>
                        <Field
                            label={t(
                                'view.settings.advanced.advanced.database_cleanup.purge_older_than'
                            )}
                            controlId="settings-purge-period"
                        >
                            <Select
                                value={purgePeriod}
                                onValueChange={setPurgePeriod}
                            >
                                <SelectTrigger
                                    id="settings-purge-period"
                                    className="w-36"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value="180">
                                            {t(
                                                'view.settings.advanced.advanced.database_cleanup.purge_option_180'
                                            )}
                                        </SelectItem>
                                        <SelectItem value="365">
                                            {t(
                                                'view.settings.advanced.advanced.database_cleanup.purge_option_365'
                                            )}
                                        </SelectItem>
                                        <SelectItem value="730">
                                            {t(
                                                'view.settings.advanced.advanced.database_cleanup.purge_option_730'
                                            )}
                                        </SelectItem>
                                        <SelectItem value="all">
                                            {t(
                                                'view.settings.advanced.advanced.database_cleanup.purge_option_all'
                                            )}
                                        </SelectItem>
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={purgeInProgress}
                            onClick={() => setPurgeDialogOpen(false)}
                        >
                            {t('confirm.cancel_button')}
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={purgeInProgress}
                            onClick={() => void purgeAvatarFeedData()}
                        >
                            <Trash2Icon data-icon="inline-start" />
                            {t(
                                'view.settings.advanced.advanced.database_cleanup.purge_confirm_button'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
    );
}
