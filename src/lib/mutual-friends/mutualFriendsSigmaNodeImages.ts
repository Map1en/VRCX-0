const MIN_IMAGE_RADIUS = 5;

export interface NodeImageLoader {
    get(url: string): HTMLImageElement | null;
    dispose(): void;
}

export function createNodeImageLoader(onLoad: () => void): NodeImageLoader {
    const images = new Map<string, HTMLImageElement>();
    let disposed = false;
    return {
        get(url) {
            let image = images.get(url);
            if (!image) {
                image = new Image();
                image.decoding = 'async';
                image.onload = () => {
                    if (!disposed) {
                        onLoad();
                    }
                };
                image.src = url;
                images.set(url, image);
            }
            return image.complete && image.naturalWidth > 0 ? image : null;
        },
        dispose() {
            disposed = true;
            for (const image of images.values()) {
                image.onload = null;
            }
            images.clear();
        }
    };
}

export function drawMutualFriendNodeImage(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    node: { x: number; y: number; radius: number },
    alpha: number
) {
    const { radius } = node;
    if (radius < MIN_IMAGE_RADIUS || alpha <= 0) {
        return;
    }
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
        image,
        (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2,
        side,
        side,
        node.x - radius,
        node.y - radius,
        radius * 2,
        radius * 2
    );
    ctx.restore();
}
