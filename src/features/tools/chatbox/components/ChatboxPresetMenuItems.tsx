import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import {
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator
} from '@/ui/shadcn/dropdown-menu';

import { CHATBOX_PRESET_GROUPS, type ChatboxPreset } from '../chatboxPresets';

export function ChatboxPresetMenuItems({
    samples,
    onPick
}: {
    samples: Record<string, string>;
    onPick(preset: ChatboxPreset): void;
}) {
    const { t } = useTranslation();

    return CHATBOX_PRESET_GROUPS.map((group, index) => (
        <Fragment key={group.id}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>
                <DropdownMenuLabel>
                    {t(`view.tools.chatbox.preset_groups.${group.id}`)}
                </DropdownMenuLabel>
                {group.presets.map((preset) => (
                    <DropdownMenuItem
                        key={preset.id}
                        onClick={() => onPick(preset)}
                    >
                        <span className="text-sm leading-snug whitespace-pre-line">
                            {samples[preset.id] || preset.template(t)}
                        </span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuGroup>
        </Fragment>
    ));
}
