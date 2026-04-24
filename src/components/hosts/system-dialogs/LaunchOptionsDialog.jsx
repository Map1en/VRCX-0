import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { backend } from '@/platform/index.js';
import { configRepository } from '@/repositories/index.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Textarea } from '@/ui/shadcn/textarea';

export function LaunchOptionsDialog({ open, onOpenChange }) {
    const { t } = useTranslation();
    const [launchArguments, setLaunchArguments] = useState('');
    const [vrcLaunchPathOverride, setVrcLaunchPathOverride] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        Promise.all([
            configRepository.getString('launchArguments', ''),
            configRepository.getString('vrcLaunchPathOverride', '')
        ])
            .then(([nextLaunchArguments, nextLaunchPath]) => {
                if (!active) {
                    return;
                }
                const normalizedLaunchPath =
                    nextLaunchPath && nextLaunchPath !== 'null'
                        ? nextLaunchPath
                        : '';
                setLaunchArguments(nextLaunchArguments || '');
                setVrcLaunchPathOverride(normalizedLaunchPath);
                if (nextLaunchPath === 'null') {
                    void configRepository.setString(
                        'vrcLaunchPathOverride',
                        ''
                    );
                }
            })
            .catch((error) => {
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t('host.system_dialogs.generated_toast.failed_to_load_launch_options')
                    )
                );
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [open]);

    async function handleSave() {
        const normalizedArguments = String(launchArguments)
            .replace(/\s+/g, ' ')
            .trim();
        if (
            vrcLaunchPathOverride &&
            vrcLaunchPathOverride.endsWith('.exe') &&
            !vrcLaunchPathOverride.endsWith('launch.exe')
        ) {
            toast.error(t('message.launch.invalid_path'));
            return;
        }

        setLoading(true);
        try {
            await Promise.all([
                configRepository.setString(
                    'launchArguments',
                    normalizedArguments
                ),
                configRepository.setString(
                    'vrcLaunchPathOverride',
                    vrcLaunchPathOverride
                )
            ]);
            setLaunchArguments(normalizedArguments);
            toast.success(t('dialog.system.generated.updated_launch_options'));
            onOpenChange(false);
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('host.system_dialogs.generated_toast.failed_to_save_launch_options')
                )
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.launch_options.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.launch_options.description')}{' '}
                        {t('dialog.launch_options.example')}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <div className="bg-muted/30 text-muted-foreground rounded-md border p-3 text-xs">
                        <div>{t('dialog.system.generated.fps_144')}</div>
                        <div>
                            {t('dialog.system.generated.enable_debug_gui')}
                        </div>
                        <div>
                            {t(
                                'dialog.system.generated.enable_sdk_log_levels'
                            )}
                        </div>
                        <div>
                            {t(
                                'dialog.system.generated.enable_udon_debug_logging'
                            )}
                        </div>
                    </div>
                    <Field>
                        <FieldLabel htmlFor="launch-options-arguments">
                            {t('dialog.launch_options.header')}
                        </FieldLabel>
                        <Textarea
                            id="launch-options-arguments"
                            rows={3}
                            value={launchArguments}
                            placeholder="e.g. --fps=144 --enable-sdk-log-levels"
                            onChange={(event) =>
                                setLaunchArguments(event.target.value)
                            }
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="launch-options-path-override">
                            {t('dialog.launch_options.path_override')}
                        </FieldLabel>
                        <Input
                            id="launch-options-path-override"
                            value={vrcLaunchPathOverride}
                            placeholder="C:\\Program Files (x86)\\Steam\\steamapps\\common\\VRChat\\launch.exe"
                            spellCheck={false}
                            onChange={(event) =>
                                setVrcLaunchPathOverride(event.target.value)
                            }
                        />
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                            void backend.app.OpenLink(
                                'https://docs.vrchat.com/docs/launch-options'
                            )
                        }
                    >
                        {t('dialog.launch_options.vrchat_docs')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                            void backend.app.OpenLink(
                                'https://docs.unity3d.com/Manual/CommandLineArguments.html'
                            )
                        }
                    >
                        {t('dialog.launch_options.unity_manual')}
                    </Button>
                    <Button
                        type="button"
                        disabled={loading}
                        onClick={() => void handleSave()}
                    >
                        {t('dialog.launch_options.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
