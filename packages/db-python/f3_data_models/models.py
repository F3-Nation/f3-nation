import enum
from datetime import date, datetime, time
from typing import Any, Dict, List, Optional

from citext import CIText
from sqlalchemy import (
    ARRAY,
    JSON,
    REAL,
    TEXT,
    TIME,
    UUID,
    VARCHAR,
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    UniqueConstraint,
    Uuid,
    func,
    inspect,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)
from sqlalchemy.orm.attributes import InstrumentedAttribute
from typing_extensions import Annotated

# Custom Annotations
time_notz = Annotated[time, TIME(timezone=False)]
time_with_tz = Annotated[time, TIME(timezone=True)]
ts_notz = Annotated[datetime, DateTime(timezone=False)]
text = Annotated[str, TEXT]
intpk = Annotated[int, mapped_column(Integer, primary_key=True, autoincrement=True)]
dt_create = Annotated[datetime, mapped_column(DateTime, server_default=func.timezone("utc", func.now()))]
dt_update = Annotated[
    datetime,
    mapped_column(
        DateTime,
        server_default=func.timezone("utc", func.now()),
        server_onupdate=func.timezone("utc", func.now()),
    ),
]


class Codex_Submission_Status(enum.Enum):
    """
    Enum representing the status of a codex submission.

    Attributes:
        pending
        approved
        rejected
    """

    pending = 1
    approved = 2
    rejected = 3


class User_Status(enum.Enum):
    """
    Enum representing the status of a user.

    Attributes:
        active
        inactive
        deleted
    """

    active = 1
    inactive = 2
    deleted = 3


class Region_Role(enum.Enum):
    """
    Enum representing the roles within a region.

    Attributes:
        user
        editor
        admin
    """

    user = 1
    editor = 2
    admin = 3


class User_Role(enum.Enum):
    """
    Enum representing the roles of a user.

    Attributes:
        user
        editor
        admin
    """

    user = 1
    editor = 2
    admin = 3


class Update_Request_Status(enum.Enum):
    """
    Enum representing the status of an update request.

    Attributes:
        pending
        approved
        rejected
    """

    pending = 1
    approved = 2
    rejected = 3


class Day_Of_Week(enum.Enum):
    """
    Enum representing the days of the week.
    """

    monday = 0
    tuesday = 1
    wednesday = 2
    thursday = 3
    friday = 4
    saturday = 5
    sunday = 6


class Event_Cadence(enum.Enum):
    """
    Enum representing the cadence of an event.

    Attributes:
        weekly
        monthly
    """

    weekly = 1
    monthly = 2


class Achievement_Cadence(enum.Enum):
    """
    Enum representing the cadence of an achievement.

    Attributes:
        weekly
        monthly
        quarterly
        yearly
        lifetime
    """

    weekly = 1
    monthly = 2
    quarterly = 3
    yearly = 4
    lifetime = 5


class Org_Type(enum.Enum):
    """
    Enum representing the type of organization.

    Attributes:
        ao
        region
        area
        sector
        nation
    """

    ao = 1
    region = 2
    area = 3
    sector = 4
    nation = 5


class Event_Category(enum.Enum):
    """
    Enum representing the category of an event.

    Attributes:
        first_f
        second_f
        third_f
    """

    first_f = 1
    second_f = 2
    third_f = 3


class Request_Type(enum.Enum):
    """
    Enum representing the type of request.

    Attributes:
        create_location
        create_event
        edit
        delete_event
    """

    create_location = 1
    create_event = 2
    edit = 3
    delete_event = 4


class Series_Exception(enum.Enum):
    """
    Enum representing exceptions to an event series.

    Attributes:
        none
        skip
        reschedule
    """

    closed = 1
    different_time = 2
    miscellaneous = 3


class Base(DeclarativeBase):
    """
    Base class for all models, providing common methods.

    Methods:
        get_id: Get the primary key of the model.
        get: Get the value of a specified attribute.
        to_json: Convert the model instance to a JSON-serializable dictionary.
        __repr__: Get a string representation of the model instance.
        _update: Update the model instance with the provided fields.
    """

    type_annotation_map = {
        Dict[str, Any]: JSON,
    }

    def get_id(self):
        """
        Get the primary key of the model.

        Returns:
            int: The primary key of the model.
        """
        return self.id

    def get(self, attr):
        """
        Get the value of a specified attribute.

        Args:
            attr (str): The name of the attribute.

        Returns:
            Any: The value of the attribute if it exists, otherwise None.
        """
        if attr in [c.key for c in self.__table__.columns]:
            return getattr(self, attr)
        return None

    def to_json(self):
        """
        Convert the model instance to a JSON-serializable dictionary.

        Returns:
            dict: A dictionary representation of the model instance.
        """
        return {c.key: self.get(c.key) for c in self.__table__.columns if c.key not in ["created", "updated"]}

    def to_update_dict(self) -> Dict[InstrumentedAttribute, Any]:
        update_dict = {}
        mapper = inspect(self).mapper

        # Add simple attributes
        for attr in mapper.column_attrs:
            if attr.key not in ["created", "updated", "id"]:
                update_dict[attr] = getattr(self, attr.key)

        # Add relationships
        for rel in mapper.relationships:
            related_value = getattr(self, rel.key)
            if related_value is not None:
                if rel.uselist:
                    update_dict[rel] = list(related_value)
                    print(rel, update_dict[rel])
                else:
                    update_dict[rel] = related_value
        return update_dict

    def __repr__(self):
        """
        Get a string representation of the model instance.

        Returns:
            str: A string representation of the model instance.
        """
        return str(self.to_json())

    def _update(self, fields):
        """
        Update the model instance with the provided fields.

        Args:
            fields (dict): A dictionary of fields to update.

        Returns:
            Base: The updated model instance.
        """
        for k, v in fields.items():
            attr_name = str(k).split(".")[-1]
            setattr(self, attr_name, v)
        return self


class SlackSpace(Base):
    """
    Model representing a Slack workspace.

    Attributes:
        id (int): Primary Key of the model.
        team_id (str): The Slack-internal unique identifier for the Slack team.
        workspace_name (Optional[str]): The name of the Slack workspace.
        bot_token (Optional[str]): The bot token for the Slack workspace.
        settings (Optional[Dict[str, Any]]): Slack Bot settings for the Slack workspace.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """

    __tablename__ = "slack_spaces"

    id: Mapped[intpk]
    team_id: Mapped[str] = mapped_column(VARCHAR, unique=True)
    workspace_name: Mapped[Optional[str]]
    bot_token: Mapped[Optional[str]]
    settings: Mapped[Optional[Dict[str, Any]]]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class Role(Base):
    """
    Model representing a role. A role is a set of permissions that can be assigned to users.

    Attributes:
        id (int): Primary Key of the model.
        name (str): The unique name of the role.
        description (Optional[text]): A description of the role.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """

    __tablename__ = "roles"

    id: Mapped[intpk]
    name: Mapped[str] = mapped_column(VARCHAR, unique=True)
    description: Mapped[Optional[text]]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class Permission(Base):
    """
    Model representing a permission.

    Attributes:
        id (int): Primary Key of the model.
        name (str): The name of the permission.
        description (Optional[text]): A description of the permission.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """

    __tablename__ = "permissions"

    id: Mapped[intpk]
    name: Mapped[str]
    description: Mapped[Optional[text]]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class Role_x_Permission(Base):
    """
    Model representing the assignment of permissions to roles.

    Attributes:
        role_id (int): The ID of the associated role.
        permission_id (int): The ID of the associated permission.
    """

    __tablename__ = "roles_x_permissions"

    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), primary_key=True)
    permission_id: Mapped[int] = mapped_column(ForeignKey("permissions.id"), primary_key=True)


