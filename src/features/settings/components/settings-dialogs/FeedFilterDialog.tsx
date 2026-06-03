import { useTranslation } from 'react-i18next';

import { sharedFeedFiltersDefaults } from '@/shared/constants/feedFilters';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
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

import { Field, FieldGroup } from '../SettingsField';

export function FeedFilterDialog({
    open: feedFilterDialogOpen,
    onOpenChange: setFeedFilterDialogOpen,
    mode: feedFilterMode,
    options: currentSharedFeedFilterOptions,
    filters: sharedFeedFilters,
    onUpdate: updateSharedFeedFilter,
    onReset: resetSharedFeedFilters
}: any) {
    const { t } = useTranslation();

    return (
        <Dialog
            open={feedFilterDialogOpen}
            onOpenChange={setFeedFilterDialogOpen}
        >
            <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.shared_feed_filters.notification')}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'view.settings.notifications.notifications.notification_filter'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4 overflow-hidden">
                    <FieldGroup className="max-h-[60vh] overflow-y-auto pr-1">
                        {currentSharedFeedFilterOptions.map((setting: any) => (
                            <Field
                                key={`${feedFilterMode}:${setting.key}`}
                                label={
                                    setting.textKey
                                        ? t(setting.textKey)
                                        : setting.name
                                }
                                description={setting.tooltip}
                                controlId={`settings-feed-filter-${feedFilterMode}-${setting.key}`}
                            >
                                <Select
                                    value={
                                        sharedFeedFilters[feedFilterMode]?.[
                                            setting.key
                                        ] ||
                                        sharedFeedFiltersDefaults[
                                            feedFilterMode
                                        ]?.[setting.key] ||
                                        setting.options[0]?.label
                                    }
                                    onValueChange={(value: any) =>
                                        updateSharedFeedFilter(
                                            feedFilterMode,
                                            setting.key,
                                            value
                                        )
                                    }
                                >
                                    <SelectTrigger
                                        id={`settings-feed-filter-${feedFilterMode}-${setting.key}`}
                                        className="w-40"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {setting.options.map((option: any) => (
                                                <SelectItem
                                                    key={option.label}
                                                    value={option.label}
                                                >
                                                    {t(option.textKey)}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                        ))}
                    </FieldGroup>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                                resetSharedFeedFilters(feedFilterMode)
                            }
                        >
                            {t('dialog.shared_feed_filters.reset')}
                        </Button>
                        <Button
                            type="button"
                            onClick={() => setFeedFilterDialogOpen(false)}
                        >
                            {t('dialog.alertdialog.ok')}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
