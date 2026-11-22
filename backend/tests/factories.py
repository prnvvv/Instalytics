"""Synthetic export builders. All usernames are fictional; never add real export data here."""

from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Mapping

TS = 1_700_000_000  # 2023-11-14, arbitrary


def followers_entry(username: str, timestamp: int | None = TS, *, href: str | None = None) -> dict:
    item: dict = {"href": href or f"https://www.instagram.com/{username}", "value": username}
    if timestamp is not None:
        item["timestamp"] = timestamp
    return {"title": "", "media_list_data": [], "string_list_data": [item]}


def following_entry(username: str, timestamp: int | None = TS) -> dict:
    item: dict = {"href": f"https://www.instagram.com/_u/{username}"}
    if timestamp is not None:
        item["timestamp"] = timestamp
    return {"title": username, "media_list_data": [], "string_list_data": [item]}


def followers_json(*usernames: str) -> bytes:
    return json.dumps([followers_entry(name) for name in usernames]).encode()


def following_json(*usernames: str) -> bytes:
    payload = {"relationships_following": [following_entry(name) for name in usernames]}
    return json.dumps(payload).encode()


def make_zip(
    members: Mapping[str, bytes | str], *, compression: int = zipfile.ZIP_DEFLATED
) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=compression) as archive:
        for name, content in members.items():
            archive.writestr(name, content)
    return buffer.getvalue()
