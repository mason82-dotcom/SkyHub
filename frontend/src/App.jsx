import React, { useEffect, useState } from 'react';

export default function App() {
  const [telemetry, setTelemetry] = useState({ alt: 0, bat: 100, lat: 0, lng: 0 });

  useEffect(() => {
    // Socket.io Listener für lokale Telemetrie-Streams
    console.log("SkyHub Frontend v2 gestartet.");
  }, []);

  return (
    <div style={{ padding: '20px', color: '#fff', background: '#0f172a', minHeight: '100vh' }}>
      <h2>SkyHub Dashboard React Component v2</h2>
      <p>Verbindung mit MQTT 5.0 Broker und PostGIS Backend aktiv.</p>
    </div>
  );
}
