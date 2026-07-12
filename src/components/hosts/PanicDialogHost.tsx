import { CheckIcon, ChevronDown, CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import type { FrontendPanicSnapshot } from '@/platform/tauri/bindings';
import { copyTextToClipboard } from '@/services/clipboardService';
import { openExternalLink } from '@/services/shellIntegrationService';
import { links } from '@/shared/constants/link';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Switch } from '@/ui/shadcn/switch';

export function PanicDialogHost() {
    const { t } = useTranslation();
    const [snapshot, setSnapshot] = useState<FrontendPanicSnapshot | null>(
        null
    );
    const [showRawBacktrace, setShowRawBacktrace] = useState(false);

    useEffect(() => {
        let active = true;
        commands
            .appTakePanicSnapshot()
            .then((snapshot) => {
                if (active && snapshot) {
                    setSnapshot(snapshot);
                }
            })
            .catch((err) => {
                console.error('Failed to check panic snapshot:', err);
            });
        return () => {
            active = false;
        };
    }, []);

    if (!snapshot) {
        return null;
    }

    const handleOpenGitHubIssue = async () => {
        await openExternalLink(links.issues);
    };

    const handleShowSnapshot = async () => {
        if (snapshot?.date) {
            try {
                await commands.appShowDatedPanicSnapshot(snapshot.date);
            } catch (err) {
                console.error('Failed to open dated panic snapshot:', err);
            }
        }
    };

    const isRawForce = !snapshot.backtrace;
    const isRaw = showRawBacktrace || isRawForce;

    return (
        <Dialog
            open={true}
            onOpenChange={(open) => {
                if (!open) setSnapshot(null);
            }}
        >
            <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] !max-w-[calc(100vw-2rem)] flex-col overflow-hidden md:w-[47rem] md:!max-w-[47rem]">
                <DialogHeader>
                    <DialogTitle>{t('dialog.panic.title')}</DialogTitle>
                </DialogHeader>

                <div className="text-foreground/90 flex-1 space-y-4 overflow-y-auto pr-1 text-sm">
                    <p className="whitespace-pre-line">
                        {t('dialog.panic.info_instructions')}
                    </p>

                    <div className="bg-muted/40 space-y-2 rounded-lg border p-4">
                        <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                            {t('dialog.panic.general_info')}
                        </div>
                        <div className="grid grid-cols-3 items-center gap-2">
                            <span className="text-muted-foreground font-medium">
                                {t('dialog.panic.os_version')}:
                            </span>
                            <div className="group/row col-span-2 flex items-center justify-between gap-2 font-mono break-all">
                                <span>{snapshot!.osVersion}</span>
                                <CopyButton
                                    text={snapshot!.osVersion}
                                    ariaLabel="Copy OS Version"
                                />
                            </div>

                            <span className="text-muted-foreground font-medium">
                                {t('dialog.panic.vrcx_version')}:
                            </span>
                            <div className="group/row col-span-2 flex items-center justify-between gap-2 font-mono break-all">
                                <span>{snapshot!.appVersion}</span>
                                <CopyButton
                                    text={snapshot!.appVersion}
                                    ariaLabel="Copy VRCX-0 Version"
                                />
                            </div>

                            {snapshot!.message && (
                                <>
                                    <span className="text-muted-foreground font-medium">
                                        {t('dialog.panic.message')}
                                    </span>
                                    <div className="group/row col-span-2 flex items-center justify-between gap-2 font-mono break-all">
                                        <span>{snapshot!.message}</span>
                                        <CopyButton
                                            text={snapshot!.message!}
                                            ariaLabel="Copy Panic Message"
                                        />
                                    </div>
                                </>
                            )}
                            {snapshot!.location && (
                                <>
                                    <span className="text-muted-foreground font-medium">
                                        {t('dialog.panic.location')}
                                    </span>
                                    <div className="group/row col-span-2 flex items-center justify-between gap-2 font-mono break-all">
                                        <span>{snapshot!.location}</span>
                                        <CopyButton
                                            text={snapshot!.location!}
                                            ariaLabel="Copy Location"
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    <details className="group bg-muted/20 overflow-hidden rounded-lg border">
                        <summary className="hover:bg-muted/30 flex cursor-pointer list-none items-center justify-between p-3 font-medium select-none [&::-webkit-details-marker]:hidden">
                            <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                                {t('dialog.panic.backtrace')}
                            </span>
                            <ChevronDown className="text-muted-foreground h-4 w-4 transition-transform duration-200 group-open:rotate-180" />
                        </summary>
                        <div className="overflow-x-auto border-t bg-black/10 p-3 font-mono text-xs dark:bg-black/35">
                            <div className="mb-2 flex items-center justify-between px-1">
                                <label className="text-muted-foreground flex cursor-pointer items-center gap-2 font-sans text-xs select-none">
                                    <Switch
                                        checked={isRaw}
                                        disabled={isRawForce}
                                        onCheckedChange={setShowRawBacktrace}
                                    />
                                    <span>
                                        {t('dialog.panic.show_raw_backtrace')}
                                    </span>
                                </label>
                            </div>
                            <pre className="max-h-[250px] overflow-y-auto leading-relaxed break-all whitespace-pre-wrap select-all">
                                {isRaw
                                    ? snapshot.backtraceRaw
                                    : snapshot.backtrace}
                            </pre>
                        </div>
                    </details>
                </div>

                <DialogFooter className="flex items-center gap-2 sm:justify-between">
                    <p className="text-destructive">
                        {t('dialog.panic.info_notice')}
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setSnapshot(null)}
                        >
                            {t('common.actions.close')}
                        </Button>

                        <Button variant="outline" onClick={handleShowSnapshot}>
                            {t('dialog.panic.show_snapshot')}
                        </Button>
                        <Button onClick={handleOpenGitHubIssue}>
                            {t('dialog.panic.open_github_issue')}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

interface CopyButtonProps {
    text: string;
    ariaLabel?: string;
}

function CopyButton({ text, ariaLabel }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        const ok = await copyTextToClipboard(text);
        if (ok) {
            setCopied(true);
            setTimeout(() => {
                setCopied(false);
            }, 1500);
        }
    };

    return (
        <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className={`h-7 w-7 shrink-0 rounded-full transition-opacity duration-200 ${
                copied
                    ? 'opacity-100'
                    : 'opacity-0 group-hover/row:opacity-100 focus:opacity-100'
            }`}
            aria-label={ariaLabel}
            onClick={handleCopy}
        >
            {copied ? (
                <CheckIcon className="animate-in fade-in zoom-in-50 h-3.5 w-3.5 duration-200" />
            ) : (
                <CopyIcon className="h-3.5 w-3.5" />
            )}
        </Button>
    );
}
