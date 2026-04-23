import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { openExternalLink } from '@/lib/entityMedia.js';
import { Textarea } from '@/ui/shadcn/textarea';

import { Field, FieldGroup } from '../SettingsField.jsx';

export function YoutubeApiDialog({
    t,
    open: youtubeApiDialogOpen,
    onOpenChange: setYoutubeApiDialogOpen,
    draft: youtubeApiKeyDraft,
    onDraftChange: setYoutubeApiKeyDraft,
    integrationStatus,
    onSave: saveYoutubeApiKey
}) {
    return (
            <Dialog
                open={youtubeApiDialogOpen}
                onOpenChange={setYoutubeApiDialogOpen}
            >
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {t('dialog.youtube_api.header')}
                        </DialogTitle>
                        <DialogDescription>
                            {t('dialog.youtube_api.description')}
                        </DialogDescription>
                    </DialogHeader>
                    <FieldGroup>
                        <Field
                            label={t('dialog.youtube_api.header')}
                            controlId="settings-youtube-api-key"
                        >
                            <Textarea
                                id="settings-youtube-api-key"
                                value={youtubeApiKeyDraft}
                                name="youtubeApiKey"
                                placeholder={t(
                                    'dialog.youtube_api.placeholder'
                                )}
                                maxLength={39}
                                rows={2}
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
                            onClick={() =>
                                void openExternalLink(
                                    'https://smashballoon.com/doc/youtube-api-key/'
                                )
                            }
                        >
                            {t('dialog.youtube_api.guide')}
                        </Button>
                        <Button
                            type="button"
                            disabled={integrationStatus.youtube === 'running'}
                            onClick={() => void saveYoutubeApiKey()}
                        >
                            {t('dialog.youtube_api.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
    );
}
