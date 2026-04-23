import {
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger
} from '@/ui/shadcn/context-menu';

const VISIBILITY_MENU_ITEMS = [
    ['vrchat', 'VRChat'],
    ['steamvr', 'SteamVR'],
    ['proxy', 'Proxy'],
    ['ws', 'Realtime'],
    ['nowPlaying', 'Now Playing'],
    ['servers', 'Servers']
];

export function StatusBarContextMenuContent({
    clockCount,
    onSetClockCountValue,
    onToggleVisibility,
    t,
    visibility
}) {
    return (
        <ContextMenuContent>
            {VISIBILITY_MENU_ITEMS.map(([key, label]) => (
                <ContextMenuCheckboxItem
                    key={key}
                    checked={Boolean(visibility[key])}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) =>
                        onToggleVisibility(key, checked)
                    }
                >
                    {label}
                </ContextMenuCheckboxItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuSub>
                <ContextMenuSubTrigger>
                    {t('app_menu.generated.clocks')}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                    {[0, 1, 2, 3].map((count) => (
                        <ContextMenuCheckboxItem
                            key={count}
                            checked={clockCount === count}
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={(checked) => {
                                if (checked) {
                                    onSetClockCountValue(count);
                                }
                            }}
                        >
                            {count === 0
                                ? 'No clocks'
                                : `${count} clock${count === 1 ? '' : 's'}`}
                        </ContextMenuCheckboxItem>
                    ))}
                </ContextMenuSubContent>
            </ContextMenuSub>
        </ContextMenuContent>
    );
}
