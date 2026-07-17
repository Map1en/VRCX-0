import { describe, expect, it } from 'vitest';

import {
    buildFavoriteAvatarHistoryItems,
    buildFavoriteLocalItemsByGroup,
    buildFavoriteRemoteItemsByGroup
} from './favoritesPageData';

function buildWorldItems({
    cachedWorldDetail,
    remoteWorldCacheFallbackDetail,
    remoteWorldDetail,
    worldFactDetail
}: {
    cachedWorldDetail?: Record<string, unknown>;
    remoteWorldCacheFallbackDetail?: Record<string, unknown>;
    remoteWorldDetail?: Record<string, unknown>;
    worldFactDetail?: Record<string, unknown>;
}) {
    return buildFavoriteRemoteItemsByGroup({
        kind: 'world',
        remoteGroups: [
            {
                key: 'world:group_0',
                label: 'Worlds'
            }
        ],
        groupedFavoriteFriendIdsByGroupKey: {},
        friendsById: {},
        favoritesSortIndex: {},
        sortValue: 'date',
        remoteFavoritesById: {
            fvrt_world_1: {
                id: 'fvrt_world_1',
                type: 'world',
                favoriteId: 'wrld_favorite',
                $groupKey: 'world:group_0'
            }
        },
        remoteEntityDetailsData: remoteWorldDetail
            ? {
                  wrld_favorite: {
                      id: 'wrld_favorite',
                      ...remoteWorldDetail
                  }
              }
            : {},
        remoteEntityDetailsStatus: 'ready',
        worldFactsById: worldFactDetail
            ? {
                  wrld_favorite: {
                      id: 'wrld_favorite',
                      ...worldFactDetail
                  }
              }
            : {},
        remoteWorldCacheFallbacksById: remoteWorldCacheFallbackDetail
            ? {
                  wrld_favorite: {
                      id: 'wrld_favorite',
                      ...remoteWorldCacheFallbackDetail
                  }
              }
            : {},
        localWorldDetailsById: cachedWorldDetail
            ? {
                  wrld_favorite: {
                      id: 'wrld_favorite',
                      ...cachedWorldDetail
                  }
              }
            : {},
        remoteGroupLabelByKey: {
            'world:group_0': 'Worlds'
        },
        t: (key: string) => key
    })['world:group_0'];
}

function buildAvatarItems({
    cachedAvatarDetail,
    remoteAvatarCacheFallbackDetail,
    remoteAvatarDetail
}: {
    cachedAvatarDetail?: Record<string, unknown>;
    remoteAvatarCacheFallbackDetail?: Record<string, unknown>;
    remoteAvatarDetail?: Record<string, unknown>;
}) {
    return buildFavoriteRemoteItemsByGroup({
        kind: 'avatar',
        remoteGroups: [
            {
                key: 'avatar:group_0',
                label: 'Avatars'
            }
        ],
        groupedFavoriteFriendIdsByGroupKey: {},
        friendsById: {},
        favoritesSortIndex: {},
        sortValue: 'date',
        remoteFavoritesById: {
            fvrt_avatar_1: {
                id: 'fvrt_avatar_1',
                type: 'avatar',
                favoriteId: 'avtr_favorite',
                $groupKey: 'avatar:group_0'
            }
        },
        remoteEntityDetailsData: remoteAvatarDetail
            ? {
                  avtr_favorite: {
                      id: 'avtr_favorite',
                      ...remoteAvatarDetail
                  }
              }
            : {},
        remoteEntityDetailsStatus: 'ready',
        remoteAvatarCacheFallbacksById: remoteAvatarCacheFallbackDetail
            ? {
                  avtr_favorite: {
                      id: 'avtr_favorite',
                      ...remoteAvatarCacheFallbackDetail
                  }
              }
            : {},
        localAvatarDetailsById: cachedAvatarDetail
            ? {
                  avtr_favorite: {
                      id: 'avtr_favorite',
                      ...cachedAvatarDetail
                  }
              }
            : {},
        remoteGroupLabelByKey: {
            'avatar:group_0': 'Avatars'
        },
        t: (key: string) => key
    })['avatar:group_0'];
}

