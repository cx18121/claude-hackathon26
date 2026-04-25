from __future__ import annotations
import time
import qrcode


def print_startup_info(public_url: str, room_code: str) -> None:
    # Cache-buster so phones don't reuse a stale index.html after a rebuild.
    cb = int(time.time())
    p1_url = f"{public_url}/mobile?server={public_url}&room={room_code}&slot=1&v={cb}"
    p2_url = f"{public_url}/mobile?server={public_url}&room={room_code}&slot=2&v={cb}"
    overlay_url = f"{public_url}/overlay?server={public_url}&room={room_code}&v={cb}"

    print()
    print("=== SHADOW FIGHT SERVER READY ===")
    print(f"Public URL: {public_url}")
    print(f"Room code:  {room_code}")
    print()
    print("Open this URL on YOUR phone (Player 1):")
    print(f"  {p1_url}")
    print()
    print("Share this URL with your teammate (Player 2):")
    print(f"  {p2_url}")
    print()
    print("Open the overlay (laptop screen):")
    print(f"  {overlay_url}")
    print()
    # QR encodes the teammate URL so a host can show their laptop screen
    # for the visiting player to scan from across the room.
    print("Scan to join on mobile (Player 2):")

    qr = qrcode.QRCode()
    qr.add_data(p2_url)
    qr.make(fit=True)
    qr.print_ascii(invert=True)
