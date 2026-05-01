#!/usr/bin/env python3
"""
Generate shared/protocol.ts from server/protocol.py (single source of truth).

Usage:
  python scripts/gen_protocol.py          # write shared/protocol.ts
  python scripts/gen_protocol.py --check  # exit 1 if output would differ (pre-commit)
"""
from __future__ import annotations

import sys
import types
import typing
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

import protocol as P  # noqa: E402
from pydantic import BaseModel  # noqa: E402

# ---------------------------------------------------------------------------
# Type mapper
# ---------------------------------------------------------------------------

_SCALAR: dict[type, str] = {
    str: "string",
    int: "number",
    float: "number",
    bool: "boolean",
}


def _ts(t: typing.Any) -> str:
    if t in _SCALAR:
        return _SCALAR[t]
    if t is type(None):
        return "null"

    origin = typing.get_origin(t)
    args = typing.get_args(t)

    # Python 3.10+ `X | Y` union syntax
    if isinstance(t, types.UnionType):
        return " | ".join(_ts(a) for a in t.__args__)

    if origin is typing.Literal:
        return " | ".join(f'"{a}"' if isinstance(a, str) else str(a) for a in args)

    if origin is list:
        return f"{_ts(args[0])}[]"

    if origin is tuple:
        return "[" + ", ".join(_ts(a) for a in args) + "]"

    if origin is dict:
        return f"{{ [key: {_ts(args[0])}]: {_ts(args[1])} }}"

    if origin is typing.Union:
        return " | ".join(_ts(a) for a in args)

    if isinstance(t, type) and issubclass(t, BaseModel):
        return t.__name__

    raise ValueError(f"Cannot map Python type {t!r} to TypeScript")


def _interface(cls: type[BaseModel]) -> str:
    lines = [f"export interface {cls.__name__} {{"]
    for name, field in cls.model_fields.items():
        ann = field.annotation
        # Unwrap Annotated[X, ...] (e.g. Field constraints)
        if typing.get_origin(ann) is typing.Annotated:
            ann = typing.get_args(ann)[0]
        lines.append(f"  {name}: {_ts(ann)};")
    lines.append("}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Output structure
# ---------------------------------------------------------------------------

def _generate() -> str:
    out: list[str] = []

    out.append(
        "// Generated from server/protocol.py — do not edit by hand.\n"
        "// Run: python scripts/gen_protocol.py\n"
    )

    out.append("export type PlayerSlot = 1 | 2;")
    out.append("export type HpPair = [number, number];")
    out.append("")

    out.append(_interface(P.PoseKeypoint))
    out.append("")
    out.append(_interface(P.Position))
    out.append("")

    out.append("// " + "=" * 76)
    out.append("// Mobile -> Server")
    out.append("// " + "=" * 76)
    out.append("")

    for cls in (P.MsgJoin, P.MsgPoseFrame, P.MsgCalibrationDone, P.MsgPing):
        out.append(_interface(cls))
        out.append("")

    out.append(
        "export type OutboundMobileMsg =\n"
        "  | MsgJoin\n"
        "  | MsgPoseFrame\n"
        "  | MsgCalibrationDone\n"
        "  | MsgPing\n"
        "  | MsgPong;"  # pong response to server-originated pings
    )
    out.append("")

    out.append("// " + "=" * 76)
    out.append("// Server -> Mobile")
    out.append("// " + "=" * 76)
    out.append("")

    for cls in (
        P.MsgJoined,
        P.MsgPong,
        P.MsgCalibrationStart,
        P.MsgMatchStart,
        P.MsgYouWereHit,
        P.MsgPlayerDisconnected,
        P.MsgRoundStart,
        P.MsgRoundEnd,
        P.MsgMatchEnd,
    ):
        out.append(_interface(cls))
        out.append("")

    out.append("// " + "=" * 76)
    out.append("// Server -> Overlay")
    out.append("// " + "=" * 76)
    out.append("")

    out.append(_interface(P.HitEvent))
    out.append("")
    out.append(_interface(P.MsgGameState))
    out.append("")

    out.append(
        "// Pushed to spectators the moment a pose_frame arrives — decoupled from\n"
        "// the 60 Hz game-state tick so the overlay renders at mobile capture rate."
    )
    out.append(_interface(P.MsgPoseUpdate))
    out.append("")

    out.append("// Commentator messages (server -> overlay only).")
    for cls in (
        P.MsgCommentaryStart,
        P.MsgCommentaryText,
        P.MsgCommentaryAudio,
        P.MsgCommentaryEnd,
    ):
        out.append(_interface(cls))
        out.append("")

    out.append(_interface(P.MsgLobbyUpdate))
    out.append("")
    out.append(_interface(P.MsgRematchStart))
    out.append("")

    out.append(
        "export type InboundServerMsg =\n"
        "  | MsgJoined\n"
        "  | MsgPing\n"  # server-originated pings for RTT measurement
        "  | MsgPong\n"
        "  | MsgCalibrationStart\n"
        "  | MsgMatchStart\n"
        "  | MsgYouWereHit\n"
        "  | MsgPlayerDisconnected\n"
        "  | MsgRoundStart\n"
        "  | MsgRoundEnd\n"
        "  | MsgMatchEnd\n"
        "  | MsgGameState\n"
        "  | MsgPoseUpdate\n"
        "  | MsgCommentaryStart\n"
        "  | MsgCommentaryText\n"
        "  | MsgCommentaryAudio\n"
        "  | MsgCommentaryEnd;"
    )
    out.append("")

    out.append(
        "export type ServerMessage =\n"
        "  | MsgLobbyUpdate\n"
        "  | MsgGameState\n"
        "  | MsgPoseUpdate\n"
        "  | MsgRoundStart\n"
        "  | MsgRoundEnd\n"
        "  | MsgMatchEnd\n"
        "  | MsgRematchStart\n"
        "  | MsgCommentaryStart\n"
        "  | MsgCommentaryText\n"
        "  | MsgCommentaryAudio\n"
        "  | MsgCommentaryEnd;"
    )
    out.append("")

    return "\n".join(out)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    check_mode = "--check" in sys.argv
    output_path = ROOT / "shared" / "protocol.ts"
    generated = _generate()

    if check_mode:
        existing = output_path.read_text() if output_path.exists() else ""
        if existing != generated:
            print(
                "error: shared/protocol.ts is out of date.\n"
                "Run: python scripts/gen_protocol.py",
                file=sys.stderr,
            )
            sys.exit(1)
        print("shared/protocol.ts is up to date.")
    else:
        output_path.write_text(generated)
        print(f"Written: {output_path}")


if __name__ == "__main__":
    main()
