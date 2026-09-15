import mediaFileRepository from './mediaFileRepository';
import vrchatMediaRepository from './vrchatMediaRepository';

export type {
    InventoryItemRecord,
    MediaFileRecord,
    MediaPrintRecord
} from './vrchatMediaRepository';

type MediaRepository = typeof vrchatMediaRepository &
    typeof mediaFileRepository;

const mediaRepository: MediaRepository = Object.freeze({
    ...vrchatMediaRepository,
    ...mediaFileRepository
});

export default mediaRepository;
