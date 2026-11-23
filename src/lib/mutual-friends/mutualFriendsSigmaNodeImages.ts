const MIN_IMAGE_RADIUS = 5;

export interface NodeImageLoader {
    get(url: string): HTMLImageElement | null;
    dispose(): void;
}

export function createNodeImageLoader(onLoad: () => void): NodeImageLoader {
    const images = new Map<string, HTMLImageElement | null>();
    let disposed = false;
    let frame = 0;
    const scheduleLoad = () => {
        if (!disposed && !frame) {
            frame = requestAnimationFrame(() => {
                frame = 0;
                onLoad();
            });
        }
    };
    return {
        get(url) {
            if (!images.has(url)) {
                images.set(url, null);
                const image = new Image();
                image.src = url;
                image.decode().then(
                    () => {
                        if (!disposed) {
                            images.set(url, image);
                            scheduleLoad();
                        }
                    },
                    () => {}
                );
            }
            return images.get(url) ?? null;
        },
        dispose() {
            disposed = true;
            cancelAnimationFrame(frame);
            frame = 0;
            images.clear();
        }
    };
}

export function drawMutualFriendNodeImage(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    node: { x: number; y: number; radius: number },
    alpha: number,
    backgroundColor: string
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
    ctx.fillStyle = backgroundColor;
    ctx.fill();
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
