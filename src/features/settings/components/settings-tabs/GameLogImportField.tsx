import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import type { GameLogImportFile } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { Button } from '@/ui/shadcn/button';

import { GameLogImportDialog } from '../settings-dialogs/GameLogImportDialog';
import { Field } from '../SettingsField';

const keyPrefix = 'view.settings.advanced.advanced_ui.import_recovery.game_log';

export function GameLogImportField() {
    const { t } = useTranslation();
    const [selecting, setSelecting] = useState(false);
    const [files, setFiles] = useState<GameLogImportFile[]>([]);

    async function selectFiles() {
        setSelecting(true);
        try {
            setFiles(await commands.appGameLogImportSelectFiles());
        } catch (error: unknown) {
            toast.add({
                type: 'error',
                title: t(`${keyPrefix}.failed`),
                description:
                    error instanceof Error ? error.message : String(error)
            });
        } finally {
            setSelecting(false);
        }
    }

    return (
        <Field
            settingId="advanced.import-recovery.gamelog-import"
            label={t(`${keyPrefix}.label`)}
            description={t(`${keyPrefix}.description`)}
        >
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selecting}
                onClick={() => void selectFiles()}
            >
                {t(`${keyPrefix}.select`)}
            </Button>
            {files.length > 0 ? (
                <GameLogImportDialog
                    files={files}
                    onOpenChange={(open) => {
                        if (!open) {
                            setFiles([]);
                        }
                    }}
                />
            ) : null}
        </Field>
    );
}
