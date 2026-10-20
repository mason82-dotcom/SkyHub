const test = require('node:test');
const assert = require('node:assert/strict');

const {
    MAX_MQTT_PAYLOAD_BYTES,
    buildFlightTaskRequest,
    normalizeTelemetry,
    parseDjiMessage
} = require('../lib/dji');

test('DJI OSD envelope is parsed and normalized without inventing values', () => {
    const payload = Buffer.from(JSON.stringify({
        tid: 'tx-1',
        gateway: 'RC123456',
        timestamp: 1720000000000,
        data: {
            latitude: 51.1234567,
            longitude: 10.7654321,
            height: 0,
            battery: { capacity_percent: 87 },
            position_state: { is_fixed: 2, gps_number: 19 }
        }
    }));

    const message = parseDjiMessage('thing/product/DRONE123/osd', payload);
    const telemetry = normalizeTelemetry(message, 1720000000100);

    assert.equal(message.deviceSn, 'DRONE123');
    assert.equal(message.gatewaySn, 'RC123456');
    assert.equal(telemetry.altitude, 0);
    assert.equal(telemetry.battery, 87);
    assert.equal(telemetry.rtkFixed, 2);
    assert.equal(telemetry.satellites, 19);
});

test('invalid topics, envelopes and oversized MQTT payloads fail closed', () => {
    assert.throws(
        () => parseDjiMessage('thing/product/DRONE123/status', Buffer.from('{}')),
        /Topic/
    );
    assert.throws(
        () => parseDjiMessage('thing/product/DRONE123/osd', Buffer.from('{}')),
        /data-Objekt/
    );
    assert.throws(
        () => parseDjiMessage('thing/product/DRONE123/osd', Buffer.alloc(MAX_MQTT_PAYLOAD_BYTES + 1)),
        /zu groß/
    );
});

test('mission request uses DJI services topic, UUIDs and allowed origin', () => {
    const request = buildFlightTaskRequest({
        gatewaySn: 'RC123456',
        missionId: 'mission-42',
        kmzUrl: 'https://media.example.test/mission.kmz',
        fileSign: '0123456789abcdef0123456789abcdef',
        allowedOrigins: ['https://media.example.test']
    });

    assert.equal(request.topic, 'thing/product/RC123456/services');
    assert.equal(request.payload.method, 'flighttask_create');
    assert.equal(request.payload.data.file.url, 'https://media.example.test/mission.kmz');
    assert.match(request.tid, /^[0-9a-f-]{36}$/);
    assert.throws(
        () => buildFlightTaskRequest({
            gatewaySn: 'RC123456',
            missionId: 'mission-42',
            kmzUrl: 'https://other.example.test/mission.kmz',
            fileSign: '0123456789abcdef0123456789abcdef',
            allowedOrigins: ['https://media.example.test']
        }),
        /erlaubten Origin/
    );
});
