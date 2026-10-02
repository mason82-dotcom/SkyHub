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


settings = Settings()
