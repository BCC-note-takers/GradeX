#!/usr/bin/env python3
"""Download every Markdown note under a Drive folder (recursively) into a local folder.

Read-only: uses the drive.readonly scope. No 50-file limit, no public sharing needed.

Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, DRIVE_REFRESH_TOKEN, DRIVE_NOTES_FOLDER_ID
Usage: python drive_fetch.py <out_dir>
"""
import io
import os
import re
import sys
from pathlib import Path

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

FOLDER = "application/vnd.google-apps.folder"
SCOPE = "https://www.googleapis.com/auth/drive.readonly"


def safe(name: str) -> str:
    return re.sub(r"[\\/:*?\"<>|]", "_", name).strip() or "_"


def main(out: str) -> None:
    creds = Credentials(
        None,
        refresh_token=os.environ["DRIVE_REFRESH_TOKEN"],
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=[SCOPE],
    )
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    root_id = os.environ["DRIVE_NOTES_FOLDER_ID"].strip()
    m = re.search(r"/folders/([A-Za-z0-9_-]+)", root_id)      # tolerate a pasted full link
    if m:
        root_id = m.group(1)
    try:
        meta = drive.files().get(fileId=root_id, fields="id,name,mimeType", supportsAllDrives=True).execute()
    except Exception as e:
        sys.exit(f"Cannot open the folder with this token (wrong ID, or the token's account has no access): {e}")
    out_p = Path(out)
    out_p.mkdir(parents=True, exist_ok=True)
    count = 0

    def children(fid):
        page = None
        while True:
            r = drive.files().list(
                q=f"'{fid}' in parents and trashed = false",
                fields="nextPageToken, files(id, name, mimeType)",
                pageSize=1000, pageToken=page,
                supportsAllDrives=True, includeItemsFromAllDrives=True,
            ).execute()
            yield from r.get("files", [])
            page = r.get("nextPageToken")
            if not page:
                return

    def walk(fid, dest: Path):
        nonlocal count
        for f in children(fid):
            name = safe(f["name"])
            if f["mimeType"] == FOLDER:
                walk(f["id"], dest / name)
            elif name.lower().endswith(".md") and not name.startswith("_"):
                dest.mkdir(parents=True, exist_ok=True)
                buf = io.BytesIO()
                dl = MediaIoBaseDownload(buf, drive.files().get_media(fileId=f["id"], supportsAllDrives=True))
                done = False
                while not done:
                    _, done = dl.next_chunk()
                (dest / name).write_bytes(buf.getvalue())
                count += 1

    walk(root_id, out_p)
    print(f"Downloaded {count} markdown files.")
    if count == 0:
        sys.exit("No .md files found: check DRIVE_NOTES_FOLDER_ID and the token.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: drive_fetch.py <out_dir>")
    main(sys.argv[1])
