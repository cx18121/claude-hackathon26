from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, ConfigDict


class PoseKeypoint(BaseModel):
    model_config = ConfigDict(frozen=True)
    x: float
    y: float
    z: float
    visibility: float


# Mobile -> Server

class MsgJoin(BaseModel):
    model_config = ConfigDict(frozen=True)
    type: Literal["join"]
    room_code: str
    player_slot: Literal[1, 2]


class MsgPoseFrame(BaseModel):
    model_config = ConfigDict(frozen=True)
    type: Literal["pose_frame"]
    timestamp: float
    keypoints: list[PoseKeypoint]  # always 33


class MsgCalibrationDone(BaseModel):
    model_config = ConfigDict(frozen=True)
    type: Literal["calibration_done"]
    reference_velocity: float


class MsgPing(BaseModel):
    model_config = ConfigDict(frozen=True)
    type: Literal["ping"]
    t: float


# Server -> Mobile

class MsgJoined(BaseModel):
    type: Literal["joined"] = "joined"
    room_code: str
    player_slot: Literal[1, 2]
    opponent_connected: bool


class MsgPong(BaseModel):
    type: Literal["pong"] = "pong"
    t: float


class MsgCalibrationStart(BaseModel):
    type: Literal["calibration_start"] = "calibration_start"


class MsgMatchStart(BaseModel):
    type: Literal["match_start"] = "match_start"


class MsgYouWereHit(BaseModel):
    type: Literal["you_were_hit"] = "you_were_hit"
    region: str
    damage: int


class MsgPlayerDisconnected(BaseModel):
    type: Literal["player_disconnected"] = "player_disconnected"
    player: Literal[1, 2]


# Server -> Overlay (spectator)

class HitEvent(BaseModel):
    player: Literal[1, 2]
    region: str
    damage: int
    position: dict[str, float]  # {"x": ..., "y": ..., "z": ...}


class MsgGameState(BaseModel):
    type: Literal["game_state"] = "game_state"
    tick: int
    hp: tuple[int, int]
    poses: tuple[list[PoseKeypoint], list[PoseKeypoint]]
    recent_hits: list[HitEvent]
    high_latency: bool
    remaining_time: float


class MsgRoundStart(BaseModel):
    type: Literal["round_start"] = "round_start"
    round_number: int


class MsgRoundEnd(BaseModel):
    type: Literal["round_end"] = "round_end"
    winner: Literal[1, 2] | None  # None = draw
    final_hp: tuple[int, int]


class MsgMatchEnd(BaseModel):
    type: Literal["match_end"] = "match_end"
    winner: Literal[1, 2]


# Union type for parsing inbound mobile messages

from typing import Union, Annotated
from pydantic import Field

InboundMobileMsg = Annotated[
    Union[MsgJoin, MsgPoseFrame, MsgCalibrationDone, MsgPing, MsgPong],
    Field(discriminator="type"),
]


def parse_mobile_msg(data: dict) -> InboundMobileMsg:
    from pydantic import TypeAdapter
    adapter = TypeAdapter(InboundMobileMsg)
    return adapter.validate_python(data)