class Role_x_User_x_Org(Base):
    """
    Model representing the assignment of roles, users, and organizations.

    Attributes:
        role_id (int): The ID of the associated role.
        user_id (int): The ID of the associated user.
        org_id (int): The ID of the associated organization.
    """

    __tablename__ = "roles_x_users_x_org"

    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("orgs.id"), primary_key=True)


class Org(Base):
    """
    Model representing an organization. The same model is used for all levels of organization (AOs, Regions, etc.).

    Attributes:
        id (int): Primary Key of the model.
        parent_id (Optional[int]): The ID of the parent organization.
        org_type (Org_Type): The type of the organization.
        default_location_id (Optional[int]): The ID of the default location.
        name (str): The name of the organization.
        description (Optional[text]): A description of the organization.
        is_active (bool): Whether the organization is active.
        logo_url (Optional[str]): The URL of the organization's logo.
        website (Optional[str]): The organization's website.
        email (Optional[str]): The organization's email.
        twitter (Optional[str]): The organization's Twitter handle.
        facebook (Optional[str]): The organization's Facebook page.
        instagram (Optional[str]): The organization's Instagram handle.
        last_annual_review (Optional[date]): The date of the last annual review.
        meta (Optional[Dict[str, Any]]): Additional metadata for the organization.
        ao_count (int): The number of AOs associated with the organization. Defaults to 0, will be updated by triggers.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.

        locations (Optional[List[Location]]): The locations associated with the organization. Probably only relevant for regions.
        event_types (Optional[List[EventType]]): The event types associated with the organization. Used to control which event types are available for selection at the region level.
        event_tags (Optional[List[EventTag]]): The event tags associated with the organization. Used to control which event tags are available for selection at the region level.
        achievements (Optional[List[Achievement]]): The achievements available within the organization.
        parent_org (Optional[Org]): The parent organization.
        slack_space (Optional[SlackSpace]): The associated Slack workspace.
    """  # noqa: E501

    __tablename__ = "orgs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("orgs.id"))
    org_type: Mapped[Org_Type]
    default_location_id: Mapped[Optional[int]]
    name: Mapped[str]
    description: Mapped[Optional[text]]
    is_active: Mapped[bool]
    logo_url: Mapped[Optional[str]]
    website: Mapped[Optional[str]]
    email: Mapped[Optional[str]]
    twitter: Mapped[Optional[str]]
    facebook: Mapped[Optional[str]]
    instagram: Mapped[Optional[str]]
    last_annual_review: Mapped[Optional[date]]
    meta: Mapped[Optional[Dict[str, Any]]]
    ao_count: Mapped[Optional[int]] = mapped_column(Integer, default=0, nullable=True)
    created: Mapped[dt_create]
    updated: Mapped[dt_update]

    __table_args__ = (
        Index("idx_orgs_parent_id", "parent_id"),
        Index("idx_orgs_org_type", "org_type"),
        Index("idx_orgs_is_active", "is_active"),
    )

    locations: Mapped[Optional[List["Location"]]] = relationship("Location", cascade="expunge")
    event_types: Mapped[Optional[List["EventType"]]] = relationship(
        "EventType",
        primaryjoin="or_(EventType.specific_org_id == Org.id, EventType.specific_org_id.is_(None))",
        cascade="expunge",
        viewonly=True,
    )
    event_tags: Mapped[Optional[List["EventTag"]]] = relationship(
        "EventTag",
        primaryjoin="or_(EventTag.specific_org_id == Org.id, EventTag.specific_org_id.is_(None))",
        cascade="expunge",
        viewonly=True,
    )
    achievements: Mapped[Optional[List["Achievement"]]] = relationship(
        "Achievement",
        cascade="expunge",
        primaryjoin="or_(Achievement.specific_org_id == Org.id, Achievement.specific_org_id.is_(None))",
    )
    parent_org: Mapped[Optional["Org"]] = relationship("Org", remote_side=[id], cascade="expunge")
    slack_space: Mapped[Optional["SlackSpace"]] = relationship(
        "SlackSpace", secondary="orgs_x_slack_spaces", cascade="expunge"
    )


