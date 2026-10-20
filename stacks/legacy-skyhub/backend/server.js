const { randomBytes } = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const { Pool } = require('pg');
const Redis = require('ioredis');
require('dotenv').config();

const {
    buildFlightTaskRequest,
    normalizeTelemetry,
    parseDjiMessage,
    validateDeviceId
} = require('./lib/dji');
const { requireAdminToken, safeEqual } = require('./lib/security');

const PORT = Number.parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const TELEMETRY_TTL_SECONDS = 300;
const PUBLIC_DIR = path.resolve(process.env.SKYHUB_FRONTEND_DIR || path.join(__dirname, 'public'));

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT muss zwischen 1 und 65535 liegen');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL fehlt');
if (!process.env.REDIS_URL) throw new Error('REDIS_URL fehlt');
if (!process.env.MQTT_BROKER_URL) throw new Error('MQTT_BROKER_URL fehlt');
if (!process.env.MQTT_USER || !process.env.MQTT_PASSWORD) {
    throw new Error('MQTT_USER und MQTT_PASSWORD sind erforderlich');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        if (!origin) return callback(null, true);
        try {
            callback(null, new URL(origin).host === request.headers.host);
        } catch {
            callback(null, false);
        }
    }
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true
});
const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL, {
    clientId: `skyhub-core-${randomBytes(6).toString('hex')}`,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
    clean: true,
    reconnectPeriod: 2000,
    connectTimeout: 10000
});

const asyncRoute = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
};
const withTimeout = (promise, milliseconds) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), milliseconds))
]);

app.disable('x-powered-by');
app.use((req, res, next) => {
    res.set({
        'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; script-src 'self'; style-src 'self'",
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
    });
    next();
});
app.use(express.json({ limit: '64kb', strict: true }));

redis.on('connect', () => console.log('[Redis] Verbunden.'));
redis.on('error', (error) => console.error('[Redis]', error.message));
pool.on('error', (error) => console.error('[Postgres]', error.message));

mqttClient.on('connect', () => {
    const topics = [
        'thing/product/+/osd',
        'thing/product/+/state',
        'thing/product/+/events',
        'thing/product/+/services_reply'
    ];
    mqttClient.subscribe(topics, { qos: 1 }, (error) => {
        if (error) console.error('[MQTT] Subscription fehlgeschlagen:', error.message);
        else console.log('[MQTT] DJI-Telemetriekanäle abonniert.');
    });
});
mqttClient.on('error', (error) => console.error('[MQTT]', error.message));

mqttClient.on('message', async (topic, payload) => {
    try {
        const message = parseDjiMessage(topic, payload);

        if (message.channel === 'osd') {
            const telemetry = normalizeTelemetry(message);
            const redisFields = Object.fromEntries(
                Object.entries(telemetry).map(([key, value]) => [key, String(value)])
            );
            await redis.multi()
                .hset(`telemetry:${message.deviceSn}`, redisFields)
                .expire(`telemetry:${message.deviceSn}`, TELEMETRY_TTL_SECONDS)
                .exec();

            if (telemetry.latitude !== undefined && telemetry.longitude !== undefined) {
                pool.query(
                    `INSERT INTO drone_telemetry
                        (gateway_sn, latitude, longitude, altitude, battery_percentage, geom)
                     VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($3, $2), 4326))`,
                    [
                        message.gatewaySn,
                        telemetry.latitude,
                        telemetry.longitude,
                        telemetry.altitude ?? null,
                        telemetry.battery ?? null
                    ]
                ).catch((error) => console.error('[Postgres] Telemetrie:', error.message));
            }
            io.emit('telemetry_update', telemetry);
        } else if (message.channel === 'services_reply') {
            io.emit('mission_reply', {
                tid: message.tid,
                bid: message.bid,
                method: message.method,
                result: message.data.result
            });
        }
    } catch (error) {
        console.error('[MQTT] Nachricht verworfen:', error.message);
    }
});

const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip;
    const recent = (loginAttempts.get(key) || []).filter((timestamp) => now - timestamp < 60_000);
    if (recent.length >= 10) {
        return res.status(429).json({ code: 429, message: 'Zu viele Anmeldeversuche' });
    }
    recent.push(now);
    loginAttempts.set(key, recent);
    next();
}

