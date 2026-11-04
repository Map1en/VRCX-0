import { timeToText } from '@/lib/dateTime';
import {
    commands,
    type ScreenshotShareFacts,
    type ScreenshotShareFields,
    type ScreenshotShareRecord,
    type ScreenshotShareTarget
} from '@/platform/tauri/bindings';
import i18n from '@/services/i18nService';
import { toast } from '@/services/toastService';
import { useScreenshotShareStore } from '@/state/screenshotShareStore';
import { Progress } from '@/ui/shadcn/progress';

import { renderPrintCaptions } from './screenshotPrintService';
import {
    buildScreenshotShareMessages,
    type ScreenshotShareText
} from './screenshotShareMessages';

const PROGRESS_TOAST_ID = 'screenshot-share-progress';
const PROGRESS_TOAST_DELAY_MS = 400;
const PROGRESS_POLL_INTERVAL_MS = 150;

export function screenshotShareText(): ScreenshotShareText {
    return {
        playerCount: i18n.t('view.tools.screenshot_share.embed.player_count'),
        people: i18n.t('view.tools.screenshot_share.embed.people'),
        stay: i18n.t('view.tools.screenshot_share.embed.stay'),
        stayValue: (ms, ongoing) =>
            i18n.t(
                ongoing
                    ? 'view.tools.screenshot_share.embed.stay_ongoing'
                    : 'view.tools.screenshot_share.embed.stay_total',
                { duration: timeToText(ms) }
            ),
        morePeople: (count) =>
            i18n.t('view.tools.screenshot_share.embed.more_people', { count })
    };
}

export function screenshotShareErrorText(message: string): string {
    const code = message.split(': ').at(-1) ?? message;
    const status = /^http(\d+)$/.exec(code)?.[1];
    if (status) {
        return i18n.t('view.tools.screenshot_share.error.http', { status });
    }
    switch (code) {
        case 'invalid':
            return i18n.t('view.tools.screenshot_share.error.invalid');
        case 'tooLarge':
            return i18n.t('view.tools.screenshot_share.error.too_large');
        case 'rateLimited':
            return i18n.t('view.tools.screenshot_share.error.rate_limited');
        case 'network':
            return i18n.t('view.tools.screenshot_share.error.network');
        case 'file':
            return i18n.t('view.tools.screenshot_share.error.file');
        default:
            return message;
    }
}

function startProgressToast(target: ScreenshotShareTarget): () => void {
    let shown = false;
    let stopped = false;
    const render = (processed: number, total: number) => {
        if (stopped) {
            return;
        }
        shown = true;
        toast.add({
            id: PROGRESS_TOAST_ID,
            type: 'loading',
            title: i18n.t('view.tools.screenshot_share.progress', {
                target: target.name,
                done: processed,
                total
            }),
            description: (
                <Progress value={total ? (processed / total) * 100 : 0} />
            )
        });
    };
    const poll = globalThis.setInterval(() => {
        void commands.appGetScreenshotShareProgress().then((progress) => {
            if (shown && progress.running) {
                render(progress.processedFiles, progress.totalFiles);
            }
        });
    }, PROGRESS_POLL_INTERVAL_MS);
    const open = globalThis.setTimeout(() => {
        void commands.appGetScreenshotShareProgress().then((progress) => {
            render(progress.processedFiles, progress.totalFiles);
        });
    }, PROGRESS_TOAST_DELAY_MS);
    return () => {
        stopped = true;
        globalThis.clearInterval(poll);
        globalThis.clearTimeout(open);
        if (shown) {
            toast.close(PROGRESS_TOAST_ID);
        }
    };
}

async function undoShare(records: ScreenshotShareRecord[]): Promise<void> {
    try {
        for (const record of records) {
            await commands.appDeleteScreenshotShareRecord(record.id);
        }
        toast.add({
            type: 'success',
            title: i18n.t('view.tools.screenshot_share.undone')
        });
    } catch (error) {
        toast.add({
            type: 'error',
            title: i18n.t('view.tools.screenshot_share.undo_failed', {
                reason: errorText(error)
            })
        });
    }
}

function errorText(error: unknown): string {
    return screenshotShareErrorText(
        error instanceof Error ? error.message : String(error)
    );
}

async function sendToTargets(
    paths: string[],
    targets: ScreenshotShareTarget[],
    fields: ScreenshotShareFields | undefined
): Promise<void> {
    let facts: ScreenshotShareFacts[];
    try {
        facts = await commands.appGetScreenshotShareFacts(paths);
    } catch (error) {
        toast.add({ type: 'error', title: errorText(error) });
        return;
    }
    if (!facts.length) {
        return;
    }
    const sent: ScreenshotShareRecord[] = [];
    const sentTargets: string[] = [];
    let captions: Map<string, string> | null = null;
    for (const target of targets) {
        const targetFields = fields ?? target.fields;
        const stopProgress = startProgressToast(target);
        try {
            if (targetFields.print) {
                captions ??= await renderPrintCaptions(facts);
            }
            const printCaptions = targetFields.print ? captions : null;
            const messages = buildScreenshotShareMessages(
                facts,
                targetFields,
                screenshotShareText()
            ).map((message) => ({
                ...message,
                printCaptions: printCaptions
                    ? message.paths.map((path) => printCaptions.get(path) ?? '')
                    : []
            }));
            const result = await commands.appShareScreenshots(
                target.id,
                messages
            );
            sent.push(...result.records);
            if (result.targetInvalid) {
                useScreenshotShareStore.getState().markInvalid(target.id);
            }
            if (result.error) {
                toast.add({
                    type: 'error',
                    title: i18n.t('view.tools.screenshot_share.failed', {
                        target: target.name,
                        reason: screenshotShareErrorText(result.error)
                    })
                });
            } else {
                sentTargets.push(target.name);
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title: i18n.t('view.tools.screenshot_share.failed', {
                    target: target.name,
                    reason: errorText(error)
                })
            });
        } finally {
            stopProgress();
        }
    }
    if (sentTargets.length) {
        toast.add({
            type: 'success',
            title: i18n.t('view.tools.screenshot_share.sent', {
                count: facts.length,
                target: sentTargets.join(', ')
            }),
            actionProps: {
                children: i18n.t('view.tools.screenshot_share.undo'),
                onClick: () => void undoShare(sent)
            }
        });
    }
}

export async function shareScreenshots({
    paths,
    targets,
    fields
}: {
    paths: string[];
    targets: ScreenshotShareTarget[];
    fields?: ScreenshotShareFields;
}): Promise<void> {
    const store = useScreenshotShareStore.getState();
    if (!paths.length || !targets.length || store.sending) {
        return;
    }
    store.setSending(true);
    try {
        await sendToTargets(paths, targets, fields);
    } finally {
        useScreenshotShareStore.getState().setSending(false);
    }
}
