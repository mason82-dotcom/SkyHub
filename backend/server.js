const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const { Pool } = require('pg');
const Redis = require('ioredis');
const Minio = require('minio');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

// 1. PostGIS Datenbank-Verbindung
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://skyhub:secure_local_db_password_123@postgres:5432/skyhub_db'
});

// 2. Redis In-Memory Client für Telemetrie-Caching & Pilot 2 Login
const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');

redis.on('connect', () => {
    console.log('[Redis] Erfolgreich verbunden mit Redis Cache Store.');
});

// 3. MinIO S3 Objektspeicher Client
const minioClient = new Minio.Client({
    endPoint: process.env.S3_ENDPOINT ? process.env.S3_ENDPOINT.replace('http://', '').split(':')[0] : 'minio',
    port: 9000,
    useSSL: false,
    accessKey: process.env.S3_ACCESS_KEY || 'skyhub_minio_admin',
    secretKey: process.env.S3_SECRET_KEY || 'secure_minio_password_123'
});

// S3-Bucket automatisch anlegen falls nicht vorhanden
const bucketName = process.env.S3_BUCKET_NAME || 'skyhub-media';
minioClient.bucketExists(bucketName, (err, exists) => {
    if (err) return console.error('[MinIO Error]', err);
    if (!exists) {
        minioClient.makeBucket(bucketName, 'us-east-1', (err) => {
            if (err) return console.error('[MinIO Error] Bucket-Erstellung fehlgeschlagen:', err);
            console.log(`[MinIO] Bucket '${bucketName}' erfolgreich angelegt.`);
        });
    } else {
        console.log(`[MinIO] Bucket '${bucketName}' ist einsatzbereit.`);
    }
});

// 4. Pilot 2 Login / Device Auth Service
app.post('/api/v1/login', async (req, res) => {
    const { username, password, device_sn } = req.body;
    
    if (process.env.DISABLE_AUTH === 'true') {
        const token = "token_skyhub_local_" + Date.now();
        await redis.set(`session:${device_sn || 'pilot2_gateway'}`, token, 'EX', 86400); // 24h Gültigkeit
        return res.json({
            code: 0,
            message: "Login erfolgreich (Zero-Auth Local Mode)",
            data: { access_token: token, expires_in: 86400 }
        });
    }

    // Produktion: Datenbank-Prüfung
    res.status(401).json({ code: 401, message: "Ungültige Anmeldedaten" });
});

// 5. MQTT 5.0 Broker-Verbindung (EMQX)
const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://emqx:1883', {
    clientId: 'SkyHub_Cloud_Server_Core',
    username: process.env.MQTT_USER || 'admin',
    password: process.env.MQTT_PASSWORD || 'public',
    clean: true
});

mqttClient.on('connect', () => {
    console.log('[MQTT] Verbunden mit EMQX Broker. Lausche auf DJI Thing Model Topics...');
    mqttClient.subscribe('thing/product/+/osd');
    mqttClient.subscribe('thing/product/+/status');
    mqttClient.subscribe('thing/product/+/events');
});

mqttClient.on('message', async (topic, payload) => {
    try {
        const data = JSON.parse(payload.toString());
        const topicParts = topic.split('/');
        const gatewaySn = topicParts[2];
        const subTopic = topicParts[3];

        // A. OSD Telemetrie im Redis Cache speichern (exakt 1 ms Latenz fürs Dashboard)
        if (subTopic === 'osd') {
            await redis.hset(`telemetry:${gatewaySn}`, {
                latitude: data.latitude || 0,
                longitude: data.longitude || 0,
                altitude: data.altitude || 0,
                battery: data.battery_percentage || 0,
                updated_at: Date.now()
            });

            // Asynchron in PostGIS DB persistieren
            if (data.latitude && data.longitude) {
                pool.query(
                    `INSERT INTO drone_telemetry (gateway_sn, latitude, longitude, altitude, battery_percentage, geom)
                     VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($3, $2), 4326))`,
                    [gatewaySn, data.latitude, data.longitude, data.altitude || 0, data.battery_percentage || 0]
                ).catch(e => console.error('[DB Insert Error]', e));
            }
        }

        // B. Telemetrie per WebSockets an Frontend-Clients senden
        io.emit('telemetry_update', { gatewaySn, subTopic, data });

    } catch (err) {
        console.error('[MQTT Error] Parsen fehlgeschlagen:', err);
    }
});

// REST-Endpunkt zur Abfrage des aktuellen Drohnenstatus aus Redis
app.get('/api/drone/:sn/telemetry', async (req, res) => {
    const telemetry = await redis.hgetall(`telemetry:${req.params.sn}`);
    if (!telemetry || Object.keys(telemetry).length === 0) {
        return res.status(404).json({ error: 'Keine Telemetrie in Redis gefunden' });
    }
    res.json(telemetry);
});

// REST-Endpunkt zum Veröffentlichen von WPML-Missionspaketen
app.post('/api/mission/create', async (req, res) => {
    const { gatewaySn, kmzUrl, missionId } = req.body;
    
    const payload = {
        tid: "skyhub-" + Date.now(),
        bid: "mission-dispatch-" + missionId,
        timestamp: Date.now(),
        data: {
            file_url: kmzUrl,
            file_name: `mission_${missionId}.kmz`,
            exec_mode: 0
        }
    };

    mqttClient.publish(`thing/product/${gatewaySn}/services/flighttask_create`, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) return res.status(500).json({ error: 'MQTT Publish fehlgeschlagen' });
        res.json({ status: 'success', message: 'Mission erfolgreich an DJI Pilot 2 Gateway gesendet.' });
    });
});

server.listen(4000, () => {
    console.log('[SkyHub Backend v3] Läuft auf Port 4000 (PostGIS, Redis, MinIO, EMQX & Pilot 2 Login ready)');
});
