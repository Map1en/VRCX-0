import {
    createImposter,
    deleteAvatar,
    deleteImposter,
    saveAvatar,
    selectAvatar,
    selectFallbackAvatar
} from './avatar-profile/actions';
import {
    clearAvatarNameCache,
    getAvatarGallery,
    getAvatarNameCacheSize,
    getAvatarNameFromImageUrl
} from './avatar-profile/gallery';
import {
    deleteAvatarModeration,
    getAvatarModerations,
    sendAvatarModeration
} from './avatar-profile/moderation';
import { normalize } from './avatar-profile/normalization';
import {
    getAllAvatarsByUser,
    getAvatarProfile,
    getAvatarStyles,
    getAvatarsByUser,
    getLocalSnapshot
} from './avatar-profile/profile';

const avatarProfileRepository = Object.freeze({
    normalize,
    clearAvatarNameCache,
    getAvatarNameCacheSize,
    getLocalSnapshot,
    getAvatarProfile,
    getAvatarGallery,
    getAvatarsByUser,
    getAllAvatarsByUser,
    selectAvatar,
    selectFallbackAvatar,
    saveAvatar,
    getAvatarStyles,
    deleteAvatar,
    createImposter,
    deleteImposter,
    getAvatarModerations,
    sendAvatarModeration,
    deleteAvatarModeration,
    getAvatarNameFromImageUrl
});

export {
    normalize,
    clearAvatarNameCache,
    getAvatarNameCacheSize,
    getLocalSnapshot,
    getAvatarProfile,
    getAvatarGallery,
    getAvatarsByUser,
    getAllAvatarsByUser,
    selectAvatar,
    selectFallbackAvatar,
    saveAvatar,
    getAvatarStyles,
    deleteAvatar,
    createImposter,
    deleteImposter,
    getAvatarModerations,
    sendAvatarModeration,
    deleteAvatarModeration,
    getAvatarNameFromImageUrl
};
export type {
    AvatarGalleryFile,
    AvatarModerationRecord,
    AvatarStyleRecord
} from './avatar-profile/types';
export type {
    AvatarProfileRecord,
    AvatarStyleSelection
} from '@/domain/entities/profileEntities';
export default avatarProfileRepository;
