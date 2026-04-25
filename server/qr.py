from __future__ import annotations
import time
import qrcode


def print_startup_info(public_url: str, room_code: str) -> None:
    # Cache-buster appended to printed URLs so phones don't reuse a stale
    # index.html from before the latest mobile/overlay rebuild. Different
    # value per server start.
    cb = int(time.time())
    mobile_url = f"{public_url}/mobile?server={public_url}&room={room_code}&slot=2&v={cb}"
    overlay_url = f"{public_url}/overlay?server={public_url}&room={room_code}&v={cb}"

    print()
    print("=== SHADOW FIGHT SERVER READY ===")
    print(f"Public URL: {public_url}")
    print(f"Room code:  {room_code}")
    print()
    print("Share this URL with your teammate (opens on their phone):")
    print(f"  {mobile_url}")
    print()
    print("Open the overlay at:")
    print(f"  {overlay_url}")
    print()
    print("Scan to join on mobile:")

    qr = qrcode.QRCode()
    qr.add_data(mobile_url)
    qr.make(fit=True)
    qr.print_ascii(invert=True)
