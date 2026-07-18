use super::*;

fn non_negative_query_param_i64(params: &Value, key: &str, default_value: i64) -> i64 {
    query_param_i64(params, key, default_value).max(0)
}

fn limit_usize(limit: i64) -> usize {
    usize::try_from(limit).unwrap_or(usize::MAX)
}

pub fn game_log_query(
    db: &DatabaseService,
    owner_user_id: &str,
    query: GameLogQueryInput,
) -> Result<Value, Error> {
    ensure_game_log_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    let params = query.params.into_value();
    let kind = normalize_text(&query.kind);
    match kind.as_str() {
        "recentDatabase" => {
            let date_offset = query_param_string(&params, "dateOffset");
            let limit = non_negative_query_param_i64(&params, "maxTableSize", 500);
            let mut rows = Vec::new();
            let recent_params = scoped_params(owner_id)
                .set("date_offset", date_offset)
                .set("limit", limit)
                .build();
            for descriptor in GAME_LOG_RECENT_DESCRIPTORS {
                for row in db.execute(&game_log_recent_select_sql(descriptor), &recent_params)? {
                    rows.push(game_log_row_from_unified_row(&row)?);
                }
            }
            rows.sort_by(|left, right| {
                let left_date = left
                    .get("created_at")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let right_date = right
                    .get("created_at")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                left_date.cmp(right_date)
            });
            let limit = limit_usize(limit);
            if rows.len() > limit {
                rows.drain(0..rows.len() - limit);
            }
            Ok(Value::Array(rows))
        }
        "rowsByLocation" | "lookupRows" | "searchRows" => {
            let mode = kind.as_str();
            let include_extra = mode != "rowsByLocation";
            let filters = query_param_string_array(&params, "filters");
            let flags = game_log_filter_flags(&filters, include_extra);
            let vip_list = query_param_string_array(&params, "vipList");
            let mut db_params = scoped_param_map(owner_id);
            let max_entries = non_negative_query_param_i64(&params, "maxEntries", 500);
            db_params.insert("@limit".into(), Value::from(max_entries));
            db_params.insert("@per_table".into(), Value::from(max_entries));
            let vip_placeholders = add_list_params(&mut db_params, &vip_list, "vip");
            let vip_query = if vip_placeholders.is_empty() {
                String::new()
            } else {
                format!("AND user_id IN ({})", vip_placeholders.join(", "))
            };
            let mut selects = Vec::new();

            if mode == "rowsByLocation" {
                let instance_id = query_param_string(&params, "instanceId");
                db_params.insert(
                    "@location_like".into(),
                    Value::String(format!("%{instance_id}%")),
                );
                db_params.insert(
                    "@current_user_id".into(),
                    Value::String(query_param_string(&params, "currentUserId")),
                );
                if flags.location {
                    selects.push(game_log_location_union_select(
                        "location LIKE @location_like",
                        include_extra,
                    ));
                }
                if flags.onplayerjoined || flags.onplayerleft {
                    let query = match (flags.onplayerjoined, flags.onplayerleft) {
                        (true, false) => "AND type = 'OnPlayerJoined'",
                        (false, true) => "AND type = 'OnPlayerLeft'",
                        _ => "",
                    };
                    selects.push(game_log_join_leave_union_select(
                        &format!("(location LIKE @location_like AND user_id != @current_user_id) {vip_query} {query}"),
                        include_extra,
                    ));
                }
                if flags.portalspawn {
                    selects.push(game_log_portal_spawn_union_select(
                        &format!("location LIKE @location_like {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.videoplay {
                    selects.push(game_log_video_play_union_select(
                        &format!("location LIKE @location_like {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.stringload || flags.imageload {
                    let check_string = if flags.stringload {
                        ""
                    } else {
                        "AND resource_type != 'StringLoad'"
                    };
                    let check_image = if flags.imageload {
                        ""
                    } else {
                        "AND resource_type != 'ImageLoad'"
                    };
                    selects.push(game_log_resource_load_union_select(
                        &format!("location LIKE @location_like {check_string} {check_image}"),
                        include_extra,
                    ));
                }
            } else if mode == "lookupRows" {
                if flags.location {
                    selects.push(game_log_location_union_select("1=1", include_extra));
                }
                if flags.onplayerjoined || flags.onplayerleft {
                    let query = match (flags.onplayerjoined, flags.onplayerleft) {
                        (true, false) => "AND type = 'OnPlayerJoined'",
                        (false, true) => "AND type = 'OnPlayerLeft'",
                        _ => "",
                    };
                    selects.push(game_log_join_leave_union_select(
                        &format!("1=1 {vip_query} {query}"),
                        include_extra,
                    ));
                }
                if flags.portalspawn {
                    selects.push(game_log_portal_spawn_union_select(
                        &format!("1=1 {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.event {
                    selects.push(game_log_event_union_select("1=1", include_extra));
                }
                if flags.external {
                    selects.push(game_log_external_union_select(
                        &format!("1=1 {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.videoplay {
                    selects.push(game_log_video_play_union_select(
                        &format!("1=1 {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.stringload || flags.imageload {
                    let check_string = if flags.stringload {
                        ""
                    } else {
                        "AND resource_type != 'StringLoad'"
                    };
                    let check_image = if flags.imageload {
                        ""
                    } else {
                        "AND resource_type != 'ImageLoad'"
                    };
                    selects.push(game_log_resource_load_union_select(
                        &format!("1=1 {check_string} {check_image}"),
                        include_extra,
                    ));
                }
            } else {
                let search = query_param_string(&params, "search");
                db_params.insert("@search_like".into(), Value::String(format!("%{search}%")));
                db_params.insert(
                    "@current_user_id".into(),
                    Value::String(query_param_string(&params, "currentUserId")),
                );
                if flags.location {
                    selects.push(game_log_location_union_select(
                        "(world_name LIKE @search_like OR group_name LIKE @search_like)",
                        include_extra,
                    ));
                }
                if flags.onplayerjoined || flags.onplayerleft {
                    let query = match (flags.onplayerjoined, flags.onplayerleft) {
                        (true, false) => "AND type = 'OnPlayerJoined'",
                        (false, true) => "AND type = 'OnPlayerLeft'",
                        _ => "",
                    };
                    selects.push(game_log_join_leave_union_select(
                        &format!("((display_name LIKE @search_like OR user_id LIKE @search_like) AND user_id != @current_user_id) {vip_query} {query}"),
                        include_extra,
                    ));
                }
                if flags.portalspawn {
                    selects.push(game_log_portal_spawn_union_select(
                        &format!("(display_name LIKE @search_like OR user_id LIKE @search_like OR world_name LIKE @search_like) {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.event {
                    selects.push(game_log_event_union_select(
                        "data LIKE @search_like",
                        include_extra,
                    ));
                }
                if flags.external {
                    selects.push(game_log_external_union_select(
                        &format!("(display_name LIKE @search_like OR user_id LIKE @search_like OR message LIKE @search_like) {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.videoplay {
                    selects.push(game_log_video_play_union_select(
                        &format!("(video_url LIKE @search_like OR video_name LIKE @search_like OR display_name LIKE @search_like OR user_id LIKE @search_like) {vip_query}"),
                        include_extra,
                    ));
                }
                if flags.stringload || flags.imageload {
                    let check_string = if flags.stringload {
                        ""
                    } else {
                        "AND resource_type != 'StringLoad'"
                    };
                    let check_image = if flags.imageload {
                        ""
                    } else {
                        "AND resource_type != 'ImageLoad'"
                    };
                    selects.push(game_log_resource_load_union_select(
                        &format!("resource_url LIKE @search_like {check_string} {check_image}"),
                        include_extra,
                    ));
                }
            }

            if selects.is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            Ok(Value::Array(
                db.execute(
                    &format!(
                        "SELECT {} FROM ({}) ORDER BY created_at DESC, id DESC LIMIT @limit",
                        game_log_base_columns(include_extra),
                        selects.join(" UNION ALL ")
                    ),
                    &db_params,
                )?
                .into_iter()
                .map(|row| game_log_row_from_unified_row(&row))
                .collect::<Result<Vec<_>, _>>()?,
            ))
        }
        "lastVisit" => {
            let world_id = query_param_string(&params, "worldId");
            let count = if query_param_bool(&params, "currentWorldMatch") {
                2
            } else {
                1
            };
            let row = db
                .execute(
                    "SELECT created_at, world_id FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND world_id = @world_id ORDER BY id DESC LIMIT @count",
                    &scoped_params(owner_id)
                        .set("world_id", world_id)
                        .set("count", count)
                        .build(),
                )?
                .last()
                .cloned();
            Ok(row
                .map(|row| json!({ "created_at": row_json(&row, 0), "worldId": row_json(&row, 1) }))
                .unwrap_or_else(|| json!({ "created_at": "", "worldId": "" })))
        }
        "visitCount" => {
            let world_id = query_param_string(&params, "worldId");
            let count = db
                .execute(
                    "SELECT COUNT(DISTINCT location) FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND world_id = @world_id",
                    &scoped_params(owner_id).set("world_id", world_id.clone()).build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(json!({ "visitCount": count, "worldId": world_id }))
        }
        "timeSpentInWorld" => {
            let world_id = query_param_string(&params, "worldId");
            let time_spent = db
                .execute(
                    "SELECT COALESCE(SUM(time), 0) FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND world_id = @world_id",
                    &scoped_params(owner_id).set("world_id", world_id.clone()).build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(json!({ "timeSpent": time_spent, "worldId": world_id }))
        }
        "lastGroupVisit" => {
            let group_id = query_param_string(&params, "groupId");
            let created_at = db
                .execute(
                    "SELECT created_at FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND location LIKE @group_id ORDER BY id DESC LIMIT 1",
                    &scoped_params(owner_id)
                        .set("group_id", format!("%{group_id}%"))
                        .build(),
                )?
                .first()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            Ok(json!({ "created_at": created_at }))
        }
        "previousInstancesByGroupId" => {
            let group_id = query_param_string(&params, "groupId");
            let mut by_location = HashMap::<String, Value>::new();
            let mut location_order = Vec::<String>::new();
            for row in db.execute(
                "SELECT created_at, location, time, world_name, group_name
                 FROM gamelog_location
                 WHERE owner_id IN (0, @owner_id)
                   AND location LIKE @group_id
                 ORDER BY id DESC",
                &scoped_params(owner_id)
                    .set("group_id", format!("%{group_id}%"))
                    .build(),
            )? {
                let location = row_string(&row, 1);
                if !by_location.contains_key(&location) {
                    location_order.push(location.clone());
                }
                let time = row_i64(&row, 2)
                    + by_location
                        .get(&location)
                        .and_then(|value| value.get("time"))
                        .map(value_as_i64)
                        .unwrap_or(0);
                by_location.insert(
                    location.clone(),
                    json!({
                        "created_at": row_json(&row, 0),
                        "location": location,
                        "time": time,
                        "worldName": row_json(&row, 3),
                        "groupName": row_json(&row, 4)
                    }),
                );
            }
            Ok(Value::Array(
                location_order
                    .into_iter()
                    .filter_map(|location| by_location.remove(&location))
                    .collect(),
            ))
        }
        "lastSeen" => {
            let user_id = query_param_string(&params, "userId");
            let display_name = query_param_string(&params, "displayName");
            let count = if query_param_bool(&params, "inCurrentWorld") {
                2
            } else {
                1
            };
            let row = db
                .execute(
                    "SELECT created_at, user_id FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id) AND (user_id = @user_id OR display_name = @display_name) ORDER BY id DESC LIMIT @count",
                    &scoped_params(owner_id)
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name)
                        .set("count", count)
                        .build(),
                )?
                .last()
                .cloned();
            Ok(row
                .map(|row| {
                    let row_user_id = row_string(&row, 1);
                    json!({
                        "created_at": row_json(&row, 0),
                        "userId": if row_user_id.is_empty() { user_id } else { row_user_id }
                    })
                })
                .unwrap_or_else(|| json!({ "created_at": "", "userId": "" })))
        }
        "joinCount" => {
            let user_id = query_param_string(&params, "userId");
            let display_name = query_param_string(&params, "displayName");
            let count = db
                .execute(
                    "SELECT COUNT(DISTINCT location) FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id) AND (type = 'OnPlayerJoined') AND (user_id = @user_id OR display_name = @display_name)",
                    &scoped_params(owner_id)
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name)
                        .build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(json!({ "joinCount": count, "userId": user_id }))
        }
        "timeSpent" => {
            let user_id = query_param_string(&params, "userId");
            let display_name = query_param_string(&params, "displayName");
            let time_spent = db
                .execute(
                    "SELECT COALESCE(SUM(time), 0)
                     FROM gamelog_join_leave
                     WHERE owner_id IN (0, @owner_id)
                       AND type = 'OnPlayerLeft'
                       AND (user_id = @user_id OR display_name = @display_name)",
                    &scoped_params(owner_id)
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name)
                        .build(),
                )?
                .first()
                .map(|row| row_i64(row, 0))
                .unwrap_or(0);
            Ok(json!({ "timeSpent": time_spent, "userId": user_id }))
        }
        "userStats" => {
            let user_id = query_param_string(&params, "userId");
            let display_name = query_param_string(&params, "displayName");
            let count = if query_param_bool(&params, "inCurrentWorld") {
                2
            } else {
                1
            };
            let last_seen = db
                .execute(
                    "SELECT created_at FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id) AND (user_id = @user_id OR display_name = @display_name) ORDER BY id DESC LIMIT @count",
                    &scoped_params(owner_id)
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name.clone())
                        .set("count", count)
                        .build(),
                )?
                .last()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            let stats = db
                .execute(
                    "SELECT
                        COALESCE(SUM(CASE WHEN type = 'OnPlayerLeft' THEN time ELSE 0 END), 0),
                        COUNT(DISTINCT NULLIF(location, ''))
                     FROM gamelog_join_leave
                     WHERE owner_id IN (0, @owner_id)
                       AND (user_id = @user_id OR display_name = @display_name)",
                    &scoped_params(owner_id)
                        .set("user_id", user_id.clone())
                        .set("display_name", display_name.clone())
                        .build(),
                )?
                .first()
                .cloned();
            let mut previous_names = Vec::new();
            for row in db.execute(
                "SELECT display_name, MAX(created_at)
                 FROM gamelog_join_leave
                 WHERE owner_id IN (0, @owner_id)
                   AND user_id = @user_id
                   AND display_name != ''
                   AND display_name != @display_name
                 GROUP BY display_name
                 ORDER BY MAX(created_at) DESC",
                &scoped_params(owner_id)
                    .set("user_id", user_id.clone())
                    .set("display_name", display_name)
                    .build(),
            )? {
                previous_names.push(json!({
                    "displayName": row_json(&row, 0),
                    "created_at": row_json(&row, 1)
                }));
            }
            Ok(json!({
                "timeSpent": stats.as_ref().map(|row| row_i64(row, 0)).unwrap_or(0),
                "lastSeen": last_seen,
                "joinCount": stats.as_ref().map(|row| row_i64(row, 1)).unwrap_or(0),
                "userId": user_id,
                "previousDisplayNames": previous_names
            }))
        }
        "allUserStats" => {
            let user_ids = query_param_string_array(&params, "userIds");
            let display_names = query_param_string_array(&params, "displayNames");
            if user_ids.is_empty() && display_names.is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            let mut db_params = scoped_param_map(owner_id);
            let mut clauses = Vec::new();
            let user_placeholders = add_list_params(&mut db_params, &user_ids, "stat_user_id");
            if !user_placeholders.is_empty() {
                clauses.push(format!("g.user_id IN ({})", user_placeholders.join(", ")));
            }
            let name_placeholders =
                add_list_params(&mut db_params, &display_names, "stat_display_name");
            if !name_placeholders.is_empty() {
                clauses.push(format!(
                    "g.display_name IN ({})",
                    name_placeholders.join(", ")
                ));
            }
            Ok(Value::Array(
                db.execute(
                    &format!(
                        "SELECT
                                g.created_at,
                                g.user_id,
                                SUM(g.time) AS timeSpent,
                                COUNT(DISTINCT g.location) AS joinCount,
                                g.display_name,
                                MAX(g.id) AS max_id
                            FROM
                                gamelog_join_leave g
                            WHERE
                                g.owner_id IN (0, @owner_id)
                                AND ({})
                            GROUP BY
                                g.user_id,
                                g.display_name
                            ORDER BY
                                g.user_id DESC",
                        clauses.join("\n                OR ")
                    ),
                    &db_params,
                )?
                .into_iter()
                .map(|row| {
                    json!({
                        "lastSeen": row_json(&row, 0),
                        "userId": row_json(&row, 1),
                        "timeSpent": row_json(&row, 2),
                        "joinCount": row_json(&row, 3),
                        "displayName": row_json(&row, 4)
                    })
                })
                .collect(),
            ))
        }
        "lastDate" => {
            let mut dates = Vec::new();
            for table in [
                "gamelog_location",
                "gamelog_join_leave",
                "gamelog_portal_spawn",
                "gamelog_event",
                "gamelog_video_play",
                "gamelog_resource_load",
            ] {
                if let Some(date) = db
                    .execute(
                        &format!("SELECT created_at FROM {table} WHERE owner_id IN (0, @owner_id) ORDER BY id DESC LIMIT 1"),
                        &scoped_params(owner_id).build(),
                    )?
                    .first()
                    .map(|row| row_string(row, 0))
                    .filter(|value| !value.is_empty())
                {
                    dates.push(date);
                }
            }
            dates.sort();
            Ok(Value::String(dates.pop().unwrap_or_default()))
        }
        "previousInstancesByUserIdRows" => {
            let user_id = query_param_string(&params, "userId");
            let date_from = query_param_string(&params, "dateFrom");
            let date_to = query_param_string(&params, "dateTo");
            if user_id.is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            let mut clauses = vec!["jl.owner_id IN (0, @owner_id)", "jl.user_id = @user_id"];
            let mut db_params = scoped_params(owner_id).set("user_id", user_id);
            if !date_from.is_empty() {
                clauses.push("jl.created_at >= @date_from");
                db_params = db_params.set("date_from", date_from);
            }
            if !date_to.is_empty() {
                clauses.push("jl.created_at <= @date_to");
                db_params = db_params.set("date_to", date_to);
            }
            let where_clause = clauses.join(" AND ");
            Ok(Value::Array(
                db.execute(
                    &format!(
                        "SELECT jl.created_at,
                               strftime('%s', jl.created_at) * 1000 created_at_ts,
                               jl.location,
                               jl.time,
                               gl.world_name,
                               gl.group_name,
                               jl.id,
                               jl.type
                        FROM gamelog_join_leave jl
                        INNER JOIN gamelog_location gl ON gl.id = (
                            SELECT gl2.id
                            FROM gamelog_location gl2
                            WHERE gl2.location = jl.location
                              AND gl2.owner_id IN (0, @owner_id)
                            ORDER BY gl2.id DESC
                            LIMIT 1
                        )
                        AND gl.owner_id IN (0, @owner_id)
                        WHERE {where_clause}
                        ORDER BY jl.id ASC"
                    ),
                    &db_params.build(),
                )?
                .into_iter()
                .map(|row| {
                    json!({
                        "created_at": row_json(&row, 0),
                        "createdAtTs": row_json(&row, 1),
                        "location": row_json(&row, 2),
                        "time": row_json(&row, 3),
                        "worldName": row_json(&row, 4),
                        "groupName": row_json(&row, 5),
                        "eventId": row_json(&row, 6),
                        "eventType": row_json(&row, 7)
                    })
                })
                .collect(),
            ))
        }
        "previousInstancesByWorldId" => {
            let world_id = query_param_string(&params, "worldId");
            Ok(Value::Array(
                db.execute(
                    "SELECT id, created_at, location, time, world_name, group_name
                         FROM gamelog_location
                         WHERE owner_id IN (0, @owner_id)
                           AND world_id = @world_id
                         ORDER BY id DESC",
                    &scoped_params(owner_id).set("world_id", world_id).build(),
                )?
                .into_iter()
                .map(|row| {
                    json!({
                        "id": row_json(&row, 0),
                        "created_at": row_json(&row, 1),
                        "location": row_json(&row, 2),
                        "time": row_i64(&row, 3),
                        "worldName": row_json(&row, 4),
                        "groupName": row_json(&row, 5)
                    })
                })
                .collect(),
            ))
        }
        "playersFromInstanceRows" => {
            let location = query_param_string(&params, "location");
            Ok(Value::Array(
                db
                    .execute(
                        "SELECT id, created_at, display_name, user_id, time, type FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id) AND location = @location ORDER BY id ASC",
                        &scoped_params(owner_id).set("location", location).build(),
                    )?
                    .into_iter()
                    .map(|row| {
                        json!({
                            "rowId": row_json(&row, 0),
                            "created_at": row_json(&row, 1),
                            "displayName": row_json(&row, 2),
                            "userId": row_json(&row, 3),
                            "time": row_i64(&row, 4),
                            "type": row_json(&row, 5)
                        })
                    })
                    .collect(),
            ))
        }
        "locationBeforeOrAt" => {
            let created_at = query_param_string(&params, "createdAt");
            let row = db
                .execute(
                    "SELECT created_at, location, world_id, world_name, group_name
                     FROM gamelog_location
                     WHERE owner_id IN (0, @owner_id)
                       AND created_at <= @created_at
                     ORDER BY created_at DESC
                     LIMIT 1",
                    &scoped_params(owner_id)
                        .set("created_at", created_at)
                        .build(),
                )?
                .first()
                .cloned();
            Ok(row
                .map(|row| {
                    json!({
                        "created_at": row_json(&row, 0),
                        "location": row_json(&row, 1),
                        "worldId": row_json(&row, 2),
                        "worldName": row_json(&row, 3),
                        "groupName": row_json(&row, 4)
                    })
                })
                .unwrap_or(Value::Null))
        }
        "joinLeaveRange" => {
            let location = query_param_string(&params, "location");
            let after_date = query_param_string(&params, "afterDate");
            let before_date = query_param_string(&params, "beforeDate");
            Ok(Value::Array(
                db.execute(
                    "SELECT created_at, type, display_name, user_id
                         FROM gamelog_join_leave
                         WHERE owner_id IN (0, @owner_id)
                           AND location = @location
                           AND created_at >= @after_date
                           AND created_at <= @before_date
                         ORDER BY created_at ASC",
                    &scoped_params(owner_id)
                        .set("location", location)
                        .set("after_date", after_date)
                        .set("before_date", before_date)
                        .build(),
                )?
                .into_iter()
                .map(|row| {
                    json!({
                        "created_at": row_json(&row, 0),
                        "type": row_json(&row, 1),
                        "displayName": row_json(&row, 2),
                        "userId": row_json(&row, 3)
                    })
                })
                .collect(),
            ))
        }
        "playerDetailFromInstance" => {
            let location = query_param_string(&params, "location");
            Ok(Value::Array(
                db.execute(
                    "SELECT created_at, display_name, user_id, time
                         FROM gamelog_join_leave
                         WHERE owner_id IN (0, @owner_id)
                           AND location = @location AND type = 'OnPlayerLeft'
                         ORDER BY created_at ASC",
                    &scoped_params(owner_id).set("location", location).build(),
                )?
                .into_iter()
                .map(|row| {
                    json!({
                        "created_at": row_json(&row, 0),
                        "display_name": row_json(&row, 1),
                        "user_id": row_json(&row, 2),
                        "time": row_i64(&row, 3)
                    })
                })
                .collect(),
            ))
        }
        "previousDisplayNamesByUserId" => {
            let user_id = query_param_string(&params, "userId");
            Ok(Value::Array(
                db.execute(
                    "SELECT created_at, display_name
                         FROM gamelog_join_leave
                         WHERE owner_id IN (0, @owner_id)
                           AND user_id = @user_id
                         ORDER BY id DESC",
                    &scoped_params(owner_id).set("user_id", user_id).build(),
                )?
                .into_iter()
                .map(|row| {
                    json!({
                        "created_at": row_json(&row, 0),
                        "displayName": row_json(&row, 1)
                    })
                })
                .collect(),
            ))
        }
        "instanceTimes" => Ok(Value::Array(
            db.execute(
                "SELECT location, time FROM gamelog_location WHERE owner_id IN (0, @owner_id)",
                &scoped_params(owner_id).build(),
            )?
            .into_iter()
            .map(|row| json!({ "location": row_json(&row, 0), "time": row_i64(&row, 1) }))
            .collect(),
        )),
        "onlineSessions" => {
            let from_date = query_param_string(&params, "fromDate");
            let to_date = query_param_string(&params, "toDate");
            let mut rows = Vec::new();
            if !from_date.is_empty() {
                if let Some(row) = db
                    .execute(
                        "SELECT created_at, time FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND created_at < @from_date ORDER BY created_at DESC LIMIT 1",
                        &scoped_params(owner_id).set("from_date", from_date.clone()).build(),
                    )?
                    .first()
                    .cloned()
                {
                    rows.push(json!({ "created_at": row_json(&row, 0), "time": row_i64(&row, 1) }));
                }
            }
            let mut clauses = vec!["owner_id IN (0, @owner_id)"];
            let mut db_params = scoped_param_map(owner_id);
            if !from_date.is_empty() {
                clauses.push("created_at >= @from_date");
                db_params.insert("@from_date".into(), Value::String(from_date));
            }
            if !to_date.is_empty() {
                clauses.push("created_at < @to_date");
                db_params.insert("@to_date".into(), Value::String(to_date));
            }
            let date_clause = format!("WHERE {}", clauses.join(" AND "));
            for row in db.execute(
                &format!("SELECT created_at, time FROM gamelog_location {date_clause} ORDER BY created_at"),
                &db_params,
            )? {
                rows.push(json!({ "created_at": row_json(&row, 0), "time": row_i64(&row, 1) }));
            }
            Ok(Value::Array(rows))
        }
        "onlineSessionsAfter" => {
            let after = query_param_string(&params, "afterCreatedAt");
            let op = if query_param_bool(&params, "inclusive") {
                ">="
            } else {
                ">"
            };
            Ok(Value::Array(
                db
                    .execute(
                        &format!("SELECT created_at, time FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND created_at {op} @after ORDER BY created_at"),
                        &scoped_params(owner_id).set("after", after).build(),
                    )?
                    .into_iter()
                    .map(|row| json!({ "created_at": row_json(&row, 0), "time": row_i64(&row, 1) }))
                    .collect(),
            ))
        }
        "topWorlds" => {
            let days = query_param_i64(&params, "days", 0);
            let limit = non_negative_query_param_i64(&params, "limit", 5);
            let sort_by = query_param_string(&params, "sortBy");
            let exclude_world_id = query_param_string(&params, "excludeWorldId");
            let where_clause = if days > 0 {
                "AND created_at >= datetime('now', @days_offset)"
            } else {
                ""
            };
            let exclude_clause = if exclude_world_id.is_empty() {
                ""
            } else {
                "AND world_id != @exclude_world_id"
            };
            let order_by = if sort_by == "count" {
                "visit_count DESC"
            } else {
                "total_time DESC"
            };
            let mut db_params = scoped_param_map(owner_id);
            db_params.insert("@limit".into(), Value::from(limit));
            if days > 0 {
                db_params.insert(
                    "@days_offset".into(),
                    Value::String(format!("-{days} days")),
                );
            }
            if !exclude_world_id.is_empty() {
                db_params.insert("@exclude_world_id".into(), Value::String(exclude_world_id));
            }
            Ok(Value::Array(
                db
                    .execute(
                        &format!(
                            "SELECT world_id, world_name, COUNT(*) AS visit_count, SUM(time) AS total_time
                             FROM gamelog_location
                             WHERE owner_id IN (0, @owner_id)
                               AND world_id IS NOT NULL
                               AND world_id != ''
                               AND world_id LIKE 'wrld_%'
                               {where_clause}
                               {exclude_clause}
                             GROUP BY world_id
                             ORDER BY {order_by}
                             LIMIT @limit"
                        ),
                        &db_params,
                    )?
                    .into_iter()
                    .map(|row| {
                        let world_id = row_string(&row, 0);
                        let world_name = row_string(&row, 1);
                        json!({
                            "worldId": world_id,
                            "worldName": if world_name.is_empty() { row_json(&row, 0) } else { row_json(&row, 1) },
                            "visitCount": row_json(&row, 2),
                            "totalTime": row_i64(&row, 3)
                        })
                    })
                    .collect(),
            ))
        }
        "instanceActivityRows" => {
            let start_date = query_param_string(&params, "startDate");
            let end_date = query_param_string(&params, "endDate");
            Ok(Value::Array(
                db
                    .execute(
                        "SELECT id, created_at, type, display_name, location, user_id, time
                         FROM gamelog_join_leave
                         WHERE owner_id IN (0, @owner_id)
                           AND type = 'OnPlayerLeft'
                           AND (
                             strftime('%Y-%m-%dT%H:%M:%SZ', created_at, '-' || (time * 1.0 / 1000) || ' seconds') BETWEEN @utc_start_date AND @utc_end_date
                             OR created_at BETWEEN @utc_start_date AND @utc_end_date
                           )",
                        &scoped_params(owner_id)
                            .set("utc_start_date", start_date)
                            .set("utc_end_date", end_date)
                            .build(),
                    )?
                    .into_iter()
                    .map(|row| {
                        json!({
                            "id": row_json(&row, 0),
                            "created_at": row_json(&row, 1),
                            "type": row_json(&row, 2),
                            "display_name": row_json(&row, 3),
                            "location": row_json(&row, 4),
                            "user_id": row_json(&row, 5),
                            "time": row_json(&row, 6)
                        })
                    })
                    .collect(),
            ))
        }
        "dateOfInstanceActivity" => {
            let user_id = query_param_string(&params, "userId");
            Ok(Value::Array(
                db.execute(
                    "SELECT created_at FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id) AND user_id = @user_id",
                    &scoped_params(owner_id).set("user_id", user_id).build(),
                )?
                .into_iter()
                .map(|row| row_json(&row, 0))
                .collect(),
            ))
        }
        "instanceJoinHistory" => {
            let user_id = query_param_string(&params, "userId");
            let created_at = query_param_string(&params, "createdAt");
            Ok(Value::Array(
                db
                    .execute(
                        "SELECT created_at, location FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id) AND user_id = @user_id AND created_at > @created_at ORDER BY created_at DESC",
                        &scoped_params(owner_id)
                            .set("user_id", user_id)
                            .set("created_at", created_at)
                            .build(),
                    )?
                    .into_iter()
                    .map(|row| json!({ "created_at": row_json(&row, 0), "location": row_json(&row, 1) }))
                    .collect(),
            ))
        }
        "worldNameByWorldId" => {
            let world_id = query_param_string(&params, "worldId");
            let world_name = db
                .execute(
                    "SELECT world_name FROM gamelog_location WHERE owner_id IN (0, @owner_id) AND world_id = @world_id ORDER BY id DESC LIMIT 1",
                    &scoped_params(owner_id).set("world_id", world_id).build(),
                )?
                .first()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            Ok(Value::String(world_name))
        }
        "userIdFromDisplayName" => {
            let display_name = query_param_string(&params, "displayName");
            let user_id = db
                .execute(
                    "SELECT user_id FROM gamelog_join_leave WHERE owner_id IN (0, @owner_id) AND display_name = @display_name AND user_id != '' ORDER BY id DESC LIMIT 1",
                    &scoped_params(owner_id).set("display_name", display_name).build(),
                )?
                .first()
                .map(|row| row_string(row, 0))
                .unwrap_or_default();
            Ok(Value::String(user_id))
        }
        _ => Err(Error::Custom(format!(
            "Unknown game log query: {}",
            query.kind
        ))),
    }
}
