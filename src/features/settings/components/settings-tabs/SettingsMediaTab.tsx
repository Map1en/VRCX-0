import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { usePreferencesStore } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';
import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
} from '@/ui/shadcn/number-field';
import { Switch } from '@/ui/shadcn/switch';

import { SETTINGS_DEFAULT_VALUES } from '../../settingsFieldState';
import { useSettingsPageSection } from '../../SettingsPageStateContext';
import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';

export function SettingsMediaTab() {
    const media = useSettingsPageSection('media');
    const prefs = usePreferencesStore(
        useShallow((state) => ({
            screenshotHelper: state.screenshotHelper,
            screenshotHelperModifyFilename:
                state.screenshotHelperModifyFilename,
            screenshotHelperCopyToClipboard:
                state.screenshotHelperCopyToClipboard,
            userGeneratedContentPath: state.userGeneratedContentPath,
            saveInstancePrints: state.saveInstancePrints,
            cropInstancePrints: state.cropInstancePrints,
            autoDeleteOldPrints: state.autoDeleteOldPrints,
            autoDeletePrintsLimit: state.autoDeletePrintsLimit,
            saveInstanceStickers: state.saveInstanceStickers,
            saveInstanceEmoji: state.saveInstanceEmoji
        }))
    );
    const {
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
            <SettingsCard
                cardId="media.screenshots"
                title={t(
                    'view.settings.advanced.advanced.screenshot_helper.header'
                )}
                description={t(
                    'view.settings.advanced.advanced.screenshot_helper.description'
                )}
            >
                <Field
                    settingId="media.screenshots.helper"
                    onReset={() =>
                        onScreenshotHelperChange(
                            SETTINGS_DEFAULT_VALUES.screenshotHelper
                        )
                    }
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
                    settingId="media.screenshots.modify-filename"
                    onReset={() =>
                        onScreenshotHelperModifyFilenameChange(
                            SETTINGS_DEFAULT_VALUES.screenshotHelperModifyFilename
                        )
                    }
                    label={t(
                        'view.settings.advanced.advanced.screenshot_helper.modify_filename'
                    )}
                    description={t(
                        'view.settings.advanced.advanced.screenshot_helper.modify_filename_tooltip'
                    )}
                >
                    <Switch
                        checked={prefs.screenshotHelperModifyFilename}
                        onCheckedChange={onScreenshotHelperModifyFilenameChange}
                    />
                </Field>
                <Field
                    settingId="media.screenshots.copy-to-clipboard"
                    onReset={() =>
                        onScreenshotHelperCopyToClipboardChange(
                            SETTINGS_DEFAULT_VALUES.screenshotHelperCopyToClipboard
                        )
                    }
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
                    settingId="media.screenshots.delete-metadata"
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
            </SettingsCard>
            <SettingsCard
                cardId="media.user-content"
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
            </SettingsCard>
            <SettingsCard
                cardId="media.prints"
                title={t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.header'
                )}
                description={t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.header_tooltip'
                )}
            >
                <Field
                    settingId="media.prints.save"
                    onReset={() =>
                        onSaveInstancePrintsChange(
                            SETTINGS_DEFAULT_VALUES.saveInstancePrints
                        )
                    }
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
                    settingId="media.prints.crop"
                    onReset={() =>
                        onCropInstancePrintsChange(
                            SETTINGS_DEFAULT_VALUES.cropInstancePrints
                        )
                    }
                    label={t(
                        'view.settings.advanced.advanced.save_instance_prints_to_file.crop'
                    )}
                >
                    <Switch
                        checked={prefs.cropInstancePrints}
                        onCheckedChange={onCropInstancePrintsChange}
                    />
                </Field>
                <Field
                    settingId="media.prints.auto-delete"
                    onReset={() =>
                        onAutoDeleteOldPrintsChange(
                            SETTINGS_DEFAULT_VALUES.autoDeleteOldPrints
                        )
                    }
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
                    settingId="media.prints.auto-delete-limit"
                    onReset={() =>
                        onAutoDeletePrintsLimitBlur(
                            String(
                                SETTINGS_DEFAULT_VALUES.autoDeletePrintsLimit
                            )
                        )
                    }
                    label={t(
                        'view.settings.advanced.advanced.auto_delete_prints.limit'
                    )}
                    description={t(
                        'view.settings.advanced.advanced.auto_delete_prints.limit_description'
                    )}
                >
                    <NumberField
                        min={30}
                        max={60}
                        step={1}
                        allowOutOfRange
                        className="w-32"
                        value={prefs.autoDeletePrintsLimit ?? 60}
                        onValueChange={(value) =>
                            onAutoDeletePrintsLimitChange(
                                value === null ? '' : String(value)
                            )
                        }
                        onValueCommitted={(value) =>
                            onAutoDeletePrintsLimitBlur(
                                value === null ? '' : String(value)
                            )
                        }
                    >
                        <NumberFieldGroup>
                            <NumberFieldDecrement />
                            <NumberFieldInput />
                            <NumberFieldIncrement />
                        </NumberFieldGroup>
                    </NumberField>
                </Field>
            </SettingsCard>
            <SettingsCard
                cardId="media.stickers"
                title={t(
                    'view.settings.advanced.advanced.save_instance_stickers_to_file.header'
                )}
            >
                <Field
                    settingId="media.stickers.save"
                    onReset={() =>
                        onSaveInstanceStickersChange(
                            SETTINGS_DEFAULT_VALUES.saveInstanceStickers
                        )
                    }
                    label={t(
                        'view.settings.advanced.advanced.save_instance_stickers_to_file.description'
                    )}
                >
                    <Switch
                        checked={prefs.saveInstanceStickers}
                        onCheckedChange={onSaveInstanceStickersChange}
                    />
                </Field>
            </SettingsCard>
            <SettingsCard
                cardId="media.emoji"
                title={t(
                    'view.settings.advanced.advanced.save_instance_emoji_to_file.header'
                )}
                description={t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.header_tooltip'
                )}
            >
                <Field
                    settingId="media.emoji.save"
                    onReset={() =>
                        onSaveInstanceEmojiChange(
                            SETTINGS_DEFAULT_VALUES.saveInstanceEmoji
                        )
                    }
                    label={t(
                        'view.settings.advanced.advanced.save_instance_emoji_to_file.description'
                    )}
                >
                    <Switch
                        checked={prefs.saveInstanceEmoji}
                        onCheckedChange={onSaveInstanceEmojiChange}
                    />
                </Field>
            </SettingsCard>
        </SettingsTabContent>
    );
}