class EventType(Base):
    """
    Model representing an event type. Event types can be shared by regions or not, and should roll up into event categories.

    Attributes:
        id (int): Primary Key of the model.
        name (str): The name of the event type.
        description (Optional[text]): A description of the event type.
        acronym (Optional[str]): Acronyms associated with the event type.
        event_category (Event_Category): The category of the event type (first_f, second_f, third_f).
        specific_org_id (Optional[int]): The ID of the specific organization.
        is_active (bool): Whether the event type is active. Default is True.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "event_types"

    id: Mapped[intpk]
    name: Mapped[str]
    description: Mapped[Optional[text]]
    acronym: Mapped[Optional[str]]
    event_category: Mapped[Event_Category]
    specific_org_id: Mapped[Optional[int]] = mapped_column(ForeignKey("orgs.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class EventType_x_Event(Base):
    """
    Model representing the association between events and event types. The intention is that a single event can be associated with multiple event types.

    Attributes:
        event_id (int): The ID of the associated event.
        event_type_id (int): The ID of the associated event type.

        event (Event): The associated event.
    """  # noqa: E501

    __tablename__ = "events_x_event_types"

    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", onupdate="CASCADE"), primary_key=True)
    event_type_id: Mapped[int] = mapped_column(ForeignKey("event_types.id"), primary_key=True)
    __table_args__ = (
        Index("idx_events_x_event_types_event_id", "event_id"),
        Index("idx_events_x_event_types_event_type_id", "event_type_id"),
    )

    event: Mapped["Event"] = relationship(back_populates="event_x_event_types")


class EventType_x_EventInstance(Base):
    """
    Model representing the association between event instances and event types. The intention is that a single event instance can be associated with multiple event types.

    Attributes:
        event_instance_id (int): The ID of the associated event instance.
        event_type_id (int): The ID of the associated event type.

        event_instance (EventInstance): The associated event instance.
    """  # noqa: E501

    __tablename__ = "event_instances_x_event_types"

    event_instance_id: Mapped[int] = mapped_column(
        ForeignKey("event_instances.id", onupdate="CASCADE"), primary_key=True
    )
    event_type_id: Mapped[int] = mapped_column(ForeignKey("event_types.id"), primary_key=True)

    event_instance: Mapped["EventInstance"] = relationship(back_populates="event_instances_x_event_types")


class EventTag(Base):
    """
    Model representing an event tag. These are used to mark special events, such as anniversaries or special workouts.

    Attributes:
        id (int): Primary Key of the model.
        name (str): The name of the event tag.
        description (Optional[text]): A description of the event tag.
        color (Optional[str]): The color used for the calendar.
        specific_org_id (Optional[int]): Used for custom tags for specific regions.
        is_active (bool): Whether the event tag is active. Default is True.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """

    __tablename__ = "event_tags"

    id: Mapped[intpk]
    name: Mapped[str]
    description: Mapped[Optional[text]]
    color: Mapped[Optional[str]]
    specific_org_id: Mapped[Optional[int]] = mapped_column(ForeignKey("orgs.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class EventTag_x_Event(Base):
    """
    Model representing the association between event tags and events. The intention is that a single event can be associated with multiple event tags.

    Attributes:
        event_id (int): The ID of the associated event.
        event_tag_id (int): The ID of the associated event tag.

        event (Event): The associated event.
    """  # noqa: E501

    __tablename__ = "event_tags_x_events"

    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", onupdate="CASCADE"), primary_key=True)
    event_tag_id: Mapped[int] = mapped_column(ForeignKey("event_tags.id"), primary_key=True)

    event: Mapped["Event"] = relationship(back_populates="event_x_event_tags")


class EventTag_x_EventInstance(Base):
    """
    Model representing the association between event tags and event instances. The intention is that a single event instance can be associated with multiple event tags.

    Attributes:
        event_instance_id (int): The ID of the associated event instance.
        event_tag_id (int): The ID of the associated event tag.

        event_instance (EventInstance): The associated event instance.
    """  # noqa: E501

    __tablename__ = "event_tags_x_event_instances"

    event_instance_id: Mapped[int] = mapped_column(
        ForeignKey("event_instances.id", onupdate="CASCADE"), primary_key=True
    )
    event_tag_id: Mapped[int] = mapped_column(ForeignKey("event_tags.id"), primary_key=True)

    event_instance: Mapped["EventInstance"] = relationship(back_populates="event_instances_x_event_tags")


class Org_x_SlackSpace(Base):
    """
    Model representing the association between organizations and Slack workspaces. This is currently meant to be one to one, but theoretically could support multiple workspaces per organization.

    Attributes:
        org_id (int): The ID of the associated organization.
        slack_space_id (str): The ID of the associated Slack workspace.
    """  # noqa: E501

    __tablename__ = "orgs_x_slack_spaces"

    org_id: Mapped[int] = mapped_column(ForeignKey("orgs.id"), primary_key=True)
    slack_space_id: Mapped[int] = mapped_column(ForeignKey("slack_spaces.id"), primary_key=True)


class Location(Base):
    """
    Model representing a location. Locations are expected to belong to a single organization (region).

    Attributes:
        id (int): Primary Key of the model.
        org_id (int): The ID of the associated organization.
        name (str): The name of the location.
        description (Optional[text]): A description of the location.
        is_active (bool): Whether the location is active.
        email (Optional[str]): A contact email address associated with the location.
        lat (Optional[float]): The latitude of the location.
        lon (Optional[float]): The longitude of the location.
        address_street (Optional[str]): The street address of the location.
        address_city (Optional[str]): The city of the location.
        address_state (Optional[str]): The state of the location.
        address_zip (Optional[str]): The ZIP code of the location.
        address_country (Optional[str]): The country of the location.
        meta (Optional[Dict[str, Any]]): Additional metadata for the location.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "locations"

    id: Mapped[intpk]
    org_id: Mapped[int] = mapped_column(ForeignKey("orgs.id"))
    name: Mapped[str]
    description: Mapped[Optional[text]]
    is_active: Mapped[bool]
    email: Mapped[Optional[str]]
    latitude: Mapped[Optional[float]] = mapped_column(Float(precision=8, decimal_return_scale=5))
    longitude: Mapped[Optional[float]] = mapped_column(Float(precision=8, decimal_return_scale=5))
    address_street: Mapped[Optional[str]]
    address_street2: Mapped[Optional[str]]
    address_city: Mapped[Optional[str]]
    address_state: Mapped[Optional[str]]
    address_zip: Mapped[Optional[str]]
    address_country: Mapped[Optional[str]]
    meta: Mapped[Optional[Dict[str, Any]]]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]

    __table_args__ = (
        Index("idx_locations_org_id", "org_id"),
        Index("idx_locations_name", "name"),
        Index("idx_locations_is_active", "is_active"),
    )


