import { useTranslation } from 'react-i18next';

import { openExternalLink } from '@/services/entityMediaService';
import { SecretInput } from '@/ui/secret-input';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

import type { SettingsPageStateSections } from '../../settingsPageStateSections';
import { Field, FieldGroup } from '../SettingsField';

type DialogState = SettingsPageStateSections['dialogs'];
type YoutubeApiDialogProps = {
    open: DialogState['youtubeApiDialogOpen'];
    onOpenChange: DialogState['setYoutubeApiDialogOpen'];
    draft: DialogState['youtubeApiKeyDraft'];
    onDraftChange: DialogState['setYoutubeApiKeyDraft'];
    integrationStatus: DialogState['integrationStatus'];
    onSave: DialogState['saveYoutubeApiKey'];
};

export function YoutubeApiDialog({
    open: youtubeApiDialogOpen,
    onOpenChange: setYoutubeApiDialogOpen,
    draft: youtubeApiKeyDraft,
    onDraftChange: setYoutubeApiKeyDraft,
    integrationStatus,
    onSave: saveYoutubeApiKey
}: YoutubeApiDialogProps) {
    const { t } = useTranslation();

    return (
        <Dialog
            open={youtubeApiDialogOpen}
            onOpenChange={setYoutubeApiDialogOpen}
        >
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('dialog.youtube_api.header')}</DialogTitle>
                    <DialogDescription>
                        {t('dialog.youtube_api.description')}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Field
                        label={t('dialog.youtube_api.header')}
                        controlId="settings-youtube-api-key"
                    >
                        <SecretInput
                            id="settings-youtube-api-key"
                            value={youtubeApiKeyDraft}
                            name="youtubeApiKey"
                            placeholder={t('dialog.youtube_api.placeholder')}
                            maxLength={39}
                            onChange={(event) =>
                                setYoutubeApiKeyDraft(event.target.value)
                            }
                        />
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            openExternalLink(
                                'https://smashballoon.com/doc/youtube-api-key/'
                            );
                        }}
                    >
                        {t('dialog.youtube_api.guide')}
                    </Button>
                    <Button
                        type="button"
                        disabled={integrationStatus.youtube === 'running'}
                        onClick={() => {
                            saveYoutubeApiKey();
                        }}
                    >
                        {t('dialog.youtube_api.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
