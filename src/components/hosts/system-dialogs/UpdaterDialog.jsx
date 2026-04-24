import { useEffect, useRef, useState } from 'react';

import { useTranslation } from 'react-i18next';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { backend } from '@/platform/index.js';
import {
    defaultBranchForVersion,
    downloadUpdateAndWait,
    fetchBranchReleases,
    formatReleaseDisplayVersion,
    sanitizeBranch
} from '@/services/updateService.js';
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
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

export function UpdaterDialog({ open, onOpenChange }) {
    const { t } = useTranslation();

    const cancelTokenRef = useRef(null);
    const [branch, setBranch] = useState(() =>
        defaultBranchForVersion(VERSION || '')
    );
    const [releases, setReleases] = useState([]);
    const [releaseVersion, setReleaseVersion] = useState('');
    const [pendingInstall, setPendingInstall] = useState(false);
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [detail, setDetail] = useState('');
    const selectedRelease =
        releases.find((release) => release.canonicalVersion === releaseVersion) ||
        null;

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        setDetail('Checking update state.');

        backend.app
            .CheckForUpdateExe()
            .then((hasPendingInstall) => {
                if (active) {
                    setPendingInstall(Boolean(hasPendingInstall));
                }
            })
            .catch(() => {});

        fetchBranchReleases(branch)
            .then((nextReleases) => {
                if (!active) {
                    return;
                }

                setReleases(nextReleases);
                setReleaseVersion((current) =>
                    nextReleases.some(
                        (release) => release.canonicalVersion === current
                    )
                        ? current
                        : nextReleases[0]?.canonicalVersion || ''
                );
                setDetail(
                    nextReleases.length ? '' : 'No downloadable releases found.'
                );
            })
            .catch((error) => {
                if (active) {
                    setDetail(
                        userFacingErrorMessage(
                            error,
                            'Failed to load update releases.'
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
    }, [branch, open]);

    async function handleDownload() {
        if (!selectedRelease || downloading) {
            return;
        }

        const cancelToken = { cancelled: false };
        cancelTokenRef.current = cancelToken;
        setDownloading(true);
        setProgress(0);
        setDetail(
            t('host.system_dialogs.generated_dynamic.downloading_value', {
                value: selectedRelease.displayName
            })
        );
        try {
            await downloadUpdateAndWait(selectedRelease, {
                onProgress: setProgress,
                isCancelled: () => cancelToken.cancelled
            });
            setPendingInstall(true);
            setDetail(
                t(
                    'host.system_dialogs.generated_dynamic.value_is_ready_to_install',
                    { value: selectedRelease.displayName }
                )
            );
        } catch (error) {
            setDetail(
                userFacingErrorMessage(error, 'Failed to download update.')
            );
        } finally {
            if (cancelTokenRef.current === cancelToken) {
                cancelTokenRef.current = null;
            }
            setDownloading(false);
            setProgress(0);
        }
    }

    async function handleCancel() {
        if (cancelTokenRef.current) {
            cancelTokenRef.current.cancelled = true;
        }
        setDetail('Cancelling update download.');
        await backend.app.CancelUpdate().catch(() => {});
        setProgress(0);
    }

    function handleInstall() {
        void backend.app.RestartApplication(true);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.system.generated.vrcx_0_update')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.system.generated.current_version')}{' '}
                        {formatReleaseDisplayVersion(VERSION || '') || '-'}.
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Tabs
                        value={branch}
                        onValueChange={(value) =>
                            setBranch(sanitizeBranch(value))
                        }
                    >
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="Stable">
                                {t(
                                    'dialog.vrcx_updater.branch_stable'
                                )}
                            </TabsTrigger>
                            <TabsTrigger value="Beta">
                                {t('dialog.system.generated.beta')}
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                    <Select
                        value={releaseVersion}
                        onValueChange={setReleaseVersion}
                        disabled={loading || downloading}
                    >
                        <SelectTrigger>
                            <SelectValue
                                placeholder={
                                    loading
                                        ? 'Loading releases'
                                        : 'Select release'
                                }
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {releases.map((release) => (
                                    <SelectItem
                                        key={release.canonicalVersion}
                                        value={release.canonicalVersion}
                                    >
                                        {release.displayName}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    {downloading ? (
                        <div className="flex flex-col gap-2">
                            <div className="bg-muted h-2 overflow-hidden rounded-full">
                                <div
                                    className="bg-primary h-full transition-[width]"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <div className="text-muted-foreground text-xs">
                                {progress === 100
                                    ? 'Checking hash.'
                                    : `${progress}%`}
                            </div>
                        </div>
                    ) : null}
                    {pendingInstall ? (
                        <div className="bg-muted/30 rounded-md border p-3 text-sm">
                            {t(
                                'dialog.system.generated.an_update_is_downloaded_and_ready_to_install'
                            )}
                        </div>
                    ) : null}
                    {detail ? (
                        <div className="text-muted-foreground text-sm">
                            {userFacingErrorMessage(
                                detail,
                                'Failed to update VRCX-0.'
                            )}
                        </div>
                    ) : null}
                </FieldGroup>
                <DialogFooter>
                    {downloading ? (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => void handleCancel()}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        disabled={!selectedRelease || loading || downloading}
                        onClick={() => void handleDownload()}
                    >
                        {t('dialog.vrcx_updater.download')}
                    </Button>
                    <Button
                        type="button"
                        disabled={downloading || !pendingInstall}
                        onClick={handleInstall}
                    >
                        {t(
                            'dialog.system.generated.install_and_restart'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
