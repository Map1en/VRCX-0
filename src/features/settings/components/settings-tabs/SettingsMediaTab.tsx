import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Switch } from '@/ui/shadcn/switch';

import { Field, SettingsGroup } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';

type SettingsMediaPrefs = {
    screenshotHelper: boolean;
    screenshotHelperModifyFilename: boolean;
    screenshotHelperCopyToClipboard: boolean;
    saveInstancePrints: boolean;
    cropInstancePrints: boolean;
    autoDeleteOldPrints: boolean;
    autoDeletePrintsLimit: unknown;
    saveInstanceStickers: boolean;
    saveInstanceEmoji: boolean;
    userGeneratedContentPath?: unknown;
};

type SettingsMediaState = {
    prefs: SettingsMediaPrefs;
    onScreenshotHelperChange: (checked: boolean) => unknown;
    onScreenshotHelperModifyFilenameChange: (checked: boolean) => unknown;
    onScreenshotHelperCopyToClipboardChange: (checked: boolean) => unknown;
    onDeleteAllScreenshotMetadata: () => unknown;
    onOpenUgcPhotosFolder: () => unknown;
    onOpenUgcFolderSelector: () => unknown;
    onResetUgcFolder: () => unknown;
    onSaveInstancePrintsChange: (checked: boolean) => unknown;
    onCropInstancePrintsChange: (checked: boolean) => unknown;
    onAutoDeleteOldPrintsChange: (checked: boolean) => unknown;
    onAutoDeletePrintsLimitChange: (value: unknown) => unknown;
    onAutoDeletePrintsLimitBlur: (value: unknown) => unknown;
    onSaveInstanceStickersChange: (checked: boolean) => unknown;
    onSaveInstanceEmojiChange: (checked: boolean) => unknown;
};

type SettingsMediaTabProps = {
    media: SettingsMediaState;
};

export function SettingsMediaTab({ media }: SettingsMediaTabProps) {
    const {
        prefs,
        onScreenshotHelperChange,
        onScreenshotHelperModifyFilenameChange,
        onScreenshotHelperCopyToClipboardChange,
        onDeleteAllScreenshotMetadata,
        onOpenUgcPhotosFolder,
        onOpenUgcFolderSelector,
        onResetUgcFolder,
        onSaveInstancePrintsChange,
        onCropInstancePrintsChange,
        onAutoDeleteOldPrintsChange,
        onAutoDeletePrintsLimitChange,
        onAutoDeletePrintsLimitBlur,
        onSaveInstanceStickersChange,
        onSaveInstanceEmojiChange
    } = media;
    const { t } = useTranslation();
    return (
        <SettingsTabContent value="media">
            <SettingsGroup
                title={t(
                    'view.settings.advanced.advanced.screenshot_helper.header'
                )}
                description={t(
                    'view.settings.advanced.advanced.screenshot_helper.description'
                )}
            >
                <Field
                    label={t(
                        'view.settings.advanced.advanced.screenshot_helper.enable'
                    )}
                    description={t(
                        'view.settings.advanced.advanced.screenshot_helper.description_tooltip'
                    )}
                >
                    <Switch
                        checked={prefs.screenshotHelper}
                        onCheckedChange={onScreenshotHelperChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.advanced.advanced.screenshot_helper.modify_filename'
                    )}
                    description={t(
                        'view.settings.advanced.advanced.screenshot_helper.modify_filename_tooltip'
                    )}
                >
                    <Switch
                        checked={prefs.screenshotHelperModifyFilename}
                        disabled={!prefs.screenshotHelper}
                        onCheckedChange={onScreenshotHelperModifyFilenameChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.advanced.advanced.screenshot_helper.copy_to_clipboard'
                    )}
                >
                    <Switch
                        checked={prefs.screenshotHelperCopyToClipboard}
                        onCheckedChange={
                            onScreenshotHelperCopyToClipboardChange
                        }
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.advanced.advanced.delete_all_screenshot_metadata.button'
                    )}
                >
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={onDeleteAllScreenshotMetadata}
                    >
                        {t(
                            'view.settings.advanced.advanced.delete_all_screenshot_metadata.button'
                        )}
                    </Button>
                </Field>
            </SettingsGroup>
            <SettingsGroup
                title={t('view.settings.advanced.advanced.user_content.header')}
                description={t(
                    'view.settings.advanced.advanced.user_content.description'
                )}
            >
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onOpenUgcPhotosFolder}
                    >
                        {t(
                            'view.settings.advanced.advanced.user_content.folder'
                        )}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onOpenUgcFolderSelector}
                    >
                        {t(
                            'view.settings.advanced.advanced.user_content.set_folder'
                        )}
                    </Button>
                    {prefs.userGeneratedContentPath ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onResetUgcFolder}
                        >
                            {t(
                                'view.settings.advanced.advanced.user_content.reset_override'
                            )}
                        </Button>
                    ) : null}
                </div>
            </SettingsGroup>
            <SettingsGroup
                title={t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.header'
                )}
                description={t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.header_tooltip'
                )}
            >
                <Field
                    label={t(
                        'view.settings.advanced.advanced.save_instance_prints_to_file.description'
                    )}
                >
                    <Switch
                        checked={prefs.saveInstancePrints}
                        onCheckedChange={onSaveInstancePrintsChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.advanced.advanced.save_instance_prints_to_file.crop'
                    )}
                >
                    <Switch
                        checked={prefs.cropInstancePrints}
                        disabled={!prefs.saveInstancePrints}
                        onCheckedChange={onCropInstancePrintsChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.advanced.advanced.auto_delete_prints.enable'
                    )}
                    description={t(
                        'view.settings.advanced.advanced.auto_delete_prints.description'
                    )}
                >
                    <Switch
                        checked={prefs.autoDeleteOldPrints}
                        onCheckedChange={onAutoDeleteOldPrintsChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.advanced.advanced.auto_delete_prints.limit'
                    )}
                    description={t(
                        'view.settings.advanced.advanced.auto_delete_prints.limit_description'
                    )}
                >
                    <Input
                        type="number"
                        min={30}
                        max={60}
                        step={1}
                        className="w-24"
                        value={String(prefs.autoDeletePrintsLimit ?? 60)}
                        disabled={!prefs.autoDeleteOldPrints}
                        onChange={(event) =>
                            onAutoDeletePrintsLimitChange(event.target.value)
                        }
                        onBlur={(event) =>
                            onAutoDeletePrintsLimitBlur(event.target.value)
                        }
                    />
                </Field>
            </SettingsGroup>
            <SettingsGroup
                title={t(
                    'view.settings.advanced.advanced.save_instance_stickers_to_file.header'
                )}
            >
                <Field
                    label={t(
                        'view.settings.advanced.advanced.save_instance_stickers_to_file.description'
                    )}
                >
                    <Switch
                        checked={prefs.saveInstanceStickers}
                        onCheckedChange={onSaveInstanceStickersChange}
                    />
                </Field>
            </SettingsGroup>
            <SettingsGroup
                title={t(
                    'view.settings.advanced.advanced.save_instance_emoji_to_file.header'
                )}
                description={t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.header_tooltip'
                )}
            >
                <Field
                    label={t(
                        'view.settings.advanced.advanced.save_instance_emoji_to_file.description'
                    )}
                >
                    <Switch
                        checked={prefs.saveInstanceEmoji}
                        onCheckedChange={onSaveInstanceEmojiChange}
                    />
                </Field>
            </SettingsGroup>
        </SettingsTabContent>
    );
}
