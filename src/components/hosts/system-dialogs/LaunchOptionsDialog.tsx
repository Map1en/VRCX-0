import { ExternalLinkIcon, FolderOpenIcon, SaveIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import configRepository from '@/repositories/configRepository';
import {
    openExternalLink,
    openFileSelectorDialog
} from '@/services/shellIntegrationService';
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
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Textarea } from '@/ui/shadcn/textarea';

export function LaunchOptionsDialog({ open, onOpenChange }: any) {
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
            .then(([nextLaunchArguments, nextLaunchPath]: any) => {
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
                    configRepository.setString('vrcLaunchPathOverride', '');
                }
            })
            .catch((error: any) => {
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t(
                            'host.system_dialogs.toast.failed_to_load_launch_options'
                        )
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
            toast.success(t('dialog.system.success.updated_launch_options'));
            onOpenChange(false);
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('host.system_dialogs.toast.failed_to_save_launch_options')
                )
            );
        } finally {
            setLoading(false);
        }
    }

    async function handleBrowseLaunchPath() {
        try {
            const selected = await openFileSelectorDialog(
                vrcLaunchPathOverride || '',
                '.exe',
                'Executable Files (*.exe)|*.exe|All Files (*.*)|*.*'
            );
            if (selected) {
                setVrcLaunchPathOverride(selected);
            }
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('host.system_dialogs.toast.failed_to_load_launch_options')
                )
            );
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[calc(100%-2rem)] max-w-3xl sm:max-w-3xl">
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
                        <div>{t('dialog.system.label.fps_144')}</div>
                        <div>{t('dialog.system.action.enable_debug_gui')}</div>
                        <div>
                            {t('dialog.system.action.enable_sdk_log_levels')}
                        </div>
                        <div>
                            {t(
                                'dialog.system.action.enable_udon_debug_logging'
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
                            onChange={(event: any) =>
                                setLaunchArguments(event.target.value)
                            }
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="launch-options-path-override">
                            {t('dialog.launch_options.path_override')}
                        </FieldLabel>
                        <InputGroup>
                            <InputGroupInput
                                id="launch-options-path-override"
                                value={vrcLaunchPathOverride}
                                placeholder="C:\\Program Files (x86)\\Steam\\steamapps\\common\\VRChat\\launch.exe"
                                spellCheck={false}
                                onChange={(event: any) =>
                                    setVrcLaunchPathOverride(event.target.value)
                                }
                            />
                            <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                    type="button"
                                    onClick={handleBrowseLaunchPath}
                                >
                                    <FolderOpenIcon data-icon="inline-start" />
                                    {t('dialog.screenshot_metadata.browse')}
                                </InputGroupButton>
                            </InputGroupAddon>
                        </InputGroup>
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            openExternalLink(
                                'https://docs.vrchat.com/docs/launch-options'
                            );
                        }}
                    >
                        <ExternalLinkIcon data-icon="inline-start" />
                        {t('dialog.launch_options.vrchat_docs')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            openExternalLink(
                                'https://docs.unity3d.com/Manual/CommandLineArguments.html'
                            );
                        }}
                    >
                        <ExternalLinkIcon data-icon="inline-start" />
                        {t('dialog.launch_options.unity_manual')}
                    </Button>
                    <Button
                        type="button"
                        disabled={loading}
                        onClick={() => {
                            handleSave();
                        }}
                    >
                        <SaveIcon data-icon="inline-start" />
                        {t('dialog.launch_options.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
