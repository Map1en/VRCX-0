import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type ChatboxFormats,
    type ChatboxLinePreviewInput
} from '@/platform/tauri/bindings';

import { CHATBOX_PRESETS } from './chatboxPresets';

export function usePresetSamples(
    defaultFormats: ChatboxFormats
): Record<string, string> {
    const { t } = useTranslation();
    const [samples, setSamples] = useState<Record<string, string>>({});
    const inputs = useMemo<ChatboxLinePreviewInput[]>(
        () =>
            CHATBOX_PRESETS.map((preset) => ({
                template: preset.template(t),
                formats: { ...defaultFormats, ...preset.formats }
            })),
        [defaultFormats, t]
    );

    useEffect(() => {
        let active = true;
        void commands.appChatboxSamplesRender(inputs).then((rendered) => {
            if (active) {
                setSamples(
                    Object.fromEntries(
                        CHATBOX_PRESETS.map((preset, index) => [
                            preset.id,
                            rendered[index] ?? ''
                        ])
                    )
                );
            }
        });
        return () => {
            active = false;
        };
    }, [inputs]);

    return samples;
}
