const { randomUUID } = require('crypto');

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;
const MISSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
const DJI_TOPIC_PATTERN = /^thing\/product\/([^/]+)\/(osd|state|events|services_reply)$/;
const MAX_MQTT_PAYLOAD_BYTES = 256 * 1024;

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value, minimum, maximum) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) && number >= minimum && number <= maximum
        ? number
        : undefined;
}

function firstNumber(candidates, minimum, maximum) {
    for (const value of candidates) {
        const parsed = finiteNumber(value, minimum, maximum);
        if (parsed !== undefined) return parsed;
    }
    return undefined;
}

function parseDjiMessage(topic, payload) {
    const match = DJI_TOPIC_PATTERN.exec(topic);
    if (!match || !DEVICE_ID_PATTERN.test(match[1])) {
        throw new Error('Nicht unterstütztes DJI-MQTT-Topic');
    }
    if (!Buffer.isBuffer(payload) || payload.length === 0 || payload.length > MAX_MQTT_PAYLOAD_BYTES) {
        throw new Error('DJI-MQTT-Payload ist leer oder zu groß');
    }

    const envelope = JSON.parse(payload.toString('utf8'));
    if (!isRecord(envelope) || !isRecord(envelope.data)) {
        throw new Error('DJI-MQTT-Envelope enthält kein data-Objekt');
    }

    const deviceSn = match[1];
    const channel = match[2];
    const gatewaySn = typeof envelope.gateway === 'string' && DEVICE_ID_PATTERN.test(envelope.gateway)
        ? envelope.gateway
        : deviceSn;

    return {
        channel,
        deviceSn,
        gatewaySn,
        tid: typeof envelope.tid === 'string' ? envelope.tid : undefined,
        bid: typeof envelope.bid === 'string' ? envelope.bid : undefined,
        method: typeof envelope.method === 'string' ? envelope.method : undefined,
        timestamp: finiteNumber(envelope.timestamp, 0, Number.MAX_SAFE_INTEGER),
        data: envelope.data
    };
}

function normalizeTelemetry(message, receivedAt = Date.now()) {
    const data = message.data;
    const battery = isRecord(data.battery) ? data.battery : {};
    const positionState = isRecord(data.position_state) ? data.position_state : {};

    const telemetry = {
        deviceSn: message.deviceSn,
        gatewaySn: message.gatewaySn,
        receivedAt,
        sourceTimestamp: message.timestamp,
        latitude: firstNumber([data.latitude], -90, 90),
        longitude: firstNumber([data.longitude], -180, 180),
        altitude: firstNumber([data.height, data.elevation, data.altitude], -1000, 20000),
        battery: firstNumber(
            [data.battery_percentage, data.capacity_percent, battery.capacity_percent],
            0,
            100
        ),
        rtkFixed: firstNumber([positionState.is_fixed], 0, 2),
        satellites: firstNumber(
            [positionState.gps_number, positionState.rtk_number, data.gps_number],
            0,
            200
        )
    };

    return Object.fromEntries(
        Object.entries(telemetry).filter(([, value]) => value !== undefined)
    );
}

function validateDeviceId(value) {
    return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}

function buildFlightTaskRequest({ gatewaySn, missionId, kmzUrl, fileSign, allowedOrigins }) {
    if (!validateDeviceId(gatewaySn)) throw new Error('Ungültige Gateway-SN');
    if (typeof missionId !== 'string' || !MISSION_ID_PATTERN.test(missionId)) {
        throw new Error('Ungültige Missions-ID');
    }
    if (typeof fileSign !== 'string' || !/^[a-f0-9]{32}$/i.test(fileSign)) {
        throw new Error('fileSign muss eine MD5-Prüfsumme mit 32 Hex-Zeichen sein');
    }

    let url;
    try {
        url = new URL(kmzUrl);
    } catch {
        throw new Error('Ungültige KMZ-URL');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('KMZ-URL muss HTTP oder HTTPS verwenden');
    }
    if (!Array.isArray(allowedOrigins) || !allowedOrigins.includes(url.origin)) {
        throw new Error('KMZ-URL liegt außerhalb der erlaubten Origin');
    }

    const tid = randomUUID();
    const bid = randomUUID();
    return {
        topic: `thing/product/${gatewaySn}/services`,
        tid,
        bid,
        payload: {
            tid,
            bid,
            timestamp: Date.now(),
            method: 'flighttask_create',
            data: {
                flight_id: missionId,
                type: 'wayline',
                file: { url: url.toString(), sign: fileSign.toLowerCase() }
            }
        }
    };
}

module.exports = {
    MAX_MQTT_PAYLOAD_BYTES,
    buildFlightTaskRequest,
    normalizeTelemetry,
    parseDjiMessage,
    validateDeviceId
};
