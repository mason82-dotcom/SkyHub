(() => {
  'use strict';

  const elements = Object.fromEntries(
    [
      'connection-status', 'altitude', 'altitude-state', 'battery', 'battery-state',
      'rtk', 'satellites', 'age', 'freshness', 'latitude', 'longitude',
      'position-quality', 'device-sn', 'gateway-sn', 'received-at', 'empty-state'
    ].map((id) => [id, document.getElementById(id)])
  );

  let lastTelemetry = null;
  const socket = window.io({ transports: ['websocket', 'polling'], timeout: 8000 });

  function setConnection(label, state) {
    const status = elements['connection-status'];
    status.className = `status-pill status-pill--${state}`;
    status.lastElementChild.textContent = label;
  }

  function formatNumber(value, digits = 1) {
    return Number.isFinite(Number(value))
      ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(Number(value))
      : '–';
  }

  function rtkLabel(value) {
    if (Number(value) === 2) return 'RTK FIX';
    if (Number(value) === 1) return 'NICHT FIXIERT';
    if (Number(value) === 0) return 'KEIN FIX';
    return '–';
  }

  function render(telemetry) {
    lastTelemetry = telemetry;
    elements['empty-state'].hidden = true;
    elements.altitude.textContent = formatNumber(telemetry.altitude);
    elements['altitude-state'].textContent = telemetry.altitude === undefined ? 'Nicht gemeldet' : 'DJI OSD';
    elements.battery.textContent = formatNumber(telemetry.battery, 0);
    elements['battery-state'].textContent = telemetry.battery === undefined ? 'Nicht gemeldet' : 'Kapazität';
    elements.rtk.textContent = rtkLabel(telemetry.rtkFixed);
    elements.satellites.textContent = `Satelliten: ${formatNumber(telemetry.satellites, 0)}`;
    elements.latitude.textContent = formatNumber(telemetry.latitude, 7);
    elements.longitude.textContent = formatNumber(telemetry.longitude, 7);
    elements['position-quality'].textContent = Number(telemetry.rtkFixed) === 2 ? 'RTK FIX' : 'NICHT BESTÄTIGT';
    elements['device-sn'].textContent = telemetry.deviceSn || '–';
    elements['gateway-sn'].textContent = telemetry.gatewaySn || '–';
    elements['received-at'].textContent = new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'short', timeStyle: 'medium'
    }).format(new Date(telemetry.receivedAt));
    updateAge();
  }

  function updateAge() {
    if (!lastTelemetry) return;
    const seconds = Math.max(0, Math.floor((Date.now() - Number(lastTelemetry.receivedAt)) / 1000));
    elements.age.textContent = String(seconds);
    elements.freshness.textContent = seconds <= 5 ? 'Frisch' : seconds <= 15 ? 'Verzögert' : 'Veraltet';
    if (seconds > 15) setConnection('Telemetrie veraltet', 'stale');
  }

  socket.on('connect', () => setConnection('Verbunden · wartet auf Daten', 'waiting'));
  socket.on('disconnect', () => setConnection('Backend getrennt', 'offline'));
  socket.on('connect_error', () => setConnection('Backend nicht erreichbar', 'offline'));
  socket.on('telemetry_update', (telemetry) => {
    if (!telemetry || typeof telemetry !== 'object') return;
    setConnection('Telemetrie live', 'live');
    render(telemetry);
  });

  window.setInterval(updateAge, 1000);
})();
