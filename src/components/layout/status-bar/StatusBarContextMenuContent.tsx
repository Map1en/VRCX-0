import { useTranslation } from 'react-i18next';

import {
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuRadioGroup,
    ContextMenuRadioItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger
} from '@/ui/shadcn/context-menu';

import type {
    StatusBarVisibility,
    StatusBarVisibilityKey
} from './statusBarTypes';

type StatusBarContextMenuContentProps = {
    clockCount: number;
    onSetClockCountValue: (nextValue: number) => unknown;
    onOpenProxySettings: () => unknown;
    onToggleVisibility: (
        key: StatusBarVisibilityKey,
        checked: boolean
    ) => unknown;
    visibility: StatusBarVisibility;
};

const VISIBILITY_MENU_ITEMS: Array<readonly [StatusBarVisibilityKey, string]> =
    [
        ['vrchat', 'status_bar.game'],
        ['servers', 'status_bar.servers'],
        ['steamvr', 'status_bar.steamvr'],
        ['instanceQueue', 'status_bar.instance_queue'],
        ['mutualGraph', 'status_bar.mutual_graph'],
        ['ws', 'status_bar.realtime_connection'],
        ['uptime', 'status_bar.app_uptime_short'],
        ['zoom', 'status_bar.zoom'],
        ['nowPlaying', 'status_bar.now_playing']
    ];

export function StatusBarContextMenuContent({
    clockCount,
    onOpenProxySettings,
    onSetClockCountValue,
    onToggleVisibility,
    visibility
}: StatusBarContextMenuContentProps) {
    const { t } = useTranslation();

    return (
        <ContextMenuContent className="w-52">
            <ContextMenuItem onClick={onOpenProxySettings}>
                {t('status_bar.modify_proxy_address')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuGroup>
                {VISIBILITY_MENU_ITEMS.map(([key, label]) => (
                    <ContextMenuCheckboxItem
                        key={key}
                        checked={Boolean(visibility[key])}
                        onClick={(event) => event.preventDefault()}
                        onCheckedChange={(checked) =>
                            onToggleVisibility(key, checked)
                        }
                    >
                        {t(label)}
                    </ContextMenuCheckboxItem>
                ))}
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuSub>
                <ContextMenuSubTrigger>
                    {t('status_bar.clocks')}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-36">
                    <ContextMenuRadioGroup
                        value={String(clockCount)}
                        onValueChange={(value) =>
                            onSetClockCountValue(Number(value))
                        }
                    >
                        {[0, 1, 2, 3].map((count) => (
                            <ContextMenuRadioItem
                                key={count}
                                value={String(count)}
                            >
                                {count === 0
                                    ? t('status_bar.clocks_none')
                                    : `${count} ${t(count === 1 ? 'status_bar.clock' : 'status_bar.clocks_label')}`}
                            </ContextMenuRadioItem>
                        ))}
                    </ContextMenuRadioGroup>
                </ContextMenuSubContent>
            </ContextMenuSub>
        </ContextMenuContent>
    );
}
