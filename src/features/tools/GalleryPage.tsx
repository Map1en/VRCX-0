// @ts-nocheck
import { GalleryPageView } from './components/GalleryPageView';
import { useGalleryPageController } from './useGalleryPageController.js';

export function GalleryPage() {
    const viewProps = useGalleryPageController();

    return <GalleryPageView {...viewProps} />;
}
