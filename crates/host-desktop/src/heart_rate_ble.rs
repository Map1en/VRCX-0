use std::collections::HashMap;
use std::pin::Pin;
use std::time::Duration;

use btleplug::api::bleuuid::uuid_from_u16;
use btleplug::api::{
    Central, CentralEvent, CentralState, Characteristic, Manager as _, Peripheral as _,
    RetrievePeripheralsOptions, ScanFilter, ValueNotification,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures_util::{Stream, StreamExt};
use tokio::time::Instant;

const HEART_RATE_SERVICE: u16 = 0x180D;
const HEART_RATE_MEASUREMENT: u16 = 0x2A37;
const DISCOVERY_POLL: Duration = Duration::from_millis(500);
const SYSTEM_DEVICES_POLL: Duration = Duration::from_secs(2);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, thiserror::Error)]
pub enum HeartRateBleError {
    #[error("bluetooth is unavailable")]
    Unavailable,
    #[error("bluetooth permission denied")]
    PermissionDenied,
    #[error("device has no heart rate measurement")]
    Incompatible,
    #[error("{0}")]
    Failed(String),
}

impl From<btleplug::Error> for HeartRateBleError {
    fn from(error: btleplug::Error) -> Self {
        match error {
            btleplug::Error::PermissionDenied => Self::PermissionDenied,
            btleplug::Error::NoAdapterAvailable => Self::Unavailable,
            other => Self::Failed(other.to_string()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HeartRateBleMeasurement {
    pub bpm: u16,
    pub skin_contact: Option<bool>,
}

pub fn parse_heart_rate_measurement(data: &[u8]) -> Option<HeartRateBleMeasurement> {
    let flags = *data.first()?;
    let bpm = if flags & 0b0000_0001 == 0 {
        u16::from(*data.get(1)?)
    } else {
        u16::from_le_bytes([*data.get(1)?, *data.get(2)?])
    };
    let skin_contact = (flags & 0b0000_0100 != 0).then_some(flags & 0b0000_0010 != 0);
    Some(HeartRateBleMeasurement { bpm, skin_contact })
}

#[cfg(target_os = "macos")]
pub async fn heart_rate_bluetooth_available() -> bool {
    true
}

#[cfg(not(target_os = "macos"))]
pub async fn heart_rate_bluetooth_available() -> bool {
    HeartRateBluetooth::open().await.is_ok()
}

#[derive(Clone)]
pub struct HeartRateBleDevice {
    pub id: String,
    pub name: Option<String>,
    pub rssi: Option<i16>,
    pub system_connected: bool,
    peripheral: Peripheral,
}

pub struct HeartRateBluetooth {
    adapter: Adapter,
}

impl HeartRateBluetooth {
    pub async fn open() -> Result<Self, HeartRateBleError> {
        let manager = Manager::new().await?;
        let adapter = manager
            .adapters()
            .await?
            .into_iter()
            .next()
            .ok_or(HeartRateBleError::Unavailable)?;
        if adapter.adapter_state().await? == CentralState::PoweredOff {
            return Err(HeartRateBleError::Unavailable);
        }
        Ok(Self { adapter })
    }

    pub async fn discover(
        &self,
        window: Duration,
        wanted: Option<&str>,
        cancelled: &(dyn Fn() -> bool + Sync),
    ) -> Result<Vec<HeartRateBleDevice>, HeartRateBleError> {
        let service = uuid_from_u16(HEART_RATE_SERVICE);
        self.adapter
            .start_scan(ScanFilter {
                services: vec![service],
            })
            .await?;
        let result = self.collect_devices(window, wanted, cancelled).await;
        if let Err(error) = self.adapter.stop_scan().await {
            tracing::debug!(error = %error, "heart rate scan stop failed");
        }
        result
    }

    async fn collect_devices(
        &self,
        window: Duration,
        wanted: Option<&str>,
        cancelled: &(dyn Fn() -> bool + Sync),
    ) -> Result<Vec<HeartRateBleDevice>, HeartRateBleError> {
        let service = uuid_from_u16(HEART_RATE_SERVICE);
        let deadline = Instant::now() + window;
        let mut next_system_poll = Instant::now();
        let mut found = HashMap::<String, HeartRateBleDevice>::new();
        loop {
            if Instant::now() >= next_system_poll {
                next_system_poll = Instant::now() + SYSTEM_DEVICES_POLL;
                match self
                    .adapter
                    .retrieve_peripherals(RetrievePeripheralsOptions {
                        identifiers: None,
                        services: Some(vec![service]),
                    })
                    .await
                {
                    Ok(peripherals) => {
                        for peripheral in peripherals {
                            let device = describe(peripheral, true).await;
                            found.insert(device.id.clone(), device);
                        }
                    }
                    Err(btleplug::Error::NotSupported(_)) => {}
                    Err(error) => {
                        tracing::debug!(error = %error, "connected heart rate lookup failed");
                    }
                }
            }
            for peripheral in self.adapter.peripherals().await? {
                let advertises_heart_rate = peripheral
                    .properties()
                    .await
                    .ok()
                    .flatten()
                    .is_some_and(|properties| properties.services.contains(&service));
                if !advertises_heart_rate {
                    continue;
                }
                let device = describe(peripheral, false).await;
                let system_connected = found
                    .get(&device.id)
                    .is_some_and(|existing| existing.system_connected);
                found.insert(
                    device.id.clone(),
                    HeartRateBleDevice {
                        system_connected,
                        ..device
                    },
                );
            }
            let done = wanted.is_some_and(|wanted| found.contains_key(wanted));
            if done || cancelled() || Instant::now() >= deadline {
                return Ok(found.into_values().collect());
            }
            tokio::time::sleep(DISCOVERY_POLL).await;
        }
    }

    pub async fn connect(
        &self,
        device: &HeartRateBleDevice,
    ) -> Result<HeartRateBleLink, HeartRateBleError> {
        let peripheral = device.peripheral.clone();
        let events = self.adapter.events().await?;
        let owns_connection = !peripheral.is_connected().await.unwrap_or(false);
        if owns_connection {
            peripheral.connect_with_timeout(CONNECT_TIMEOUT).await?;
        }
        let subscribed = async {
            peripheral
                .discover_services_with_timeout(CONNECT_TIMEOUT)
                .await?;
            let characteristic =
                heart_rate_characteristic(&peripheral).ok_or(HeartRateBleError::Incompatible)?;
            let notifications = peripheral.notifications().await?;
            peripheral.subscribe(&characteristic).await?;
            Ok::<_, HeartRateBleError>((characteristic, notifications))
        }
        .await;
        match subscribed {
            Ok((characteristic, notifications)) => Ok(HeartRateBleLink {
                id: peripheral.id(),
                peripheral,
                characteristic,
                notifications,
                events,
                owns_connection,
            }),
            Err(error) => {
                if owns_connection {
                    disconnect(&peripheral).await;
                }
                Err(error)
            }
        }
    }
}

pub enum HeartRateBleEvent {
    Measurement(HeartRateBleMeasurement),
    Disconnected,
}

pub struct HeartRateBleLink {
    id: btleplug::platform::PeripheralId,
    peripheral: Peripheral,
    characteristic: Characteristic,
    notifications: Pin<Box<dyn Stream<Item = ValueNotification> + Send>>,
    events: Pin<Box<dyn Stream<Item = CentralEvent> + Send>>,
    owns_connection: bool,
}

impl HeartRateBleLink {
    pub async fn next_event(&mut self) -> HeartRateBleEvent {
        let measurement = uuid_from_u16(HEART_RATE_MEASUREMENT);
        loop {
            tokio::select! {
                notification = self.notifications.next() => match notification {
                    Some(notification) if notification.uuid == measurement => {
                        if let Some(parsed) = parse_heart_rate_measurement(&notification.value) {
                            return HeartRateBleEvent::Measurement(parsed);
                        }
                    }
                    Some(_) => {}
                    None => return HeartRateBleEvent::Disconnected,
                },
                event = self.events.next() => match event {
                    Some(CentralEvent::DeviceDisconnected(id)) if id == self.id => {
                        return HeartRateBleEvent::Disconnected;
                    }
                    Some(_) => {}
                    None => return HeartRateBleEvent::Disconnected,
                },
            }
        }
    }

    pub async fn close(self) {
        if let Err(error) = self.peripheral.unsubscribe(&self.characteristic).await {
            tracing::debug!(error = %error, "heart rate unsubscribe failed");
        }
        if self.owns_connection {
            disconnect(&self.peripheral).await;
        }
    }
}

async fn disconnect(peripheral: &Peripheral) {
    if let Err(error) = peripheral.disconnect().await {
        tracing::debug!(error = %error, "heart rate disconnect failed");
    }
}

async fn describe(peripheral: Peripheral, system_connected: bool) -> HeartRateBleDevice {
    let properties = peripheral.properties().await.ok().flatten();
    let name = properties
        .as_ref()
        .and_then(|properties| {
            properties
                .local_name
                .clone()
                .or_else(|| properties.advertisement_name.clone())
        })
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    HeartRateBleDevice {
        id: peripheral.id().to_string(),
        name,
        rssi: properties.and_then(|properties| properties.rssi),
        system_connected,
        peripheral,
    }
}

fn heart_rate_characteristic(peripheral: &Peripheral) -> Option<Characteristic> {
    let measurement = uuid_from_u16(HEART_RATE_MEASUREMENT);
    peripheral
        .characteristics()
        .into_iter()
        .find(|characteristic| characteristic.uuid == measurement)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eight_bit_value_with_contact_detected() {
        assert_eq!(
            parse_heart_rate_measurement(&[0b0000_0110, 72]),
            Some(HeartRateBleMeasurement {
                bpm: 72,
                skin_contact: Some(true),
            })
        );
    }

    #[test]
    fn sixteen_bit_value_is_little_endian() {
        assert_eq!(
            parse_heart_rate_measurement(&[0b0000_0001, 0x2C, 0x01]),
            Some(HeartRateBleMeasurement {
                bpm: 300,
                skin_contact: None,
            })
        );
    }

    #[test]
    fn contact_supported_but_not_detected() {
        assert_eq!(
            parse_heart_rate_measurement(&[0b0000_0100, 80]).map(|value| value.skin_contact),
            Some(Some(false))
        );
    }

    #[test]
    fn truncated_packets_are_ignored() {
        assert_eq!(parse_heart_rate_measurement(&[]), None);
        assert_eq!(parse_heart_rate_measurement(&[0]), None);
        assert_eq!(parse_heart_rate_measurement(&[1, 0x2C]), None);
    }
}
