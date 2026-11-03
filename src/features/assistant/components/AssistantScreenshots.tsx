import { ImagesIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { ScreenshotThumbnailCard } from '@/components/media/ScreenshotThumbnailCard';
import type {
    AssistantScreenshots as AssistantScreenshotsData,
    UIToolCall
} from '@/domain/assistant/types';
import {
    commands,
    type ScreenshotLibraryImage
} from '@/platform/tauri/bindings';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { Button } from '@/ui/shadcn/button';

import { useNearViewport } from '../useNearViewport';

const SCREENSHOT_PAGE = '/tools/screenshot-metadata';

function ScreenshotStrip({ strip }: { strip: AssistantScreenshotsData }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [element, setElement] = useState<HTMLDivElement | null>(null);
    const near = useNearViewport(element);
    const [images, setImages] = useState<ScreenshotLibraryImage[]>([]);
    const idsKey = strip.ids.join('\n');

    useEffect(() => {
        if (!near) {
            return;
        }
        let active = true;
        commands
            .appGetScreenshotsByFileNames(idsKey.split('\n'))
            .then((found) => {
                if (active) {
                    setImages(found);
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [idsKey, near]);

    const open = (search: URLSearchParams) => {
        useAssistantChatStore.getState().setOpen(false);
        navigate(`${SCREENSHOT_PAGE}?${search.toString()}`);
    };

    return (
        <div ref={setElement} className="flex w-full flex-col gap-1.5">
            <div className="grid min-h-16 grid-cols-3 gap-1.5 sm:grid-cols-5">
                {near
                    ? images.map((image) => (
                          <ScreenshotThumbnailCard
                              key={image.path}
                              compact
                              item={image}
                              onOpen={(path) =>
                                  open(new URLSearchParams({ path }))
                              }
                          />
                      ))
                    : null}
            </div>
            <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground w-fit"
                onClick={() =>
                    open(
                        new URLSearchParams({
                            filter: JSON.stringify(strip.filter)
                        })
                    )
                }
            >
                <ImagesIcon data-icon="inline-start" />
                {t('assistant.screenshots.view_all', { count: strip.total })}
            </Button>
        </div>
    );
}

export function AssistantScreenshots({
    toolCalls
}: {
    toolCalls: readonly UIToolCall[];
}) {
    const strip = useMemo(
        () => toolCalls.findLast((call) => call.screenshots)?.screenshots,
        [toolCalls]
    );
    return strip ? <ScreenshotStrip strip={strip} /> : null;
}
