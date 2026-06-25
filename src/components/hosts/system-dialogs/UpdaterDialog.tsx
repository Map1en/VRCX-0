import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { openExternalLink } from '@/services/entityMediaService';
import { restartApplication } from '@/services/shellIntegrationService';
import {
    canInstallUpdatesOnPlatform,
    downloadAndInstallUpdate,
    fetchLatestBranchRelease,
    formatReleaseDisplayVersion,
    getPreviewStableReleaseUpdateMode,
    hasUpdateForBranch,
    type NormalizedRelease
} from '@/services/updateService';
import { links } from '@/shared/constants/link';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { FieldGroup } from '@/ui/shadcn/field';

const STABLE_BRANCH = 'Stable';

type UpdaterDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function UpdaterDialog({ open, onOpenChange }: UpdaterDialogProps) {
    const { t } = useTranslation();
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const hostArch = useRuntimeStore((state) => state.hostCapabilities.arch);
    const linuxPackageKind = useRuntimeStore(
        (state) => state.hostCapabilities.linuxPackageKind
    );
    const canInstallUpdates = canInstallUpdatesOnPlatform(hostPlatform);
    const previewStableUpdateMode = getPreviewStableReleaseUpdateMode();
    const isPreviewUpdateCheck = previewStableUpdateMode.enabled;

    const [latestRelease, setLatestRelease] =
        useState<NormalizedRelease | null>(null);
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [detail, setDetail] = useState('');
    const currentVersionText =
        // oxlint-disable-next-line no-undef
        formatReleaseDisplayVersion(VERSION || '') || '-';
    const latestVersionText =
        latestRelease?.displayVersion ||
        (latestRelease?.canonicalVersion
            ? formatReleaseDisplayVersion(latestRelease.canonicalVersion)
            : '') ||
        '-';
    const hasNewerRelease = latestRelease
        ? isPreviewUpdateCheck ||
          hasUpdateForBranch(
              STABLE_BRANCH,
              // oxlint-disable-next-line no-undef
              VERSION || '',
              latestRelease.canonicalVersion
          )
        : false;
    const visibleDetail =
        detail ||
        (latestRelease && !hasNewerRelease
            ? t('dialog.vrcx_updater.latest_version')
            : '');

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        setLatestRelease(null);
        setDetail(t('message.vrcx_updater.checking_update_state'));

        const releaseCheck = isPreviewUpdateCheck
            ? previewStableUpdateMode.check({
                  hostArch,
                  linuxPackageKind,
                  hostPlatform
              })
            : fetchLatestBranchRelease(STABLE_BRANCH, {
                  hostArch,
                  linuxPackageKind,
                  hostPlatform,
                  requireInstallerAsset: canInstallUpdates
              });

        releaseCheck
            .then((nextRelease) => {
                if (!active) {
                    return;
                }

                setLatestRelease(nextRelease);
                setDetail(
                    nextRelease
                        ? ''
                        : canInstallUpdates && !isPreviewUpdateCheck
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
        canInstallUpdates,
        hostArch,
        hostPlatform,
        isPreviewUpdateCheck,
        linuxPackageKind,
        open,
        t
    ]);

    async function handleInstallUpdate() {
        if (
            !canInstallUpdates ||
            !latestRelease ||
            !hasNewerRelease ||
            downloading
        ) {
            return;
        }

        setDownloading(true);
        setProgress(0);
        setDetail(
            t('host.system_dialogs.dynamic.downloading_value', {
                value: latestVersionText
            })
        );
        try {
            await downloadAndInstallUpdate(latestRelease, {
                hostArch,
                linuxPackageKind,
                hostPlatform,
                onProgress: setProgress
            });
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
            setProgress(0);
        }
    }

    async function handleOpenReleasePage() {
        await openExternalLink(latestRelease?.htmlUrl || links.releases);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.system.label.vrcx_0_update')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.system.dynamic.version_summary', {
                            current: currentVersionText,
                            latest: latestVersionText
                        })}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <div className="border-input bg-background flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-sm">
                        <div className="text-muted-foreground text-xs">
                            {t('dialog.system.action.update_path')}
                        </div>
                        <div className="text-foreground truncate font-medium tabular-nums">
                            {currentVersionText} -&gt; {latestVersionText}
                        </div>
                    </div>
                    {canInstallUpdates && downloading ? (
                        <div className="flex flex-col gap-2">
                            <div className="bg-muted h-2 overflow-hidden rounded-full">
                                <div
                                    className="bg-primary h-full transition-[width]"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <div className="text-muted-foreground text-xs">
                                {progress === 100
                                    ? t(
                                          'message.vrcx_updater.installing_update'
                                      )
                                    : `${progress}%`}
                            </div>
                        </div>
                    ) : null}
                    {visibleDetail ? (
                        <div className="text-muted-foreground text-sm">
                            {userFacingErrorMessage(
                                visibleDetail,
                                t('message.vrcx_updater.failed_install')
                            )}
                        </div>
                    ) : null}
                </FieldGroup>
                <DialogFooter>
                    {canInstallUpdates && !isPreviewUpdateCheck ? (
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
                            disabled={
                                loading ||
                                (isPreviewUpdateCheck && !latestRelease)
                            }
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
