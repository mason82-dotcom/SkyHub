import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

# BIGSERIAL in Postgres, INTEGER PK in SQLite (lokale Tests)
BigId = BigInteger().with_variant(Integer, "sqlite")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


class Device(Base):
    __tablename__ = "devices"
    sn: Mapped[str] = mapped_column(String(64), primary_key=True)
    domain: Mapped[int] = mapped_column(Integer)
    type: Mapped[int] = mapped_column(Integer)
    sub_type: Mapped[int] = mapped_column(Integer)
    gateway_sn: Mapped[str | None] = mapped_column(String(64), nullable=True)
    callsign: Mapped[str | None] = mapped_column(String(128), nullable=True)
    thing_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def model_key(self) -> str:
        return f"{self.domain}-{self.type}-{self.sub_type}"


class TelemetryPoint(Base):
    __tablename__ = "telemetry"
    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    sn: Mapped[str] = mapped_column(String(64))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    height: Mapped[float | None] = mapped_column(Float, nullable=True)
    elevation: Mapped[float | None] = mapped_column(Float, nullable=True)
    heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    h_speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    v_speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    battery: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mode_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    __table_args__ = (Index("ix_tel_sn_ts", "sn", "ts"),)


class MediaFile(Base):
    __tablename__ = "media_files"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    fingerprint: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    tiny_fingerprint: Mapped[str | None] = mapped_column(String(256), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(256))
    path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    object_key: Mapped[str] = mapped_column(String(512))
    drone_sn: Mapped[str | None] = mapped_column(String(64), nullable=True)
    drone_model_key: Mapped[str | None] = mapped_column(String(32), nullable=True)
    payload_model_key: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_original: Mapped[bool] = mapped_column(Boolean, default=True)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Wayline(Base):
    __tablename__ = "waylines"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(256), index=True)
    object_key: Mapped[str] = mapped_column(String(512))
    drone_model_key: Mapped[str] = mapped_column(String(32))
    payload_model_keys: Mapped[list] = mapped_column(JSON, default=list)
    template_types: Mapped[list] = mapped_column(JSON, default=list)
    favorited: Mapped[bool] = mapped_column(Boolean, default=False)
    user_name: Mapped[str] = mapped_column(String(64), default="")
    updated: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MapElement(Base):
    __tablename__ = "map_elements"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    group_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(256), default="")
    resource: Mapped[dict] = mapped_column(JSON, default=dict)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class HmsEvent(Base):
    __tablename__ = "hms_events"
    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    sn: Mapped[str] = mapped_column(String(64), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
