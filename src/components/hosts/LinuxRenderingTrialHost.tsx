import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type LinuxRenderingSnapshot
} from '@/platform/tauri/bindings';
import { restartApplication } from '@/services/shellIntegrationService';
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

export function LinuxRenderingTrialHost() {
    const { t } = useTranslation();
    const isLinux = useRuntimeStore(
        (state) => state.hostCapabilities.platform === 'linux'
    );
    const [snapshot, setSnapshot] = useState<LinuxRenderingSnapshot | null>(
        null
    );
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!isLinux) return;
        let active = true;
        commands
            .appGetLinuxRendering()
            .then((result) => {
                if (active) setSnapshot(result);
            })
            .catch((error: unknown) => {
                console.warn('Could not read Linux rendering setting:', error);
            });
        return () => {
            active = false;
        };
    }, [isLinux]);

    async function resolve(keep: boolean) {
        setBusy(true);
        setFailed(false);
        try {
            const result = keep
                ? await commands.appConfirmLinuxRendering()
                : await commands.appSetLinuxRendering(false);
            if (!keep) await restartApplication();
            setSnapshot(result);
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    }

    if (!isLinux || !snapshot?.needsConfirmation) return null;
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open && !busy) void resolve(false);
            }}
        >
            <DialogContent showCloseButton={false} className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {t('linux_rendering.confirm_title')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('linux_rendering.confirm_description')}
                    </DialogDescription>
                </DialogHeader>
                {failed ? (
                    <p role="alert" className="text-destructive text-sm">
                        {t('linux_rendering.failed')}
                    </p>
                ) : null}
                <DialogFooter>
                    <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                            void resolve(false);
                        }}
                    >
                        {t('linux_rendering.restore')}
                    </Button>
                    <Button
                        disabled={busy}
                        onClick={() => {
                            void resolve(true);
                        }}
                    >
                        {t('linux_rendering.keep')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
