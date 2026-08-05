from datetime import date, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import BigInteger, Boolean, DateTime, Float, Integer
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, VARCHAR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    __abstract__ = True


class EventInstanceExpanded(Base):
    """
    Read-only ORM mapping for the materialized view `event_instance_expanded`.

    This view expands each event instance with series, org hierarchy, location,
    aggregated type/tag indicators, and arrays of names. It is intended for
    querying only and should not be used for inserts/updates.
    """

    __tablename__ = "event_instance_expanded"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer)
    location_id: Mapped[Optional[int]] = mapped_column(Integer)
    series_id: Mapped[Optional[int]] = mapped_column(Integer)
    highlight: Mapped[bool] = mapped_column(Boolean)
    start_date: Mapped[date]
    end_date: Mapped[Optional[date]]
    start_time: Mapped[Optional[str]]
    end_time: Mapped[Optional[str]]
    name: Mapped[str]
    description: Mapped[Optional[str]]
    pax_count: Mapped[Optional[int]]
    fng_count: Mapped[Optional[int]]
    preblast: Mapped[Optional[str]]
    backblast: Mapped[Optional[str]]
    meta: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB)
    created: Mapped[datetime] = mapped_column(DateTime)
    updated: Mapped[datetime] = mapped_column(DateTime)

    series_name: Mapped[Optional[str]]
    series_description: Mapped[Optional[str]]

    ao_org_id: Mapped[Optional[int]] = mapped_column(Integer)
    ao_name: Mapped[Optional[str]]
    ao_description: Mapped[Optional[str]]
    ao_logo_url: Mapped[Optional[str]]
    ao_website: Mapped[Optional[str]]
    ao_meta: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB)

    region_org_id: Mapped[Optional[int]] = mapped_column(Integer)
    region_name: Mapped[Optional[str]]
    region_description: Mapped[Optional[str]]
    region_logo_url: Mapped[Optional[str]]
    region_website: Mapped[Optional[str]]
    region_meta: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB)

    area_org_id: Mapped[Optional[int]] = mapped_column(Integer)
    area_name: Mapped[Optional[str]]
    sector_org_id: Mapped[Optional[int]] = mapped_column(Integer)
    sector_name: Mapped[Optional[str]]

    location_name: Mapped[Optional[str]]
    location_description: Mapped[Optional[str]]
    location_latitude: Mapped[Optional[float]] = mapped_column(Float)
    location_longitude: Mapped[Optional[float]] = mapped_column(Float)

    bootcamp_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    run_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    ruck_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    first_f_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    second_f_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    third_f_ind: Mapped[Optional[int]] = mapped_column(BigInteger)

    pre_workout_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    off_the_books_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    vq_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    convergence_ind: Mapped[Optional[int]] = mapped_column(BigInteger)

    all_types: Mapped[Optional[List[str]]] = mapped_column(ARRAY(VARCHAR))
    all_tags: Mapped[Optional[List[str]]] = mapped_column(ARRAY(VARCHAR))


class EventAttendance(Base):
    """
    Read-only ORM mapping for the materialized view `attendance_expanded`.

    This view expands each event instance with series, org hierarchy, location,
    aggregated type/tag indicators, and arrays of names. It is intended for
    querying only and should not be used for inserts/updates.
    """

    __tablename__ = "attendance_expanded"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer)
    event_instance_id: Mapped[int] = mapped_column(Integer)
    attendance_meta: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    created: Mapped[datetime] = mapped_column(DateTime)
    updated: Mapped[datetime] = mapped_column(DateTime)
    q_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    coq_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    f3_name: Mapped[Optional[str]] = mapped_column(VARCHAR)
    last_name: Mapped[Optional[str]] = mapped_column(VARCHAR)
    email: Mapped[Optional[str]] = mapped_column(VARCHAR)
    home_region_id: Mapped[Optional[int]] = mapped_column(Integer)
    home_region_name: Mapped[Optional[str]] = mapped_column(VARCHAR)
    avatar_url: Mapped[Optional[str]] = mapped_column(VARCHAR)
    user_status: Mapped[Optional[str]] = mapped_column(VARCHAR)
    start_date: Mapped[Optional[date]] = mapped_column(DateTime)
