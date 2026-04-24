/**
 *
 * @param {object} print
 * @returns
 */
function getPrintFileName(print) {
    const authorName = print.authorName;
    // fileDate format: 2024-11-03_16-14-25.757
    const createdAt = getPrintLocalDate(print);
    const fileNameDate = createdAt
        .toISOString()
        .replace(/:/g, '-')
        .replace(/T/g, '_')
        .replace(/Z/g, '');
    const fileName = `${authorName}_${fileNameDate}_${print.id}.png`;
    return fileName;
}

/**
 *
 * @param {object} print
 * @returns
 */
function getPrintLocalDate(print) {
    if (print.createdAt) {
        const createdAt = new Date(print.createdAt);
        // cursed convert to local time
        createdAt.setMinutes(
            createdAt.getMinutes() - createdAt.getTimezoneOffset()
        );
        return createdAt;
    }
    if (print.timestamp) {
        return new Date(print.timestamp);
    }

    const createdAt = new Date();
    // cursed convert to local time
    createdAt.setMinutes(
        createdAt.getMinutes() - createdAt.getTimezoneOffset()
    );
    return createdAt;
}

/**
 * @param {object} emoji
 */
function getEmojiFileName(emoji) {
    if (emoji.frames) {
        const loopStyle = emoji.loopStyle || 'linear';
        return `${emoji.name}_${emoji.animationStyle}animationStyle_${emoji.frames}frames_${emoji.framesOverTime}fps_${loopStyle}loopStyle.png`;
    } else {
        return `${emoji.name}_${emoji.animationStyle}animationStyle.png`;
    }
}

/**
 * @param {number} frameCount
 */
function getEmojiFrameLayout(frameCount) {
    const numericFrameCount = Number(frameCount);
    const normalizedFrameCount = Math.min(
        64,
        Math.max(
            1,
            Number.isFinite(numericFrameCount)
                ? Math.trunc(numericFrameCount)
                : 1
        )
    );
    let framesPerLine = 2;
    if (normalizedFrameCount > 4) framesPerLine = 4;
    if (normalizedFrameCount > 16) framesPerLine = 8;
    const frameSize = 1024 / framesPerLine;
    return {
        frameCount: normalizedFrameCount,
        framesPerLine,
        frameSize
    };
}

/**
 * @param {number} frameCount
 */
function getEmojiAnimationName(frameCount) {
    return `animated-emoji-${getEmojiFrameLayout(frameCount).frameCount}`;
}

/**
 * @param {number} frameCount
 */
function buildEmojiKeyframes(frameCount) {
    const { frameCount: normalizedFrameCount, framesPerLine } =
        getEmojiFrameLayout(frameCount);
    const maxFrameIndex = framesPerLine - 1;
    const rules = [];
    for (let index = 0; index < normalizedFrameCount; index += 1) {
        const percent = (index / normalizedFrameCount) * 100;
        const column = index % framesPerLine;
        const row = Math.floor(index / framesPerLine);
        const x = maxFrameIndex > 0 ? (column / maxFrameIndex) * 100 : 0;
        const y = maxFrameIndex > 0 ? (row / maxFrameIndex) * 100 : 0;
        rules.push(`${percent}%{background-position:${x}% ${y}%;}`);
    }
    return rules.join('');
}

export {
    getPrintLocalDate,
    getPrintFileName,
    getEmojiFileName,
    getEmojiFrameLayout,
    getEmojiAnimationName,
    buildEmojiKeyframes
};
