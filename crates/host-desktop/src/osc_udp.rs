use std::io;
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};

#[derive(Default)]
pub struct OscUdpSender {
    socket: Option<UdpSocket>,
    target: Option<(String, u16, SocketAddr)>,
}

impl OscUdpSender {
    pub fn send(&mut self, host: &str, port: u16, payload: &[u8]) -> io::Result<()> {
        let address = match &self.target {
            Some((cached_host, cached_port, address))
                if cached_host == host && *cached_port == port =>
            {
                *address
            }
            _ => {
                let address = (host, port).to_socket_addrs()?.next().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::NotFound, "OSC host did not resolve")
                })?;
                self.target = Some((host.to_string(), port, address));
                address
            }
        };
        let socket = match &mut self.socket {
            Some(socket) => socket,
            socket => socket.insert(UdpSocket::bind(("0.0.0.0", 0))?),
        };
        socket.send_to(payload, address).map(|_| ())
    }
}
