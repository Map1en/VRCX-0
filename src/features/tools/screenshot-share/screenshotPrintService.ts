import { commands, type ScreenshotShareFacts } from '@/platform/tauri/bindings';
import i18n from '@/services/i18nService';
import { openFolderAndSelectItem } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import {
    useScreenshotPrintOptionsStore,
    type ScreenshotPrintOptions
} from '@/state/screenshotPrintOptionsStore';

import {
    renderScreenshotPrintCaption,
    type PrintContent
} from './screenshotPrintCaption';

const EMPTY_CONTENT: PrintContent = { note: '', people: null };

function failed(error: unknown): void {
    toast.add({
        type: 'error',
        title: i18n.t('view.tools.screenshot_print.failed', {
            reason: error instanceof Error ? error.message : String(error)
        })
    });
}

async function resolveOptions(
    options: ScreenshotPrintOptions | undefined
): Promise<ScreenshotPrintOptions> {
    return options ?? (await useScreenshotPrintOptionsStore.getState().load());
}

export async function renderPrintCaptions(
    facts: ScreenshotShareFacts[],
    options?: ScreenshotPrintOptions,
    content: PrintContent = EMPTY_CONTENT
): Promise<Map<string, string>> {
    const resolved = await resolveOptions(options);
    const captions = new Map<string, string>();
    for (const fact of facts) {
        captions.set(
            fact.path,
            await renderScreenshotPrintCaption(fact, resolved, content)
        );
    }
    return captions;
}

export async function copyScreenshotPrint(
    path: string,
    options?: ScreenshotPrintOptions,
    content: PrintContent = EMPTY_CONTENT
): Promise<void> {
    try {
        const [fact] = await commands.appGetScreenshotShareFacts([path]);
        if (!fact) {
            return;
        }
        await commands.appCopyScreenshotPrint({
            path,
            caption: await renderScreenshotPrintCaption(
                fact,
                await resolveOptions(options),
                content
            )
        });
        toast.add({
            type: 'success',
            title: i18n.t('view.tools.screenshot_print.copied')
        });
    } catch (error) {
        failed(error);
    }
}

export async function saveScreenshotPrints(
    paths: string[],
    options?: ScreenshotPrintOptions,
    content: PrintContent = EMPTY_CONTENT
): Promise<void> {
    try {
        const facts = await commands.appGetScreenshotShareFacts(paths);
        const captions = await renderPrintCaptions(facts, options, content);
        const saved = await commands.appSaveScreenshotPrints(
            facts.map((fact) => ({
                path: fact.path,
                caption: captions.get(fact.path) ?? ''
            }))
        );
        const [first] = saved;
        if (first) {
            toast.add({
                type: 'success',
                title: i18n.t('view.tools.screenshot_print.saved', {
                    count: saved.length
                }),
                actionProps: {
                    children: i18n.t('dialog.screenshot_metadata.open_folder'),
                    onClick: () => {
                        openFolderAndSelectItem(first, false).catch(failed);
                    }
                }
            });
        }
    } catch (error) {
        failed(error);
    }
}