class Event(Base):
    """
    Model representing an event or series; the same model is used for both with a self-referential relationship for series.

    Attributes:
        id (int): Primary Key of the model.
        org_id (int): The ID of the associated organization.
        location_id (Optional[int]): The ID of the associated location.
        series_id (Optional[int]): The ID of the associated event series.
        is_series (bool): Whether this record is a series or single occurrence. Default is False.
        is_active (bool): Whether the event is active. Default is True.
        highlight (bool): Whether the event is highlighted. Default is False.
        start_date (date): The start date of the event.
        end_date (Optional[date]): The end date of the event.
        start_time (Optional[str]): The start time of the event. Format is 'HHMM', 24-hour time, timezone naive.
        end_time (Optional[str]): The end time of the event. Format is 'HHMM', 24-hour time, timezone naive.
        day_of_week (Optional[Day_Of_Week]): The day of the week of the event.
        name (str): The name of the event.
        description (Optional[text]): A description of the event.
        email (Optional[str]): A contact email address associated with the event.
        recurrence_pattern (Optional[Event_Cadence]): The recurrence pattern of the event. Current options are 'weekly' or 'monthly'.
        recurrence_interval (Optional[int]): The recurrence interval of the event (e.g. every 2 weeks).
        index_within_interval (Optional[int]): The index within the recurrence interval. (e.g. 2nd Tuesday of the month).
        pax_count (Optional[int]): The number of participants.
        fng_count (Optional[int]): The number of first-time participants.
        is_private (bool): Whether the event is private (won't be shown on maps, etc.). Default is False.
        meta (Optional[Dict[str, Any]]): Additional metadata for the event.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.

        org (Org): The associated organization.
        location (Location): The associated location.
        event_types (List[EventType]): The associated event types.
        event_tags (Optional[List[EventTag]]): The associated event tags.
        event_x_event_types (List[EventType_x_Event]): The association between the event and event types.
        event_x_event_tags (Optional[List[EventTag_x_Event]]): The association between the event and event tags.
    """  # noqa: E501

    __tablename__ = "events"

    id: Mapped[intpk]
    org_id: Mapped[int] = mapped_column(ForeignKey("orgs.id"))
    location_id: Mapped[Optional[int]] = mapped_column(ForeignKey("locations.id"))
    series_id: Mapped[Optional[int]] = mapped_column(ForeignKey("events.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    highlight: Mapped[bool] = mapped_column(Boolean, default=False)
    start_date: Mapped[date]
    end_date: Mapped[Optional[date]]
    start_time: Mapped[Optional[str]]
    end_time: Mapped[Optional[str]]
    day_of_week: Mapped[Optional[Day_Of_Week]]
    name: Mapped[str]
    description: Mapped[Optional[text]]
    email: Mapped[Optional[str]]
    recurrence_pattern: Mapped[Optional[Event_Cadence]]
    recurrence_interval: Mapped[Optional[int]]
    index_within_interval: Mapped[Optional[int]]
    is_private: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    meta: Mapped[Optional[Dict[str, Any]]]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]

    __table_args__ = (
        Index("idx_events_org_id", "org_id"),
        Index("idx_events_location_id", "location_id"),
        Index("idx_events_is_active", "is_active"),
    )

    org: Mapped[Org] = relationship(innerjoin=True, cascade="expunge", viewonly=True)
    location: Mapped[Location] = relationship(innerjoin=False, cascade="expunge", viewonly=True)
    event_types: Mapped[List[EventType]] = relationship(
        secondary="events_x_event_types",
        innerjoin=True,
        cascade="expunge",
        viewonly=True,
    )
    event_tags: Mapped[Optional[List[EventTag]]] = relationship(
        secondary="event_tags_x_events", cascade="expunge", viewonly=True
    )
    event_x_event_types: Mapped[List[EventType_x_Event]] = relationship(
        back_populates="event",
        passive_deletes=True,
        cascade="all, delete-orphan",
    )
    event_x_event_tags: Mapped[Optional[List[EventTag_x_Event]]] = relationship(
        back_populates="event",
        passive_deletes=True,
        cascade="all, delete-orphan",
    )


class EventInstance(Base):
    """
    Model representing an event instance (a single occurrence of an event).

    Attributes:
        id (int): Primary Key of the model.
        org_id (int): The ID of the associated organization.
        location_id (Optional[int]): The ID of the associated location.
        series_id (Optional[int]): The ID of the associated event series.
        is_active (bool): Whether the event is active. Default is True.
        highlight (bool): Whether the event is highlighted. Default is False.
        start_date (date): The start date of the event.
        end_date (Optional[date]): The end date of the event.
        start_time (Optional[str]): The start time of the event. Format is 'HHMM', 24-hour time, timezone naive.
        end_time (Optional[str]): The end time of the event. Format is 'HHMM', 24-hour time, timezone naive.
        name (str): The name of the event.
        description (Optional[text]): A description of the event.
        email (Optional[str]): A contact email address associated with the event.
        pax_count (Optional[int]): The number of participants.
        fng_count (Optional[int]): The number of first-time participants.
        preblast (Optional[text]): The pre-event announcement.
        backblast (Optional[text]): The post-event report.
        preblast_rich (Optional[Dict[str, Any]]): The rich text pre-event announcement (e.g. Slack message).
        backblast_rich (Optional[Dict[str, Any]]): The rich text post-event report (e.g. Slack message).
        preblast_ts (Optional[float]): The Slack post timestamp of the pre-event announcement.
        backblast_ts (Optional[float]): The Slack post timestamp of the post-event report.
        series_exception (Optional[Series_Exception]): Any exceptions to the normal series pattern for this event instance.
        meta (Optional[Dict[str, Any]]): Additional metadata for the event.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.

        org (Org): The associated organization.
        location (Location): The associated location.
        event_types (List[EventType]): The associated event types.
        event_tags (Optional[List[EventTag]]): The associated event tags.
        event_instances_x_event_types (List[EventType_x_EventInstance]): The association between the event and event types.
        event_instances_x_event_tags (Optional[List[EventTag_x_EventInstance]]): The association between the event and event tags.
    """  # noqa: E501

    __tablename__ = "event_instances"
    __table_args__ = (
        Index("idx_event_instances_org_id", "org_id"),
        Index("idx_event_instances_location_id", "location_id"),
        Index("idx_event_instances_is_active", "is_active"),
    )

    id: Mapped[intpk]
    org_id: Mapped[int] = mapped_column(ForeignKey("orgs.id"))
    location_id: Mapped[Optional[int]] = mapped_column(ForeignKey("locations.id"))
    series_id: Mapped[Optional[int]] = mapped_column(ForeignKey("events.id", onupdate="CASCADE"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    highlight: Mapped[bool] = mapped_column(Boolean, default=False)
    start_date: Mapped[date]
    end_date: Mapped[Optional[date]]
    start_time: Mapped[Optional[str]]
    end_time: Mapped[Optional[str]]
    name: Mapped[str]
    description: Mapped[Optional[text]]
    email: Mapped[Optional[str]]
    pax_count: Mapped[Optional[int]]
    fng_count: Mapped[Optional[int]]
    preblast: Mapped[Optional[text]]
    backblast: Mapped[Optional[text]]
    preblast_rich: Mapped[Optional[Dict[str, Any]]]
    backblast_rich: Mapped[Optional[Dict[str, Any]]]
    preblast_ts: Mapped[Optional[float]]
    backblast_ts: Mapped[Optional[float]]
    is_private: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    series_exception: Mapped[Optional[Series_Exception]]
    meta: Mapped[Optional[Dict[str, Any]]]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]

    __table_args__ = (
        Index("idx_event_instances_org_id", "org_id"),
        Index("idx_event_instances_location_id", "location_id"),
        Index("idx_event_instances_is_active", "is_active"),
    )

    org: Mapped[Org] = relationship(innerjoin=True, cascade="expunge", viewonly=True)
    location: Mapped[Location] = relationship(innerjoin=False, cascade="expunge", viewonly=True)
    event_types: Mapped[List[EventType]] = relationship(
        secondary="event_instances_x_event_types",
        innerjoin=True,
        cascade="expunge",
        viewonly=True,
    )
    event_tags: Mapped[Optional[List[EventTag]]] = relationship(
        secondary="event_tags_x_event_instances", cascade="expunge", viewonly=True
    )
    event_instances_x_event_types: Mapped[List[EventType_x_EventInstance]] = relationship(
        back_populates="event_instance",
        passive_deletes=True,
        cascade="all, delete-orphan",
    )
    event_instances_x_event_tags: Mapped[Optional[List[EventTag_x_EventInstance]]] = relationship(
        back_populates="event_instance",
        passive_deletes=True,
        cascade="all, delete-orphan",
    )
    attendance: Mapped[List["Attendance"]] = relationship(
        back_populates="event_instance",
        passive_deletes=True,
        cascade="all, delete-orphan",
    )


class EventInstanceExpanded(Base):
    """
    Read-only ORM mapping for the materialized view `event_instance_expanded`.

    This view expands each event instance with series, org hierarchy, location,
    aggregated type/tag indicators, and arrays of names. It is intended for
    querying only and should not be used for inserts/updates.
    """

    __tablename__ = "event_instance_expanded"

    # Base event-instance level fields
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
    meta: Mapped[Optional[Dict[str, Any]]]
    created: Mapped[datetime] = mapped_column(DateTime)
    updated: Mapped[datetime] = mapped_column(DateTime)

    # Series fields
    series_name: Mapped[Optional[str]]
    series_description: Mapped[Optional[str]]

    # AO fields (org_type = 'ao')
    ao_org_id: Mapped[Optional[int]] = mapped_column(Integer)
    ao_name: Mapped[Optional[str]]
    ao_description: Mapped[Optional[str]]
    ao_logo_url: Mapped[Optional[str]]
    ao_website: Mapped[Optional[str]]
    ao_meta: Mapped[Optional[Dict[str, Any]]]

    # Region fields (coalesce of direct region or parent of AO)
    region_org_id: Mapped[Optional[int]] = mapped_column(Integer)
    region_name: Mapped[Optional[str]]
    region_description: Mapped[Optional[str]]
    region_logo_url: Mapped[Optional[str]]
    region_website: Mapped[Optional[str]]
    region_meta: Mapped[Optional[Dict[str, Any]]]

    # Area and sector fields
    area_org_id: Mapped[Optional[int]] = mapped_column(Integer)
    area_name: Mapped[Optional[str]]
    sector_org_id: Mapped[Optional[int]] = mapped_column(Integer)
    sector_name: Mapped[Optional[str]]

    # Location fields
    location_name: Mapped[Optional[str]]
    location_description: Mapped[Optional[str]]
    location_latitude: Mapped[Optional[float]] = mapped_column(Float)
    location_longitude: Mapped[Optional[float]] = mapped_column(Float)

    # Aggregated indicators from event types (int8 in PG -> BigInteger)
    bootcamp_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    run_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    ruck_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    first_f_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    second_f_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    third_f_ind: Mapped[Optional[int]] = mapped_column(BigInteger)

    # Aggregated indicators from event tags (int8 in PG -> BigInteger)
    pre_workout_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    off_the_books_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    vq_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    convergence_ind: Mapped[Optional[int]] = mapped_column(BigInteger)

    # Arrays of type/tag names
    all_types: Mapped[Optional[List[str]]] = mapped_column(ARRAY(VARCHAR))
    all_tags: Mapped[Optional[List[str]]] = mapped_column(ARRAY(VARCHAR))


class AttendanceType(Base):
    """
    Model representing an attendance type. Basic types are 1='PAX', 2='Q', 3='Co-Q'

    Attributes:
        type (str): The type of attendance.
        description (Optional[str]): A description of the attendance type.
    """  # noqa: E501

    __tablename__ = "attendance_types"

    id: Mapped[intpk]
    type: Mapped[str]
    description: Mapped[Optional[str]]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class Attendance_x_AttendanceType(Base):
    """
    Model representing the association between attendance and attendance types.

    Attributes:
        attendance_id (int): The ID of the associated attendance.
        attendance_type_id (int): The ID of the associated attendance type.

        attendance (Attendance): The associated attendance.
    """  # noqa: E501

    __tablename__ = "attendance_x_attendance_types"

    attendance_id: Mapped[int] = mapped_column(ForeignKey("attendance.id", onupdate="CASCADE"), primary_key=True)
    attendance_type_id: Mapped[int] = mapped_column(ForeignKey("attendance_types.id"), primary_key=True)

    attendance: Mapped["Attendance"] = relationship(back_populates="attendance_x_attendance_types")


class User(Base):
    """
    Model representing a user.

    Attributes:
        id (int): Primary Key of the model.
        f3_name (Optional[str]): The F3 name of the user.
        first_name (Optional[str]): The first name of the user.
        last_name (Optional[str]): The last name of the user.
        email (str): The email of the user.
        phone (Optional[str]): The phone number of the user.
        home_region_id (Optional[int]): The ID of the home region.
        avatar_url (Optional[str]): The URL of the user's avatar.
        meta (Optional[Dict[str, Any]]): Additional metadata for the user.
        email_verified (Optional[datetime]): The timestamp when the user's email was verified.
        status (UserStatus): The status of the user. Default is 'active'.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "users"

    id: Mapped[intpk]
    f3_name: Mapped[Optional[str]]
    first_name: Mapped[Optional[str]]
    last_name: Mapped[Optional[str]]
    email: Mapped[str] = mapped_column(CIText, unique=True)
    phone: Mapped[Optional[str]]
    emergency_contact: Mapped[Optional[str]]
    emergency_phone: Mapped[Optional[str]]
    emergency_notes: Mapped[Optional[str]]
    home_region_id: Mapped[Optional[int]] = mapped_column(ForeignKey("orgs.id"))
    avatar_url: Mapped[Optional[str]]
    meta: Mapped[Optional[Dict[str, Any]]]
    email_verified: Mapped[Optional[datetime]]
    status: Mapped[User_Status] = mapped_column(Enum(User_Status), default=User_Status.active)
    created: Mapped[dt_create]
    updated: Mapped[dt_update]

    home_region_org: Mapped[Optional[Org]] = relationship(cascade="expunge", viewonly=True)


class SlackUser(Base):
    """
    Model representing a Slack user.

    Attributes:
        id (int): Primary Key of the model.
        slack_id (str): The Slack ID of the user.
        user_name (str): The username of the Slack user.
        email (str): The email of the Slack user.
        is_admin (bool): Whether the user is an admin.
        is_owner (bool): Whether the user is the owner.
        is_bot (bool): Whether the user is a bot.
        user_id (Optional[int]): The ID of the associated user.
        avatar_url (Optional[str]): The URL of the user's avatar.
        slack_team_id (str): The ID of the associated Slack team.
        strava_access_token (Optional[str]): The Strava access token of the user.
        strava_refresh_token (Optional[str]): The Strava refresh token of the user.
        strava_expires_at (Optional[datetime]): The expiration time of the Strava token.
        strava_athlete_id (Optional[int]): The Strava athlete ID of the user.
        meta (Optional[Dict[str, Any]]): Additional metadata for the Slack user.
        slack_updated (Optional[int]): The last update time of the Slack user.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "slack_users"

    id: Mapped[intpk]
    slack_id: Mapped[str]
    user_name: Mapped[str]
    email: Mapped[str]
    is_admin: Mapped[bool]
    is_owner: Mapped[bool]
    is_bot: Mapped[bool]
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    avatar_url: Mapped[Optional[str]]
    slack_team_id: Mapped[str]
    strava_access_token: Mapped[Optional[str]]
    strava_refresh_token: Mapped[Optional[str]]
    strava_expires_at: Mapped[Optional[datetime]]
    strava_athlete_id: Mapped[Optional[int]]
    meta: Mapped[Optional[Dict[str, Any]]]
    slack_updated: Mapped[Optional[int]]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class Attendance(Base):
    """
    Model representing an attendance record.

    Attributes:
        id (int): Primary Key of the model.
        event_instance_id (int): The ID of the associated event instance.
        user_id (Optional[int]): The ID of the associated user.
        is_planned (bool): Whether this is planned attendance (True) vs actual attendance (False).
        meta (Optional[Dict[str, Any]]): Additional metadata for the attendance.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.

        event_instance (EventInstance): The associated event instance.
        user (User): The associated user.
        slack_users (Optional[List[SlackUser]]): The associated Slack Users for this User (a User can be in multiple SlackSpaces).
        attendance_x_attendance_types (List[Attendance_x_AttendanceType]): The association between the attendance and attendance types.
        attendance_types (List[AttendanceType]): The associated attendance types.
    """  # noqa: E501

    __tablename__ = "attendance"
    __table_args__ = (
        UniqueConstraint("event_instance_id", "user_id", "is_planned"),
        Index("idx_attendance_event_instance_id", "event_instance_id"),
        Index("idx_attendance_user_id", "user_id"),
        Index("idx_attendance_is_planned", "is_planned"),
    )

    id: Mapped[intpk]
    event_instance_id: Mapped[int] = mapped_column(ForeignKey("event_instances.id", onupdate="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    is_planned: Mapped[bool]
    meta: Mapped[Optional[Dict[str, Any]]]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]

    event_instance: Mapped[EventInstance] = relationship(innerjoin=True, cascade="expunge", viewonly=True)
    user: Mapped[User] = relationship(innerjoin=True, cascade="expunge", viewonly=True)
    slack_users: Mapped[Optional[List[SlackUser]]] = relationship(
        innerjoin=False, cascade="expunge", secondary="users", viewonly=True
    )
    attendance_x_attendance_types: Mapped[List[Attendance_x_AttendanceType]] = relationship(
        back_populates="attendance", passive_deletes=True, cascade="all, delete-orphan"
    )
    attendance_types: Mapped[List[AttendanceType]] = relationship(
        secondary="attendance_x_attendance_types",
        innerjoin=True,
        cascade="expunge",
        viewonly=True,
    )


class AttendanceExpanded(Base):
    """
    Read-only ORM mapping for the materialized view `attendance_expanded`.

    Includes base attendance fields, aggregated attendance-type indicators,
    and selected user and home-region details. Query-only.
    """

    __tablename__ = "attendance_expanded"

    # Base attendance fields
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer)
    event_instance_id: Mapped[int] = mapped_column(Integer)
    attendance_meta: Mapped[Optional[Dict[str, Any]]]
    created: Mapped[datetime] = mapped_column(DateTime)
    updated: Mapped[datetime] = mapped_column(DateTime)

    # Aggregated indicators (int8 -> BigInteger)
    q_ind: Mapped[Optional[int]] = mapped_column(BigInteger)
    coq_ind: Mapped[Optional[int]] = mapped_column(BigInteger)

    # Joined user and region info
    f3_name: Mapped[Optional[str]]
    first_name: Mapped[Optional[str]]
    last_name: Mapped[Optional[str]]
    email: Mapped[Optional[str]] = mapped_column(CIText)
    home_region_id: Mapped[Optional[int]] = mapped_column(Integer)
    home_region_name: Mapped[Optional[str]]
    avatar_url: Mapped[Optional[str]]
    user_status: Mapped[Optional[User_Status]] = mapped_column(Enum(User_Status))


class Achievement(Base):
    """
    Model representing an achievement.

    Attributes:
        id (int): Primary Key of the model.
        name (str): The name of the achievement.
        description (Optional[str]): A description of the achievement.
        image_url (Optional[str]): The URL of the achievement's image.
        specific_org_id (Optional[int]): The ID of the specific region if a custom achievement. If null, the achievement is available to all regions.
        is_active (bool): Whether the achievement is active. Default is True.
        auto_award (bool): Whether the achievement is automatically awarded or needs to be manually tagged. Default is False.
        auto_cadence (Optional[Achievement_Cadence]): The cadence for automatic awarding of the achievement.
        auto_threshold (Optional[int]): The threshold for automatic awarding of the achievement.
        auto_threshold_type (Optional[Achievement_Threshold_Type]): The type of threshold for automatic awarding of the achievement ('posts', 'unique_aos', etc.).
        auto_filters (Optional[Dict[str, Any]]): Event filters for automatic awarding of the achievement. Should be a format like {'include': [{'event_type_id': [1, 2]}, {'event_tag_id': [3]}], 'exclude': [{'event_category': ['third_f']}]}.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "achievements"

    id: Mapped[intpk]
    name: Mapped[str]
    description: Mapped[Optional[str]]
    image_url: Mapped[Optional[str]]
    specific_org_id: Mapped[Optional[int]] = mapped_column(ForeignKey("orgs.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    auto_award: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    auto_cadence: Mapped[Optional[Achievement_Cadence]]
    auto_threshold_type: Mapped[Optional[str]]
    auto_threshold: Mapped[Optional[int]]
    auto_filters: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, default=dict)
    meta: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, default=dict)
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class Achievement_x_User(Base):
    """
    Model representing the association between achievements and users.

    Attributes:
        achievement_id (int): The ID of the associated achievement.
        user_id (int): The ID of the associated user.
        award_year (int): The year the achievement was awarded. Default is -1 (used for lifetime achievements).
        award_period (int): The period (ie week, month) the achievement was awarded in. Default is -1 (used for lifetime achievements).
        date_awarded (date): The date the achievement was awarded. Default is the current date.
    """  # noqa: E501

    __tablename__ = "achievements_x_users"

    achievement_id: Mapped[int] = mapped_column(ForeignKey("achievements.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    award_year: Mapped[int] = mapped_column(Integer, primary_key=True, server_default="-1")
    award_period: Mapped[int] = mapped_column(Integer, primary_key=True, server_default="-1")
    date_awarded: Mapped[date] = mapped_column(DateTime, server_default=func.timezone("utc", func.now()))


class Position(Base):
    """
    Model representing a position.

    Attributes:
        name (str): The name of the position.
        description (Optional[str]): A description of the position.
        org_type (Optional[Org_Type]): The associated organization type. This is used to limit the positions available to certain types of organizations. If null, the position is available to all organization types.
        org_id (Optional[int]): The ID of the associated organization. This is used to limit the positions available to certain organizations. If null, the position is available to all organizations.
        is_active (bool): Whether the position is active. Default is True.
    """  # noqa: E501

    __tablename__ = "positions"

    id: Mapped[intpk]
    name: Mapped[str]
    description: Mapped[Optional[str]]
    org_type: Mapped[Optional[Org_Type]]
    org_id: Mapped[Optional[int]] = mapped_column(ForeignKey("orgs.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class Position_x_Org_x_User(Base):
    """
    Model representing the association between positions, organizations, and users.

    Attributes:
        position_id (int): The ID of the associated position.
        org_id (int): The ID of the associated organization.
        user_id (int): The ID of the associated user.
    """  # noqa: E501

    __tablename__ = "positions_x_orgs_x_users"

    position_id: Mapped[int] = mapped_column(ForeignKey("positions.id"), primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("orgs.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)


class Expansion(Base):
    """
    Model representing an expansion.

    Attributes:
        id (int): Primary Key of the model.
        area (str): The area of the expansion.
        pinned_lat (float): The pinned latitude of the expansion.
        pinned_lon (float): The pinned longitude of the expansion.
        user_lat (float): The user's latitude.
        user_lon (float): The user's longitude.
        interested_in_organizing (bool): Whether the user is interested in organizing.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "expansions"

    id: Mapped[intpk]
    area: Mapped[str]
    pinned_lat: Mapped[float]
    pinned_lon: Mapped[float]
    user_lat: Mapped[float]
    user_lon: Mapped[float]
    interested_in_organizing: Mapped[bool]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class Expansion_x_User(Base):
    """
    Model representing the association between expansions and users.

    Attributes:
        expansion_id (int): The ID of the associated expansion.
        user_id (int): The ID of the associated user.
        requst_date (date): The date of the request. Default is the current date.
        notes (Optional[text]): Additional notes for the association.
    """  # noqa: E501

    __tablename__ = "expansions_x_users"

    expansion_id: Mapped[int] = mapped_column(ForeignKey("expansions.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    request_date: Mapped[date] = mapped_column(DateTime, server_default=func.timezone("utc", func.now()))
    notes: Mapped[Optional[text]]


class NextAuthAccount(Base):
    """
    Model representing an authentication account.

    Attributes:
        user_id (int): The ID of the associated user.
        type (text): The type of the account.
        provider (text): The provider of the account.
        provider_account_id (text): The provider account ID.
        refresh_token (Optional[text]): The refresh token.
        access_token (Optional[text]): The access token.
        expires_at (Optional[datetime]): The expiration time of the token.
        token_type (Optional[text]): The token type.
        scope (Optional[text]): The scope of the token.
        id_token (Optional[text]): The ID token.
        session_state (Optional[text]): The session state.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "auth_accounts"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    type: Mapped[text]  # need adapter account_type?
    provider: Mapped[text] = mapped_column(VARCHAR, primary_key=True)
    provider_account_id: Mapped[text] = mapped_column(VARCHAR, primary_key=True)
    refresh_token: Mapped[Optional[text]]
    access_token: Mapped[Optional[text]]
    expires_at: Mapped[Optional[datetime]]
    token_type: Mapped[Optional[text]]
    scope: Mapped[Optional[text]]
    id_token: Mapped[Optional[text]]
    session_state: Mapped[Optional[text]]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class NextAuthSession(Base):
    """
    Model representing an authentication session.

    Attributes:
        session_token (text): The session token.
        user_id (int): The ID of the associated user.
        expires (ts_notz): The expiration time of the session.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "auth_sessions"

    session_token: Mapped[text] = mapped_column(TEXT, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires: Mapped[ts_notz]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class NextAuthVerificationToken(Base):
    """
    Model representing an authentication verification token.

    Attributes:
        identifier (text): The identifier of the token.
        token (text): The token.
        expires (ts_notz): The expiration time of the token.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "auth_verification_tokens"

    identifier: Mapped[text] = mapped_column(VARCHAR, primary_key=True)
    token: Mapped[text] = mapped_column(VARCHAR, primary_key=True)
    expires: Mapped[ts_notz]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class UpdateRequest(Base):
    """
    Model representing an update request.

    Attributes:
        id (UUID): The ID of the update request.
        token (UUID): The token of the update request.
        region_id (int): The ID of the associated region.
        event_id (Optional[int]): The ID of the associated event.
        event_type_ids (Optional[List[int]]): The associated event type IDs.
        event_tag (Optional[str]): The associated event tag.
        event_series_id (Optional[int]): The ID of the associated event series.
        event_is_series (Optional[bool]): Whether the event is a series.
        event_is_active (Optional[bool]): Whether the event is active.
        event_highlight (Optional[bool]): Whether the event is highlighted.
        event_start_date (Optional[date]): The start date of the event.
        event_end_date (Optional[date]): The end date of the event.
        event_start_time (Optional[str]): The start time of the event. Format is 'HHMM', 24-hour time, timezone naive.
        event_end_time (Optional[str]): The end time of the event. Format is 'HHMM', 24-hour time, timezone naive.
        event_day_of_week (Optional[Day_Of_Week]): The day of the week of the event.
        event_name (str): The name of the event.
        event_description (Optional[text]): A description of the event.
        event_recurrence_pattern (Optional[Event_Cadence]): The recurrence pattern of the event.
        event_recurrence_interval (Optional[int]): The recurrence interval of the event.
        event_index_within_interval (Optional[int]): The index within the recurrence interval.
        event_meta (Optional[Dict[str, Any]]): Additional metadata for the event.
        event_contact_email (Optional[str]): The contact email of the event.
        location_name (Optional[text]): The name of the location.
        location_description (Optional[text]): A description of the location.
        location_address (Optional[text]): The address of the location.
        location_address2 (Optional[text]): The second address line of the location.
        location_city (Optional[text]): The city of the location.
        location_state (Optional[str]): The state of the location.
        location_zip (Optional[str]): The ZIP code of the location.
        location_country (Optional[str]): The country of the location.
        location_lat (Optional[float]): The latitude of the location.
        location_lng (Optional[float]): The longitude of the location.
        location_id (Optional[int]): The ID of the location.
        location_contact_email (Optional[str]): The contact email of the location.
        ao_id (Optional[int]): The ID of the associated AO.
        ao_name (Optional[text]): The name of the AO.
        ao_logo (Optional[text]): The URL of the AO logo.
        ao_website (Optional[text]): The website of the AO.
        submitted_by (str): The user who submitted the request.
        submitter_validated (Optional[bool]): Whether the submitter has validated the request. Default is False.
        reviewed_by (Optional[str]): The user who reviewed the request.
        reviewed_at (Optional[datetime]): The timestamp when the request was reviewed.
        status (Update_Request_Status): The status of the request. Default is 'pending'.
        meta (Optional[Dict[str, Any]]): Additional metadata for the request.
        request_type (Request_Type): The type of the request.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "update_requests"

    id: Mapped[Uuid] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    token: Mapped[Uuid] = mapped_column(UUID(as_uuid=True), server_default=func.gen_random_uuid())
    region_id: Mapped[int] = mapped_column(ForeignKey("orgs.id"))
    event_id: Mapped[Optional[int]] = mapped_column(ForeignKey("events.id"))
    event_type_ids: Mapped[Optional[List[int]]] = mapped_column(ARRAY(Integer))
    event_tag: Mapped[Optional[str]]
    event_series_id: Mapped[Optional[int]]
    event_is_series: Mapped[Optional[bool]]
    event_is_active: Mapped[Optional[bool]]
    event_highlight: Mapped[Optional[bool]]
    event_start_date: Mapped[Optional[date]]
    event_end_date: Mapped[Optional[date]]
    event_start_time: Mapped[Optional[str]]
    event_end_time: Mapped[Optional[str]]
    event_day_of_week: Mapped[Optional[Day_Of_Week]]
    event_name: Mapped[str]
    event_description: Mapped[Optional[text]]
    event_recurrence_pattern: Mapped[Optional[Event_Cadence]]
    event_recurrence_interval: Mapped[Optional[int]]
    event_index_within_interval: Mapped[Optional[int]]
    event_meta: Mapped[Optional[Dict[str, Any]]]
    event_contact_email: Mapped[Optional[str]]

    location_name: Mapped[Optional[text]]
    location_description: Mapped[Optional[text]]
    location_address: Mapped[Optional[text]]
    location_address2: Mapped[Optional[text]]
    location_city: Mapped[Optional[text]]
    location_state: Mapped[Optional[str]]
    location_zip: Mapped[Optional[str]]
    location_country: Mapped[Optional[str]]
    location_lat: Mapped[Optional[float]] = mapped_column(REAL())
    location_lng: Mapped[Optional[float]] = mapped_column(REAL())
    location_id: Mapped[Optional[int]] = mapped_column(ForeignKey("locations.id"))
    location_contact_email: Mapped[Optional[str]]

    ao_id: Mapped[Optional[int]] = mapped_column(ForeignKey("orgs.id"))
    ao_name: Mapped[Optional[text]]
    ao_logo: Mapped[Optional[text]]
    ao_website: Mapped[Optional[text]]

    submitted_by: Mapped[text]
    submitter_validated: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    reviewed_by: Mapped[Optional[text]]
    reviewed_at: Mapped[Optional[datetime]]
    status: Mapped[Update_Request_Status] = mapped_column(
        Enum(Update_Request_Status), default=Update_Request_Status.pending
    )
    meta: Mapped[Optional[Dict[str, Any]]]
    request_type: Mapped[Request_Type]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


# -- Main table for entries
# CREATE TABLE IF NOT EXISTS codex_entries (
#   id SERIAL PRIMARY KEY,
#   title VARCHAR(255) NOT NULL,
#   definition TEXT NOT NULL,
#   type VARCHAR(50) NOT NULL,
#   aliases JSONB DEFAULT '[]'::jsonb,
#   video_link TEXT,
#   updated_at TIMESTAMP NOT NULL DEFAULT now()
# );

# -- Tags used to categorize entries
# CREATE TABLE IF NOT EXISTS codex_tags (
#   id SERIAL PRIMARY KEY,
#   name VARCHAR(255) UNIQUE NOT NULL
# );

# -- Many-to-many relationship between entries and tags
# CREATE TABLE IF NOT EXISTS codex_entry_tags (
#   entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
#   tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
#   PRIMARY KEY (entry_id, tag_id)
# );

# -- User-submitted suggestions (entries, edits, tags, etc.)
# CREATE TABLE IF NOT EXISTS codex_user_submissions (
#   id SERIAL PRIMARY KEY,
#   submission_type VARCHAR(50) NOT NULL,
#   data JSONB NOT NULL,
#   submitter_name VARCHAR(255),
#   submitter_email VARCHAR(255),
#   timestamp TIMESTAMP NOT NULL DEFAULT now(),
#   status VARCHAR(50) NOT NULL DEFAULT 'pending'
# );

# -- Internal linking between entries

# CREATE TABLE IF NOT EXISTS codex_references (
#   id SERIAL PRIMARY KEY,
#   from_entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
#   to_entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
#   context TEXT,
#   created_at TIMESTAMP NOT NULL DEFAULT now()
# );


class CodexEntry(Base):
    """
    Model representing a Codex entry.

    Attributes:
        id (int): Primary Key of the model.
        title (str): The title of the entry.
        definition (text): The definition of the entry.
        type (str): The type of the entry.
        aliases (Optional[List[str]]): Aliases for the entry.
        video_link (Optional[str]): A link to a video related to the entry.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "codex_entries"

    id: Mapped[intpk]
    title: Mapped[str]
    definition: Mapped[text]
    type: Mapped[str]
    aliases: Mapped[Optional[List[str]]] = mapped_column(JSONB, server_default="[]")
    video_link: Mapped[Optional[str]]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class CodexTag(Base):
    """
    Model representing a Codex tag.

    Attributes:
        id (int): Primary Key of the model.
        name (str): The name of the tag.
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "codex_tags"

    id: Mapped[intpk]
    name: Mapped[str] = mapped_column(VARCHAR, unique=True, nullable=False)
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class CodexEntryTag(Base):
    """
    Model representing the association between Codex entries and tags.

    Attributes:
        entry_id (int): The ID of the associated Codex entry.
        tag_id (int): The ID of the associated Codex tag.
    """  # noqa: E501

    __tablename__ = "codex_entry_tags"

    entry_id: Mapped[int] = mapped_column(ForeignKey("codex_entries.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("codex_tags.id", ondelete="CASCADE"), primary_key=True)


class CodexUserSubmission(Base):
    """
    Model representing a user submission for the Codex.

    Attributes:
        id (int): Primary Key of the model.
        submission_type (str): The type of the submission (e.g., 'entry', 'edit', 'tag').
        data (Dict[str, Any]): The data of the submission in JSON format.
        submitter_name (Optional[str]): The name of the submitter.
        submitter_email (Optional[str]): The email of the submitter.
        submitter_user_id (Optional[int]): The ID of the associated user, if available.
        timestamp (datetime): The timestamp when the submission was made.
        status (str): The status of the submission (e.g., 'pending', 'approved', 'rejected').
        created (datetime): The timestamp when the record was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "codex_user_submissions"

    id: Mapped[intpk]
    submission_type: Mapped[str]
    data: Mapped[Dict[str, Any]] = mapped_column(JSON)
    submitter_name: Mapped[Optional[str]]
    submitter_email: Mapped[Optional[str]]
    submitter_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    timestamp: Mapped[dt_create]
    status: Mapped[Codex_Submission_Status] = mapped_column(
        Enum(Codex_Submission_Status), default=Codex_Submission_Status.pending
    )
    created: Mapped[dt_create]
    updated: Mapped[dt_update]


class CodexReference(Base):
    """
    Model representing a reference between Codex entries.

    Attributes:
        id (int): Primary Key of the model.
        from_entry_id (int): The ID of the entry from which the reference originates.
        to_entry_id (int): The ID of the entry to which the reference points.
        context (Optional[str]): Context or description of the reference.
        created (datetime): The timestamp when the reference was created.
        updated (datetime): The timestamp when the record was last updated.
    """  # noqa: E501

    __tablename__ = "codex_references"

    id: Mapped[intpk]
    from_entry_id: Mapped[int] = mapped_column(ForeignKey("codex_entries.id", ondelete="CASCADE"))
    to_entry_id: Mapped[int] = mapped_column(ForeignKey("codex_entries.id", ondelete="CASCADE"))
    context: Mapped[Optional[str]]
    created: Mapped[dt_create]
    updated: Mapped[dt_update]
