import { useEffect } from 'react';

import { cn } from '@/lib/utils.js';
import {
    buildEmojiKeyframes,
    getEmojiAnimationName,
    getEmojiFrameLayout
} from '@/shared/utils/gallery.js';

function ensureEmojiKeyframes(frameCount) {
    if (typeof document === 'undefined') {
        return;
    }
    const animationName = getEmojiAnimationName(frameCount);
    const styleId = `vrcx-${animationName}`;
    if (document.getElementById(styleId)) {
        return;
    }
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `@keyframes ${animationName}{${buildEmojiKeyframes(frameCount)}}`;
    document.head.appendChild(style);
}

export function GalleryEmojiImage({ file, imageUrl, alt, className }) {
    const frameCount = Number(file?.frames);
    const isAnimated =
        imageUrl && Number.isFinite(frameCount) && frameCount > 1;

    useEffect(() => {
        if (isAnimated) {
            ensureEmojiKeyframes(frameCount);
        }
    }, [frameCount, isAnimated]);

    if (!isAnimated) {
        return (
            <img
                src={imageUrl}
                alt={alt}
                loading="lazy"
                className={cn(className, 'object-cover')}
            />
        );
    }

    const { frameCount: normalizedFrameCount, framesPerLine } =
        getEmojiFrameLayout(frameCount);
    const fps = Math.min(64, Math.max(1, Number(file?.framesOverTime) || 15));
    const durationMs = (1000 / fps) * normalizedFrameCount;
    const animationName = getEmojiAnimationName(normalizedFrameCount);
    const animationDirection =
        file?.loopStyle === 'pingpong' ? 'alternate' : 'normal';

    return (
        <div
            className={cn('bg-muted relative overflow-hidden', className)}
            role="img"
            aria-label={alt}
        >
            <div
                className="absolute inset-0 bg-no-repeat"
                style={{
                    animation: `${durationMs}ms steps(1) 0s infinite ${animationDirection} running ${animationName}`,
                    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
                    backgroundSize: `${framesPerLine * 100}% ${framesPerLine * 100}%`
                }}
            />
        </div>
    );
}
