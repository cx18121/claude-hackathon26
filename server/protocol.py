from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


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
    keypoints: list[PoseKeypoint] = Field(min_length=33, max_length=33)


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

class Position(BaseModel):
    x: float
    y: float
    z: float


class HitEvent(BaseModel):
    player: Literal[1, 2]
    region: str
    damage: int
    position: Position


class MsgGameState(BaseModel):
    type: Literal["game_state"] = "game_state"
    tick: int
    hp: tuple[int, int]
    poses: tuple[list[PoseKeypoint], list[PoseKeypoint]]
    recent_hits: list[HitEvent]
    high_latency: bool
    remaining_time: float
    max_wins: int = 2


class MsgPoseUpdate(BaseModel):
    """Pushed to spectators on every pose_frame arrival, decoupled from the
    60Hz game-state tick. Carries only the bits needed to drive overlay
    rendering, so the overlay updates at the mobile capture rate (~60Hz)."""
    type: Literal["pose_update"] = "pose_update"
    player: Literal[1, 2]
    keypoints: list[PoseKeypoint]


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


class MsgRematchStart(BaseModel):
    type: Literal["rematch_start"] = "rematch_start"


class MsgLobbyUpdate(BaseModel):
    type: Literal["lobby_update"] = "lobby_update"
    p1: bool
    p2: bool


# Commentator messages (server -> overlay only)

class MsgCommentaryStart(BaseModel):
    type: Literal["commentary_start"] = "commentary_start"
    id: int


class MsgCommentaryText(BaseModel):
    type: Literal["commentary_text"] = "commentary_text"
    id: int
    delta: str


class MsgCommentaryAudio(BaseModel):
    type: Literal["commentary_audio"] = "commentary_audio"
    id: int
    idx: int
    mime: str
    audio_b64: str


class MsgCommentaryEnd(BaseModel):
    type: Literal["commentary_end"] = "commentary_end"
    id: int


# Union type for parsing inbound mobile messages

from typing import Union, Annotated
InboundMobileMsg = Annotated[
    Union[MsgJoin, MsgPoseFrame, MsgCalibrationDone, MsgPing, MsgPong],
    Field(discriminator="type"),
]


def parse_mobile_msg(data: dict) -> InboundMobileMsg:
    from pydantic import TypeAdapter
    adapter = TypeAdapter(InboundMobileMsg)
    return adapter.validate_python(data)
