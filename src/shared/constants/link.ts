import { vrchatPasswordUrl, vrchatRegisterUrl } from './vrchatWebUrls';

const links: Record<string, string> = {
    wiki: 'https://github.com/Map1en/VRCX-0/wiki',
    github: 'https://github.com/Map1en/VRCX-0',
    githubSponsors: 'https://github.com/sponsors/Map1en',
    afdian: 'https://ifdian.net/a/map1en_',
    kofi: 'https://ko-fi.com/map1en_',
    issues: 'https://github.com/Map1en/VRCX-0/issues',
    releases: 'https://github.com/Map1en/VRCX-0/releases',
    contributorsApi:
        'https://api.github.com/repos/Map1en/VRCX-0/contributors?per_page=100',
    license: 'https://github.com/Map1en/VRCX-0/blob/master/LICENSE',
    discord: 'https://discord.gg/fehKP3SVPN',
    qqGroup: 'https://qm.qq.com/q/MDK8QDUX2C',
    vrchatStatus: 'https://status.vrchat.com/',
    vrchatDocsConfigurationFile:
        'https://docs.vrchat.com/docs/configuration-file',
    vrchatDocsLaunchOptions: 'https://docs.vrchat.com/docs/launch-options',
    vrchatPassword: vrchatPasswordUrl(),
    vrchatRegister: vrchatRegisterUrl(),
    communityThemesRepository:
        'https://github.com/Map1en/VRCX-0-Community-Themes',
    communityThemesIndex:
        'https://raw.githubusercontent.com/Map1en/VRCX-0-Community-Themes/master/themes/index.json',
    communityThemesStatsApi: 'https://theme.vrcx-0.dev'
};

export { links };
