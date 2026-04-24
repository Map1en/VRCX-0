import { GalleryPageView } from './components/GalleryPageView.jsx';
import { useGalleryPageController } from './useGalleryPageController.js';

export function GalleryPage() {
    const viewProps = useGalleryPageController();

    return <GalleryPageView {...viewProps} />;
}
