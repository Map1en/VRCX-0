import { useQuery } from '@tanstack/react-query';

import externalApiRepository from '@/repositories/externalApiRepository';
import { links } from '@/shared/constants/link';
import { HOUR_MS } from '@/shared/constants/time';

export type AboutContributor = {
    login: string;
    avatarUrl: string;
    profileUrl: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function isBotContributor(entry: Record<string, unknown>): boolean {
    return entry.type === 'Bot' || String(entry.login || '').endsWith('[bot]');
}

export function parseContributors(data: string): AboutContributor[] {
    const parsed: unknown = JSON.parse(data);
    if (!Array.isArray(parsed)) {
        throw new Error('GitHub contributors payload is not a list.');
    }
    return parsed
        .filter(isRecord)
        .filter((entry) => !isBotContributor(entry))
        .map((entry) => ({
            login: String(entry.login || ''),
            avatarUrl: String(entry.avatar_url || ''),
            profileUrl: String(entry.html_url || '')
        }))
        .filter((entry) => entry.login);
}

export function useAboutContributors(enabled: boolean) {
    return useQuery({
        queryKey: ['about-contributors'],
        queryFn: async () => {
            const response =
                await externalApiRepository.fetchGithubContributors({
                    url: links.contributorsApi,
                    headers: { Accept: 'application/vnd.github+json' }
                });
            if (response.status !== 200) {
                throw new Error(
                    `GitHub contributors request failed (${response.status}).`
                );
            }
            return parseContributors(response.data);
        },
        enabled,
        staleTime: 6 * HOUR_MS,
        retry: 1,
        refetchOnWindowFocus: false
    });
}
