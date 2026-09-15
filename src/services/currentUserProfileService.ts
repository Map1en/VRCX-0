import userProfileRepository from '@/repositories/userProfileRepository';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import { recordUserProfile } from './userFactAccessService';

type UpdateCurrentUserInput = Parameters<
    typeof userProfileRepository.updateCurrentUser
>[0];
type CurrentUserTagsInput = Parameters<
    typeof userProfileRepository.addCurrentUserTags
>[0];
type CurrentUserProfile = Awaited<
    ReturnType<typeof userProfileRepository.updateCurrentUser>
>;

function recordCurrentUserProfile(profile: CurrentUserProfile): void {
    recordUserProfile(profile, {
        endpoint: DEFAULT_VRCHAT_API_ENDPOINT,
        source: 'currentUser',
        isCurrentUser: true
    });
}

async function updateCurrentUser(
    input: UpdateCurrentUserInput
): Promise<CurrentUserProfile> {
    const profile = await userProfileRepository.updateCurrentUser(input);
    recordCurrentUserProfile(profile);
    return profile;
}

async function addCurrentUserTags(
    input: CurrentUserTagsInput
): Promise<CurrentUserProfile> {
    const profile = await userProfileRepository.addCurrentUserTags(input);
    recordCurrentUserProfile(profile);
    return profile;
}

async function removeCurrentUserTags(
    input: CurrentUserTagsInput
): Promise<CurrentUserProfile> {
    const profile = await userProfileRepository.removeCurrentUserTags(input);
    recordCurrentUserProfile(profile);
    return profile;
}

const currentUserProfileService = Object.freeze({
    updateCurrentUser,
    addCurrentUserTags,
    removeCurrentUserTags
});

export default currentUserProfileService;
