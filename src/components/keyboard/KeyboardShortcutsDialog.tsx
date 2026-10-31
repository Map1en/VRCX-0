import { useTranslation } from 'react-i18next';

import { KeyboardShortcut } from '@/components/keyboard/KeyboardShortcut';
import { trayShortcutKeys } from '@/components/keyboard/trayShortcutKeys';
import { SHORTCUT_GROUPS } from '@/shared/keyboard/shortcutRegistry';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useTrayShortcutStore } from '@/state/trayShortcutStore';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle
} from '@/ui/shadcn/sheet';

export function KeyboardShortcutsDialog({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange(open: boolean): void;
}) {
    const { t } = useTranslation();
    const platform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const isMacHost = platform === 'macos';
    const modifier = isMacHost ? 'Meta' : 'Mod';
    const trayShortcut = useTrayShortcutStore((state) => state.snapshot);

    return (
        <Sheet open={open} onOpenChange={onOpenChange} modal="trap-focus">
            <SheetContent
                side="right"
                variant="inset"
                closeProps={{ 'aria-label': t('common.actions.close') }}
            >
                <SheetHeader className="shrink-0 px-5 py-5 pr-12">
                    <SheetTitle>{t('shortcuts.title')}</SheetTitle>
                </SheetHeader>
                <ScrollArea className="min-h-0 flex-1" overscrollContain>
                    <div className="flex flex-col gap-6 px-5 pt-2 pb-6">
                        {platform === 'windows' ? (
                            <section>
                                <h3 className="text-muted-foreground mb-2 text-xs font-medium uppercase">
                                    {t('shortcuts.tray.global')}
                                </h3>
                                <ul>
                                    <li className="flex min-h-8 items-center justify-between gap-4 py-1.5 text-sm">
                                        <span className="min-w-0 font-medium break-words">
                                            {t('shortcuts.tray.title')}
                                        </span>
                                        {trayShortcut?.binding ? (
                                            <div className="flex shrink-0 flex-col items-end gap-1">
                                                <KeyboardShortcut
                                                    keys={trayShortcutKeys(
                                                        trayShortcut.binding
                                                    )}
                                                />
                                                {trayShortcut.status !==
                                                'active' ? (
                                                    <span className="text-muted-foreground text-xs">
                                                        {t(
                                                            'shortcuts.tray.inactive'
                                                        )}
                                                    </span>
                                                ) : null}
                                            </div>
                                        ) : (
                                            <span className="text-muted-foreground shrink-0 text-xs">
                                                {t(
                                                    trayShortcut
                                                        ? 'shortcuts.tray.unset'
                                                        : 'common.loading'
                                                )}
                                            </span>
                                        )}
                                    </li>
                                </ul>
                            </section>
                        ) : null}
                        {SHORTCUT_GROUPS.map((group) => (
                            <section key={group.titleKey}>
                                <h3 className="text-muted-foreground mb-2 text-xs font-medium uppercase">
                                    {t(group.titleKey)}
                                </h3>
                                <ul>
                                    {group.items.map((item) => (
                                        <li
                                            key={item.labelKey}
                                            className="flex min-h-8 items-center justify-between gap-4 py-1.5 text-sm"
                                        >
                                            <span className="min-w-0 font-medium break-words">
                                                {t(item.labelKey)}
                                            </span>
                                            <KeyboardShortcut
                                                keys={item.keys.map((key) =>
                                                    key === 'Mod'
                                                        ? modifier
                                                        : key
                                                )}
                                            />
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
}
