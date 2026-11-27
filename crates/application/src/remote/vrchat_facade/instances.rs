use serde_json::Value;
use vrcx_0_application_core::{RequestPacer, Result};
use vrcx_0_contracts::vrchat_api::{VrchatResponse, VrchatScope};
use vrcx_0_core::json::RawJson;
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_vrchat_protocol::instances::{
    active_instances_get_input, discover_instances_get_input, instance_calendar_link_input,
    instance_categories_get_input, instance_category_options, instance_close_input,
    instance_count_get_input, instance_create_input, instance_display_name_input,
    instance_get_input, instance_self_invite_input, instance_short_name_get_input,
    instance_vibe_options, instance_vibes_get_input, InstanceCreateOptions, InstanceCreateRequest,
};

use crate::remote::instance_lists::{
    load_paced_pages, send_paced, ACTIVE_INSTANCE_MAX_PAGES, INSTANCE_LIST_PAGE_SIZE,
    INSTANCE_LIST_REQUEST_SPACING,
};

use super::VrchatRemoteFacade;

impl VrchatRemoteFacade {
    pub async fn instance_get(
        &self,
        world_id: String,
        instance_id: String,
    ) -> Result<VrchatResponse> {
        let (world_id, instance_id, request) =
            instance_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), world_id, instance_id)?;
        self.execute(
            "app__vrchat_instance_get",
            format!("Getting instance {world_id}:{instance_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_short_name(
        &self,
        world_id: String,
        instance_id: String,
        short_name: String,
    ) -> Result<VrchatResponse> {
        let (world_id, instance_id, request) = instance_short_name_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            world_id,
            instance_id,
            short_name,
        )?;
        self.execute(
            "app__vrchat_instance_short_name_get",
            format!("Getting short name for instance {world_id}:{instance_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_create(&self, params: InstanceCreateRequest) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_instance_create",
            "Creating instance.",
            instance_create_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params)?,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_create_options(&self) -> Result<InstanceCreateOptions> {
        let (categories, vibes) = tokio::try_join!(
            self.execute(
                "app__vrchat_instance_create_options_get",
                "Getting instance categories.",
                instance_categories_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
                VrchatScope::Vrchat,
            ),
            self.execute(
                "app__vrchat_instance_create_options_get",
                "Getting instance vibes.",
                instance_vibes_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
                VrchatScope::Vrchat,
            ),
        )?;
        Ok(InstanceCreateOptions {
            categories: instance_category_options(&categories)?,
            vibes: instance_vibe_options(&vibes)?,
        })
    }

    pub async fn instance_self_invite(
        &self,
        world_id: String,
        instance_id: String,
        short_name: String,
    ) -> Result<VrchatResponse> {
        let (world_id, instance_id, request) = instance_self_invite_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            world_id,
            instance_id,
            short_name,
        )?;
        self.execute(
            "app__vrchat_instance_self_invite",
            format!("Sending self invite for {world_id}:{instance_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_close(
        &self,
        location: String,
        hard_close: bool,
    ) -> Result<VrchatResponse> {
        let (location, request) =
            instance_close_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), location, hard_close)?;
        self.execute(
            "app__vrchat_instance_close",
            format!("Closing instance {location}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_calendar_link(
        &self,
        location: String,
        calendar_entry_id: Option<String>,
    ) -> Result<VrchatResponse> {
        let (location, request) = instance_calendar_link_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            location,
            calendar_entry_id,
        )?;
        self.execute(
            "app__vrchat_instance_calendar_link_set",
            format!("Updating the calendar event of instance {location}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_display_name(
        &self,
        location: String,
        display_name: Option<String>,
    ) -> Result<VrchatResponse> {
        let (location, request) = instance_display_name_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            location,
            display_name,
        )?;
        self.execute(
            "app__vrchat_instance_display_name_set",
            format!("Renaming instance {location}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_count(&self) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_instance_count_get",
            "Getting the active instance count.",
            instance_count_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn active_instances(&self) -> Result<Vec<RawJson>> {
        let pacer = RequestPacer::new(INSTANCE_LIST_REQUEST_SPACING);
        let rows = load_paced_pages(&pacer, ACTIVE_INSTANCE_MAX_PAGES, |offset| {
            self.execute(
                "app__vrchat_instances_active_get",
                format!("Getting active instances from offset {offset}."),
                active_instances_get_input(
                    VRCHAT_API_DEFAULT_ENDPOINT.into(),
                    INSTANCE_LIST_PAGE_SIZE,
                    offset,
                ),
                VrchatScope::Vrchat,
            )
        })
        .await?;
        Ok(rows.into_iter().map(RawJson::from).collect())
    }

    pub async fn discover_instances(&self) -> Result<Vec<RawJson>> {
        let pacer = RequestPacer::new(INSTANCE_LIST_REQUEST_SPACING);
        let payload = send_paced(&pacer, || {
            self.execute(
                "app__vrchat_instances_discover_get",
                "Discovering instances.",
                discover_instances_get_input(
                    VRCHAT_API_DEFAULT_ENDPOINT.into(),
                    INSTANCE_LIST_PAGE_SIZE,
                ),
                VrchatScope::Vrchat,
            )
        })
        .await?;
        let rows = match payload {
            Value::Object(mut payload) => match payload.remove("instances") {
                Some(Value::Array(rows)) => rows,
                _ => Vec::new(),
            },
            _ => Vec::new(),
        };
        Ok(rows.into_iter().map(RawJson::from).collect())
    }
}
