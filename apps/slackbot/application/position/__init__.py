from pydantic import BaseModel


class PositionData(BaseModel):
    id: int
    name: str
    description: str | None = None
    org_id: int | None = None
    org_type: str | None = None
    is_active: bool = True


class UserAssignmentData(BaseModel):
    user_id: int
    f3_name: str | None = None


class PositionWithAssignmentsData(PositionData):
    users: list[UserAssignmentData] = []
