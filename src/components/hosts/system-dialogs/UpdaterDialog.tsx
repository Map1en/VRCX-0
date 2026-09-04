import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands } from '@/platform/tauri/bindings';
import { openExternalLink } from '@/services/entityMediaService';
import { restartApplication } from '@/services/shellIntegrationService';
import {
    confirmInstall,
    formatReleaseDisplayVersion,
    getPreviewStableReleaseUpdateMode,
    toNormalizedReleaseFromSnapshot,
    type NormalizedRelease
} from '@/services/updateService';
import { isUpdateCheckDisabledBuild } from '@/shared/buildLabel';
import { links } from '@/shared/constants/link';
import {
    releaseChannelForVersion,
    type ReleaseChannel
} from '@/shared/utils/releaseVersion';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Badge } from '@/ui/shadcn/badge';
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
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel
} from '@/ui/shadcn/field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

type UpdaterDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function UpdaterDialog({ open, onOpenChange }: UpdaterDialogProps) {
    const { t } = useTranslation();
    const isPreviewUpdateCheck = getPreviewStableReleaseUpdateMode().enabled;
    const updateCheckDisabled = isUpdateCheckDisabledBuild();
    const currentChannel = releaseChannelForVersion(VERSION || '') ?? 'stable';

    const [selectedChannel, setSelectedChannel] =
        useState<ReleaseChannel>(currentChannel);
    const [latestRelease, setLatestRelease] =
        useState<NormalizedRelease | null>(null);
    const [hasNewerRelease, setHasNewerRelease] = useState(false);
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [detail, setDetail] = useState('');
    const canInstallUpdate = latestRelease?.updaterType === 'tauri';
    const autoDownloadState = useRuntimeStore(
        (state) => state.updateLoop.autoDownloadState
    );
    const downloadedVersion = useRuntimeStore(
        (state) => state.updateLoop.downloadedVersion
    );
    const downloadProgress = useRuntimeStore(
        (state) => state.updateLoop.downloadProgress
    );
    const hasMatchingDownload =
        latestRelease?.canonicalVersion === downloadedVersion;
    const progress = hasMatchingDownload ? downloadProgress : 0;
    const showDownloadProgress =
        canInstallUpdate &&
        (downloading ||
            (autoDownloadState === 'downloading' && hasMatchingDownload));
    const currentVersionText =
        formatReleaseDisplayVersion(VERSION || '') || '-';
    const latestVersionText =
        latestRelease?.displayVersion ||
        (latestRelease?.canonicalVersion
            ? formatReleaseDisplayVersion(latestRelease.canonicalVersion)
            : '') ||
        '-';
    const isChangingChannel = selectedChannel !== currentChannel;
    const isUpToDate = Boolean(
        !isChangingChannel && latestRelease && !hasNewerRelease
    );

    useEffect(() => {
        if (!open) {
            setSelectedChannel(currentChannel);
        }
    }, [currentChannel, open]);

    useEffect(() => {
        if (!open || updateCheckDisabled) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        setLatestRelease(null);
        setHasNewerRelease(false);
        setDetail(t('message.vrcx_updater.checking_update_state'));

        const request = async () => {
            if (isChangingChannel) {
                return {
                    error: null,
                    release:
                        await commands.appAppUpdateReleaseGet(selectedChannel),
                    hasAvailableUpdate: false
                };
            }
            return commands.appAppUpdateCheckRun();
        };

        request()
            .then((snapshot) => {
                if (!active) {
                    return;
                }

                if (snapshot.error) {
                    setDetail(
                        userFacingErrorMessage(
                            snapshot.error,
                            t(
                                'message.vrcx_updater.failed_to_load_update_releases'
                            )
                        )
                    );
                    return;
                }

                const nextRelease = toNormalizedReleaseFromSnapshot(
                    snapshot.release
                );
                setLatestRelease(nextRelease);
                setHasNewerRelease(
                    isChangingChannel ? false : snapshot.hasAvailableUpdate
                );
                setDetail(
                    nextRelease
                        ? ''
                        : isChangingChannel
                          ? t('dialog.vrcx_updater.channel.no_release')
                          : !isPreviewUpdateCheck
                            ? t(
                                  'message.vrcx_updater.no_downloadable_releases_found'
                              )
                            : t('message.vrcx_updater.no_releases_found')
                );
            })
            .catch((error: unknown) => {
                if (active) {
                    setDetail(
                        userFacingErrorMessage(
                            error,
                            t(
                                'message.vrcx_updater.failed_to_load_update_releases'
                            )
                        )
                    );
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [
        isChangingChannel,
        isPreviewUpdateCheck,
        open,
        selectedChannel,
        t,
        updateCheckDisabled
    ]);

    async function handleInstallUpdate() {
        if (
            !canInstallUpdate ||
            !latestRelease ||
            !hasNewerRelease ||
            downloading
        ) {
            return;
        }

        setDownloading(true);
        setDetail(
            t('host.system_dialogs.dynamic.downloading_value', {
                value: latestVersionText
            })
        );
        try {
            await confirmInstall(latestRelease.canonicalVersion);
            await restartApplication();
        } catch (error) {
            setDetail(
                userFacingErrorMessage(
                    error,
                    t('message.vrcx_updater.failed_install')
                )
            );
        } finally {
            setDownloading(false);
        }
    }

    async function handleOpenReleasePage() {
        await openExternalLink(latestRelease?.htmlUrl || links.releases);
    }

    if (updateCheckDisabled) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {t('dialog.system.label.vrcx_0_update')}
                        </DialogTitle>
                        <DialogDescription>
                            {t(
                                'view.settings.general.application.update_check_disabled_build_description'
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <FieldGroup>
                        <div className="border-input bg-background flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                            <span className="text-foreground font-medium">
                                {t(
                                    'view.settings.general.application.check_for_updates_and_update'
                                )}
                            </span>
                            <Badge variant="secondary">
                                {t(
                                    'view.settings.general.application.update_check_disabled'
                                )}
                            </Badge>
                        </div>
                    </FieldGroup>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.system.label.vrcx_0_update')}
                    </DialogTitle>
                    <DialogDescription>
                        {isChangingChannel
                            ? t(
                                  'dialog.vrcx_updater.channel.switch_description',
                                  {
                                      channel: t(
                                          `dialog.vrcx_updater.channel.${selectedChannel}`
                                      )
                                  }
                              )
                            : isUpToDate
                              ? t('dialog.vrcx_updater.latest_version')
                              : t('dialog.system.dynamic.version_summary', {
                                    current: currentVersionText,
                                    latest: latestVersionText
                                })}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    {!isPreviewUpdateCheck ? (
                        <Field>
                            <FieldLabel>
                                {t('dialog.vrcx_updater.channel.label')}
                            </FieldLabel>
                            <Select
                                value={selectedChannel}
                                onValueChange={(value) => {
                                    if (
                                        value === 'stable' ||
                                        value === 'beta'
                                    ) {
                                        setSelectedChannel(value);
                                    }
                                }}
                                items={[
                                    {
                                        value: 'stable',
                                        label: t(
                                            'dialog.vrcx_updater.channel.stable'
                                        )
                                    },
                                    {
                                        value: 'beta',
                                        label: t(
                                            'dialog.vrcx_updater.channel.beta'
                                        )
                                    }
                                ]}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value="stable">
                                            {t(
                                                'dialog.vrcx_updater.channel.stable'
                                            )}
                                        </SelectItem>
                                        <SelectItem value="beta">
                                            {t(
                                                'dialog.vrcx_updater.channel.beta'
                                            )}
                                        </SelectItem>
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            <FieldDescription>
                                {t('dialog.vrcx_updater.channel.description')}
                            </FieldDescription>
                        </Field>
                    ) : null}
                    <div className="border-input bg-background flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-sm">
                        <div className="text-muted-foreground text-xs">
                            {isUpToDate
                                ? t('message.vrcx_updater.current_version')
                                : t('dialog.system.action.update_path')}
                        </div>
                        <div className="text-foreground truncate font-medium tabular-nums">
                            {isUpToDate
                                ? currentVersionText
                                : `${currentVersionText} -> ${latestVersionText}`}
                        </div>
                    </div>
                    {showDownloadProgress ? (
                        <div className="flex flex-col gap-2">
                            <div className="bg-muted h-2 overflow-hidden rounded-full">
                                <div
                                    className="bg-primary h-full transition-[width]"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <div className="text-muted-foreground text-xs">
                                {autoDownloadState === 'downloaded' ||
                                autoDownloadState === 'installing'
                                    ? t(
                                          'message.vrcx_updater.installing_update'
                                      )
                                    : `${progress}%`}
                            </div>
                        </div>
                    ) : null}
                    {detail ? (
                        <div className="text-muted-foreground text-sm">
                            {userFacingErrorMessage(
                                detail,
                                t('message.vrcx_updater.failed_install')
                            )}
                        </div>
                    ) : null}
                </FieldGroup>
                <DialogFooter>
                    {isChangingChannel ? (
                        <Button
                            type="button"
                            disabled={loading || !latestRelease}
                            onClick={() => {
                                handleOpenReleasePage();
                            }}
                        >
                            {t(
                                `dialog.vrcx_updater.channel.download_${selectedChannel}`
                            )}
                        </Button>
                    ) : canInstallUpdate && !isPreviewUpdateCheck ? (
                        <Button
                            type="button"
                            disabled={
                                !latestRelease ||
                                !hasNewerRelease ||
                                loading ||
                                downloading
                            }
                            onClick={() => {
                                handleInstallUpdate();
                            }}
                        >
                            {t('dialog.system.action.install_and_restart')}
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            disabled={loading || !latestRelease}
                            onClick={() => {
                                handleOpenReleasePage();
                            }}
                        >
                            {t('nav_menu.update')}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
