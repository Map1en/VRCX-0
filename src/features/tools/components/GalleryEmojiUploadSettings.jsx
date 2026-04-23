import { ExternalLinkIcon } from 'lucide-react';

import { emojiAnimationStyleList } from '@/shared/constants/emoji.js';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

export function GalleryEmojiUploadSettings({
    t,
    emojiAnimType,
    emojiAnimationStyle,
    emojiAnimFps,
    emojiAnimFrameCount,
    emojiAnimLoopPingPong,
    onEmojiAnimTypeChange,
    onEmojiAnimationStyleChange,
    onEmojiAnimFpsChange,
    onEmojiAnimFrameCountChange,
    onEmojiAnimLoopPingPongChange,
    onCreateAnimatedEmoji
}) {
    return (
        <FieldGroup className="bg-muted/20 flex-row flex-wrap items-end gap-3 rounded-lg border p-3">
            <Field className="min-w-56">
                <FieldLabel>
                    {t('dialog.gallery_icons.emoji_animation_styles')}
                </FieldLabel>
                <Select
                    value={emojiAnimationStyle}
                    onValueChange={onEmojiAnimationStyleChange}
                >
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {Object.keys(emojiAnimationStyleList).map(
                                (styleName) => (
                                    <SelectItem
                                        key={styleName}
                                        value={styleName}
                                    >
                                        {styleName}
                                    </SelectItem>
                                )
                            )}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>
            <Field orientation="horizontal" className="h-9 w-auto">
                <Checkbox
                    id="gallery-emoji-animation-type"
                    checked={emojiAnimType}
                    onCheckedChange={(value) =>
                        onEmojiAnimTypeChange(Boolean(value))
                    }
                />
                <FieldLabel htmlFor="gallery-emoji-animation-type">
                    {t('dialog.gallery_icons.emoji_animation_type')}
                </FieldLabel>
            </Field>
            {emojiAnimType ? (
                <>
                    <Field className="w-28">
                        <FieldLabel htmlFor="gallery-emoji-animation-fps">
                            {t('dialog.gallery_icons.emoji_animation_fps')}
                        </FieldLabel>
                        <Input
                            id="gallery-emoji-animation-fps"
                            type="number"
                            min={1}
                            max={64}
                            value={emojiAnimFps}
                            onChange={(event) =>
                                onEmojiAnimFpsChange(event.target.value)
                            }
                        />
                    </Field>
                    <Field className="w-28">
                        <FieldLabel htmlFor="gallery-emoji-animation-frame-count">
                            {t(
                                'dialog.gallery_icons.emoji_animation_frame_count'
                            )}
                        </FieldLabel>
                        <Input
                            id="gallery-emoji-animation-frame-count"
                            type="number"
                            min={2}
                            max={64}
                            value={emojiAnimFrameCount}
                            onChange={(event) =>
                                onEmojiAnimFrameCountChange(event.target.value)
                            }
                        />
                    </Field>
                    <Field orientation="horizontal" className="h-9 w-auto">
                        <Checkbox
                            id="gallery-emoji-loop-pingpong"
                            checked={emojiAnimLoopPingPong}
                            onCheckedChange={(value) =>
                                onEmojiAnimLoopPingPongChange(Boolean(value))
                            }
                        />
                        <FieldLabel htmlFor="gallery-emoji-loop-pingpong">
                            {t('dialog.gallery_icons.emoji_loop_pingpong')}
                        </FieldLabel>
                    </Field>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onCreateAnimatedEmoji}
                    >
                        <ExternalLinkIcon data-icon="inline-start" />
                        {t('dialog.gallery_icons.create_animated_emoji')}
                    </Button>
                </>
            ) : null}
        </FieldGroup>
    );
}