describe('favorites page data helpers', () => {
    it('uses DB fallback private world details when remote details are missing', () => {
        const items = buildWorldItems({
            remoteWorldCacheFallbackDetail: {
                name: 'DB Private World',
                authorName: 'Aspen',
                releaseStatus: 'private'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'DB Private World',
                seedData: expect.objectContaining({
                    releaseStatus: 'private'
                }),
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('locks remote-missing worlds shown from the public DB fallback', () => {
        const items = buildWorldItems({
            remoteWorldCacheFallbackDetail: {
                name: 'DB Public World',
                authorName: 'Birch',
                releaseStatus: 'public'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'DB Public World',
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('keeps remote-missing worlds unavailable when the DB fallback only has an id shell', () => {
        const items = buildWorldItems({
            remoteWorldCacheFallbackDetail: {}
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'view.favorites.empty.world_fallback',
                seedData: null,
                isPrivate: false,
                isUnavailable: true
            })
        ]);
    });

    it('uses DB fallback details when the remote world detail is only an id shell', () => {
        const items = buildWorldItems({
            remoteWorldDetail: {},
            remoteWorldCacheFallbackDetail: {
                name: 'DB Private World',
                releaseStatus: 'private'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'DB Private World',
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('uses cached private world details when remote details are missing', () => {
        const items = buildWorldItems({
            cachedWorldDetail: {
                name: 'Cached Private World',
                authorName: 'Maple',
                releaseStatus: 'private'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Cached Private World',
                seedData: expect.objectContaining({
                    releaseStatus: 'private'
                }),
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('locks remote-missing worlds shown from the public cache', () => {
        const items = buildWorldItems({
            cachedWorldDetail: {
                name: 'Cached Public World',
                authorName: 'Cedar',
                releaseStatus: 'public'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Cached Public World',
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('keeps remote-missing worlds unavailable when the cache only has an id shell', () => {
        const items = buildWorldItems({
            cachedWorldDetail: {}
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'view.favorites.empty.world_fallback',
                seedData: null,
                isPrivate: false,
                isUnavailable: true
            })
        ]);
    });

    it('uses fresh world facts when remote details are missing and cache is empty', () => {
        const items = buildWorldItems({
            cachedWorldDetail: {},
            worldFactDetail: {
                name: 'Fresh Private World',
                authorName: 'Pine',
                releaseStatus: 'private'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Fresh Private World',
                seedData: expect.objectContaining({
                    releaseStatus: 'private'
                }),
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('prefers fresh world facts over stale cached details', () => {
        const items = buildWorldItems({
            cachedWorldDetail: {
                name: 'Cached Public World',
                releaseStatus: 'public'
            },
            worldFactDetail: {
                name: 'Fresh Private World',
                releaseStatus: 'private'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Fresh Private World',
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('prefers fresh world facts over DB fallback details', () => {
        const items = buildWorldItems({
            remoteWorldCacheFallbackDetail: {
                name: 'DB Public World',
                releaseStatus: 'public'
            },
            worldFactDetail: {
                name: 'Fresh Private World',
                releaseStatus: 'private'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Fresh Private World',
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('shows live remote avatar details without a lock', () => {
        const items = buildAvatarItems({
            remoteAvatarDetail: {
                name: 'Live Avatar',
                authorName: 'Willow',
                releaseStatus: 'public'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'avtr_favorite',
                title: 'Live Avatar',
                isPrivate: false,
                isUnavailable: false
            })
        ]);
    });

    it('locks hidden remote avatars while still showing their details', () => {
        const items = buildAvatarItems({
            remoteAvatarDetail: {
                name: 'Hidden Avatar',
                authorName: 'Hazel',
                releaseStatus: 'hidden'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'avtr_favorite',
                title: 'Hidden Avatar',
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('uses cached avatar details with a lock when remote details are missing', () => {
        const items = buildAvatarItems({
            cachedAvatarDetail: {
                name: 'Cached Avatar',
                authorName: 'Rowan',
                releaseStatus: 'public'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'avtr_favorite',
                title: 'Cached Avatar',
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('uses DB fallback avatar details with a lock when remote details are missing', () => {
        const items = buildAvatarItems({
            remoteAvatarCacheFallbackDetail: {
                name: 'DB Avatar',
                authorName: 'Sage',
                releaseStatus: 'private'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'avtr_favorite',
                title: 'DB Avatar',
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('keeps remote-missing avatars unavailable when no cache source has details', () => {
        const items = buildAvatarItems({
            cachedAvatarDetail: {}
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'avtr_favorite',
                title: 'view.favorites.empty.avatar_fallback',
                seedData: null,
                isPrivate: false,
                isUnavailable: true
            })
        ]);
    });

    it('prefers live remote avatar details over cached fallbacks', () => {
        const items = buildAvatarItems({
            remoteAvatarDetail: {
                name: 'Live Avatar',
                authorName: 'Fern',
                releaseStatus: 'public'
            },
            cachedAvatarDetail: {
                name: 'Cached Avatar',
                releaseStatus: 'private'
            },
            remoteAvatarCacheFallbackDetail: {
                name: 'DB Avatar',
                releaseStatus: 'private'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'avtr_favorite',
                title: 'Live Avatar',
                isPrivate: false,
                isUnavailable: false
            })
        ]);
    });

    it('prefers remote world details over stale cached details', () => {
        const items = buildWorldItems({
            cachedWorldDetail: {
                name: 'Cached Private World',
                releaseStatus: 'private'
            },
            remoteWorldCacheFallbackDetail: {
                name: 'DB Private World',
                releaseStatus: 'private'
            },
            worldFactDetail: {
                name: 'Fresh Private World',
                releaseStatus: 'private'
            },
            remoteWorldDetail: {
                name: 'Fresh Public World',
                authorName: 'Juniper',
                releaseStatus: 'public'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Fresh Public World',
                seedData: expect.objectContaining({
                    releaseStatus: 'public'
                }),
                isPrivate: false,
                isUnavailable: false
            })
        ]);
    });

    it('keeps full and compact image urls separate for remote world cards', () => {
        const items = buildWorldItems({
            remoteWorldDetail: {
                name: 'Image World',
                thumbnailImageUrl: 'https://example.test/thumb/256',
                imageUrl: 'https://example.test/full/256'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                imageUrl: 'https://example.test/full/256',
                imageSmallUrl: 'https://example.test/thumb/128'
            })
        ]);
    });

    it('keeps full and compact image urls separate for local world cards', () => {
        const items = buildFavoriteLocalItemsByGroup({
            kind: 'world',
            localGroups: [
                {
                    key: 'Worlds',
                    label: 'Worlds'
                }
            ],
            localWorldFavorites: {
                Worlds: ['wrld_local']
            },
            localWorldDetailsById: {
                wrld_local: {
                    id: 'wrld_local',
                    name: 'Local World',
                    thumbnailImageUrl: 'https://example.test/local-thumb/256',
                    imageUrl: 'https://example.test/local-full/256'
                }
            },
            sortValue: 'date',
            t: (key: string) => key
        })['Worlds'];

        expect(items).toEqual([
            expect.objectContaining({
                imageUrl: 'https://example.test/local-full/256',
                imageSmallUrl: 'https://example.test/local-thumb/128'
            })
        ]);
    });

    it('keeps full and compact image urls separate for avatar history cards', () => {
        const items = buildFavoriteAvatarHistoryItems({
            kind: 'avatar',
            avatarHistory: [
                {
                    id: 'avtr_history',
                    name: 'History Avatar',
                    thumbnailImageUrl: 'https://example.test/history-thumb/256',
                    imageUrl: 'https://example.test/history-full/256'
                }
            ],
            t: (key: string) => key
        });

        expect(items).toEqual([
            expect.objectContaining({
                imageUrl: 'https://example.test/history-full/256',
                imageSmallUrl: 'https://example.test/history-thumb/128'
            })
        ]);
    });
});