app.get('/api/v1/health', asyncRoute(async (_req, res) => {
    const checks = await Promise.allSettled([
        withTimeout(redis.ping(), 2000),
        withTimeout(pool.query('SELECT 1'), 2000)
    ]);
    const healthy = checks.every((result) => result.status === 'fulfilled') && mqttClient.connected;
    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        postgres: checks[1].status === 'fulfilled',
        redis: checks[0].status === 'fulfilled',
        mqtt: mqttClient.connected,
        missionDispatch: process.env.MISSION_DISPATCH_ENABLED === 'true' ? 'enabled' : 'disabled'
    });
}));

app.post('/api/v1/login', loginRateLimit, asyncRoute(async (req, res) => {
    const { username, password, device_sn: deviceSn } = req.body || {};
    const expectedUser = process.env.PILOT_USERNAME;
    const expectedPassword = process.env.PILOT_PASSWORD;
    if (!expectedUser || !expectedPassword || expectedPassword.length < 16) {
        return res.status(503).json({ code: 503, message: 'Pilot-Anmeldung ist nicht konfiguriert' });
    }
    if (!safeEqual(username, expectedUser) || !safeEqual(password, expectedPassword)) {
        return res.status(401).json({ code: 401, message: 'Ungültige Anmeldedaten' });
    }
    const sessionDevice = validateDeviceId(deviceSn) ? deviceSn : 'pilot2-gateway';
    const token = randomBytes(32).toString('base64url');
    await redis.set(`session:${sessionDevice}`, token, 'EX', 3600);
    res.json({ code: 0, message: 'Login erfolgreich', data: { access_token: token, expires_in: 3600 } });
}));

app.get('/api/drone/:sn/telemetry', asyncRoute(async (req, res) => {
    if (!validateDeviceId(req.params.sn)) {
        return res.status(400).json({ error: 'Ungültige Geräte-SN' });
    }
    const telemetry = await redis.hgetall(`telemetry:${req.params.sn}`);
    if (!telemetry || Object.keys(telemetry).length === 0) {
        return res.status(404).json({ error: 'Keine frische Telemetrie gefunden' });
    }
    res.set('Cache-Control', 'no-store').json(telemetry);
}));

app.post(
    '/api/mission/create',
    (req, res, next) => {
        if (process.env.MISSION_DISPATCH_ENABLED !== 'true') {
            return res.status(503).json({ error: 'Missionsübertragung ist sicherheitshalber deaktiviert' });
        }
        next();
    },
    requireAdminToken(process.env.SKYHUB_ADMIN_TOKEN),
    asyncRoute(async (req, res) => {
        const allowedOrigins = (process.env.MISSION_FILE_ALLOWED_ORIGINS || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
        let request;
        try {
            request = buildFlightTaskRequest({ ...req.body, allowedOrigins });
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
        await new Promise((resolve, reject) => {
            mqttClient.publish(request.topic, JSON.stringify(request.payload), { qos: 1 }, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
        res.status(202).json({
            status: 'queued',
            message: 'Anfrage an den Broker übergeben; Gerätebestätigung steht noch aus.',
            tid: request.tid,
            bid: request.bid
        });
    })
);

app.use('/api', (_req, res) => res.status(404).json({ error: 'API-Endpunkt nicht gefunden' }));
app.use(express.static(PUBLIC_DIR, { fallthrough: true, index: 'index.html', maxAge: '1h' }));
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use((error, _req, res, _next) => {
    console.error('[HTTP]', error.message);
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Ungültiges JSON' });
    res.status(500).json({ error: 'Interner Serverfehler' });
});

server.listen(PORT, HOST, () => {
    console.log(`[SkyHub] Backend auf ${HOST}:${PORT}; Missionsübertragung ${process.env.MISSION_DISPATCH_ENABLED === 'true' ? 'AKTIV' : 'deaktiviert'}.`);
});

async function shutdown(signal) {
    console.log(`[SkyHub] ${signal}: fahre kontrolliert herunter.`);
    mqttClient.end(true);
    server.close();
    await Promise.allSettled([redis.quit(), pool.end()]);
    process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
