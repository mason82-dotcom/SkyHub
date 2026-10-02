import uuid

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    public_host: str = "192.168.178.30"
    http_port: int = 8080

    workspace_id: str = "e3dea0f5-37f2-4d79-ae58-490af3228069"
    workspace_name: str = "Leitstand"
    platform_name: str = "SkyHub OnPrem"

    dji_app_id: str = ""
    dji_app_key: str = ""
    dji_app_license: str = ""

    admin_user: str = "admin"
    admin_password: str = "change-me"
    jwt_secret: str = "change-me"
    jwt_ttl_hours: int = 168
    ws_token_ttl_seconds: int = 120

    mqtt_host: str = "mosquitto"
    mqtt_port: int = 1883
    mqtt_backend_user: str = "backend"
    mqtt_backend_password: str = ""
    mqtt_pilot_user: str = "pilot"
    mqtt_pilot_password: str = ""

    db_url: str = "postgresql+asyncpg://skyhub:skyhub@postgres:5432/skyhub"

    minio_internal_endpoint: str = "http://minio:9000"
    minio_public_port: int = 9000
    minio_bucket: str = "skyhub"
    minio_sts_user: str = ""
    minio_sts_password: str = ""

    rtmp_port: int = 1935
    webrtc_port: int = 8889

    telemetry_interval_s: float = 1.0
    offline_timeout_s: int = 30

    @property
    def api_base(self) -> str:
        return f"http://{self.public_host}:{self.http_port}"

    @property
    def ws_base(self) -> str:
        return f"ws://{self.public_host}:{self.http_port}"

    @property
    def mqtt_public(self) -> str:
        return f"tcp://{self.public_host}:1883"

    @property
    def minio_public_endpoint(self) -> str:
        return f"http://{self.public_host}:{self.minio_public_port}"


class RuntimeConfigError(RuntimeError):
    pass


_PLACEHOLDER_SECRETS = {
    "",
    "change-me",
    "bitte-aendern",
    "bitte-langen-zufallswert-setzen",
    "bitte-aendern-min-8-zeichen",
}


def _secret_error(errors: list[str], name: str, value: str, min_length: int) -> None:
    if value in _PLACEHOLDER_SECRETS or len(value) < min_length:
        errors.append(f"{name} muss gesetzt und mindestens {min_length} Zeichen lang sein")


def validate_runtime_settings(cfg: Settings) -> None:
    errors: list[str] = []

    try:
        workspace = uuid.UUID(cfg.workspace_id)
        if str(workspace) != cfg.workspace_id:
            errors.append("WORKSPACE_ID muss eine kanonische UUID in Kleinbuchstaben sein")
    except (ValueError, AttributeError):
        errors.append("WORKSPACE_ID muss eine gueltige UUID sein")

    if not cfg.public_host or "://" in cfg.public_host:
        errors.append("PUBLIC_HOST muss ein Hostname oder eine IP ohne URL-Schema sein")
    if not 1 <= cfg.http_port <= 65535:
        errors.append("HTTP_PORT liegt ausserhalb 1..65535")
    if not 1 <= cfg.mqtt_port <= 65535:
        errors.append("MQTT_PORT liegt ausserhalb 1..65535")
    if not 1 <= cfg.minio_public_port <= 65535:
        errors.append("MINIO_PUBLIC_PORT liegt ausserhalb 1..65535")

    for name, value in (
        ("DJI_APP_ID", cfg.dji_app_id),
        ("DJI_APP_KEY", cfg.dji_app_key),
        ("DJI_APP_LICENSE", cfg.dji_app_license),
        ("ADMIN_USER", cfg.admin_user),
        ("MQTT_BACKEND_USER", cfg.mqtt_backend_user),
        ("MQTT_PILOT_USER", cfg.mqtt_pilot_user),
        ("MINIO_STS_USER", cfg.minio_sts_user),
        ("MINIO_BUCKET", cfg.minio_bucket),
    ):
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{name} muss gesetzt sein")

    _secret_error(errors, "ADMIN_PASSWORD", cfg.admin_password, 12)
    _secret_error(errors, "JWT_SECRET", cfg.jwt_secret, 32)
    _secret_error(errors, "MQTT_BACKEND_PASSWORD", cfg.mqtt_backend_password, 12)
    _secret_error(errors, "MQTT_PILOT_PASSWORD", cfg.mqtt_pilot_password, 12)
    _secret_error(errors, "MINIO_STS_PASSWORD", cfg.minio_sts_password, 12)

    if cfg.mqtt_backend_user == cfg.mqtt_pilot_user:
        errors.append("MQTT_BACKEND_USER und MQTT_PILOT_USER muessen verschieden sein")
    if not 1 <= cfg.jwt_ttl_hours <= 720:
        errors.append("JWT_TTL_HOURS muss zwischen 1 und 720 liegen")
    if not 30 <= cfg.ws_token_ttl_seconds <= 3600:
        errors.append("WS_TOKEN_TTL_SECONDS muss zwischen 30 und 3600 liegen")
    if cfg.telemetry_interval_s <= 0:
        errors.append("TELEMETRY_INTERVAL_S muss groesser 0 sein")
    if cfg.offline_timeout_s < 5:
        errors.append("OFFLINE_TIMEOUT_S muss mindestens 5 Sekunden betragen")

    if errors:
        raise RuntimeConfigError("Ungueltige SkyHub-Konfiguration: " + "; ".join(errors))


settings = Settings()
