use vrcx_0_composition::Result;

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub fn background_image_projection(
        &self,
    ) -> vrcx_0_application::profile::BackgroundImageProjection {
        self.desktop.background_image.projection()
    }

    pub async fn configure_background_image(
        &self,
        input: vrcx_0_application::profile::BackgroundImageConfigureInput,
    ) -> Result<vrcx_0_application::profile::BackgroundImageProjection> {
        Ok(self
            .desktop
            .community_theme
            .configure_background_image(input)
            .await?)
    }

    pub async fn refresh_background_image(
        &self,
        force: bool,
    ) -> Result<vrcx_0_application::profile::BackgroundImageProjection> {
        Ok(self
            .desktop
            .community_theme
            .refresh_background_image(force)
            .await?)
    }

    pub async fn initialize_community_theme(
        &self,
    ) -> Result<vrcx_0_application::profile::CommunityThemeProjection> {
        Ok(self.desktop.community_theme.initialize().await?)
    }

    pub async fn community_theme_catalog(
        &self,
    ) -> Result<vrcx_0_application::profile::CommunityThemeCatalog> {
        Ok(self.desktop.community_theme.load_catalog().await?)
    }

    pub async fn community_theme_stats(
        &self,
    ) -> Result<vrcx_0_application::profile::CommunityThemeStatsById> {
        Ok(self.desktop.community_theme.load_stats().await?)
    }

    pub async fn configure_community_theme(
        &self,
        input: vrcx_0_application::profile::CommunityThemeConfigureInput,
    ) -> Result<vrcx_0_application::profile::CommunityThemeProjection> {
        Ok(self.desktop.community_theme.configure(input).await?)
    }

    pub async fn report_community_theme_install(&self, theme_id: &str) -> bool {
        self.desktop.community_theme.report_install(theme_id).await
    }
}
