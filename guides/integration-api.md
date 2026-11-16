# Integration API

The Integration API streams live information about your current VRChat
instance to other apps, such as overlays, stream tools, or your own scripts.

Turn it on under **Settings → Integrations → Integration API**. The server only
listens while VRChat is running and accepts connections from this computer
only, unless you turn on **Allow LAN connections**. The default port is `8799`.

## What it provides

- The world and instance you are in, and when you entered it
- The players in the instance: user ID, display name, whether they are you or a
  friend, when they joined, their language tags, and your note on them
- Players joining and leaving, as they happen

## Connecting

Every request needs the access token shown in the settings. Send it as an
`Authorization: Bearer <token>` header. Browsers can't set that header on a
WebSocket, so they can instead request the subprotocols
`vrcx0.integration.v1` and `vrcx0.integration.token.<token>`.

| Endpoint                              | Description                             |
| ------------------------------------- | --------------------------------------- |
| `GET http://127.0.0.1:8799/v1/health` | Returns `{ "ok": true, "protocol": 1 }` |
| `ws://127.0.0.1:8799/v1/stream`       | The event stream                        |

## Messages

All messages are JSON with a `type` field. Every message except `bye` carries
an increasing `seq`, and timestamps are ISO 8601 in UTC.

| `type`          | When                                                                                                 | Content                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `hello`         | Right after connecting                                                                               | `protocol`, `app`, `appVersion`, `scopes`, `heartbeatSec`                                                                |
| `room.snapshot` | After `hello`, when you change instance, and whenever the stream resyncs; replaces all earlier state | `room`: `location`, `worldId`, `worldName`, `destination`, `enteredAt`, `members`; `null` when you're not in an instance |
| `room.joined`   | Players join                                                                                         | `members`                                                                                                                |
| `room.left`     | Players leave                                                                                        | `userIds`                                                                                                                |
| `ping`          | Every `heartbeatSec` seconds                                                                         | —                                                                                                                        |
| `bye`           | VRChat closed or the API was turned off                                                              | `reason`: `gameStopped` or `disabled`                                                                                    |

Each member has `userId`, `displayName`, `isSelf`, `isFriend`, `joinedAt`,
`languages`, and `note`.

Send `{ "type": "resync" }` at any time to receive a fresh `room.snapshot`.
