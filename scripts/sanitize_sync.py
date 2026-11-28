#!/usr/bin/env python3
"""Build the public mirror of the notes archive.

1. Copy every .md file from the source checkout (SRC) into a clean staging folder (OUT).
2. Redact EVERY YouTube link in every note, except links inside a "Corrections" section
   (any heading containing "correction", e.g. "### Corrections Log"). That section runs until the next
   heading of the same or higher level, or the next "---" line. The youtube_url: header field is always redacted.
3. Write index.json (the file list the web app reads, since raw.githubusercontent.com cannot list folders).

Usage: python sanitize_sync.py <source_dir> <out_dir>
"""
import json
import os
import re
import shutil
import sys
from pathlib import Path

HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
YT_URL = r"\b(?:https?://)?(?:[\w-]+\.)*(?:youtube\.com|youtu\.be|youtube-nocookie\.com)(?:/[^\s)\]>\x22']*)?"   # scheme optional: catches bare youtu.be/ID too
YT = re.compile(YT_URL, re.IGNORECASE)
YT_MD = re.compile(r"\[[^\]]*\]\(\s*" + YT_URL + r"[^)]*\)", re.IGNORECASE)   # a whole [label](youtube-url) link
REDACTED = "(link removed)"
SKIP_DIRS = {".git", ".github", "scripts"}


FM_URL = re.compile(r"^(youtube_url:\s*)\S.*$")      # the recording link Log Studio stores in each note's header block


def sanitize(text: str, links_file: bool = False) -> tuple[str, int]:
    """Return (sanitized text, number of links redacted).

    links_file=True (video_links.md, the weekly list of recordings) is treated as one big Links section.
    The youtube_url: header field of each note is also redacted: it is metadata, not note text.
    """
    out, redacted = [], 0
    links_level = 0 if links_file else None   # heading level of the open "Links" section, or None
    corr_level = None                         # heading level of the open "Corrections" section (links kept there), or None
    for line in text.splitlines(keepends=True):
        body = line.rstrip("\r\n")
        if body.strip() == "---":
            corr_level = None                 # a note boundary / header block always closes the Corrections section
        fm = FM_URL.match(body)
        if fm:
            out.append(fm.group(1) + REDACTED + line[len(body):])
            redacted += 1
            continue
        m = HEADING.match(line.rstrip("\r\n"))
        if m:
            level = len(m.group(1))
            title = m.group(2).strip().lower()
            if links_level is not None and not links_file and level <= links_level:
                links_level = None         # a heading of the same or higher level closes the section
            if title == "links":
                links_level = level
            if corr_level is not None and level <= corr_level:
                corr_level = None
            if "correction" in title:
                corr_level = level
            out.append(line)
            continue
        # Every YouTube URL is redacted, except inside a Corrections section (never in the video_links file).
        if corr_level is not None and not links_file:
            out.append(line)
            continue
        line, n1 = YT_MD.subn(REDACTED, line)
        line, n2 = YT.subn(REDACTED, line)
        redacted += n1 + n2
        out.append(line)
    return "".join(out), redacted


def main(src: str, dst: str) -> None:
    src_p, dst_p = Path(src), Path(dst)
    # A zip often unpacks into one wrapper folder: use the folder that actually contains "years/".
    for cand in sorted(src_p.rglob("years"), key=lambda p: len(p.parts)):
        if cand.is_dir():
            src_p = cand.parent
            break
    if dst_p.exists():
        shutil.rmtree(dst_p)
    dst_p.mkdir(parents=True)

    files, total = [], 0
    for root, dirs, names in os.walk(src_p):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for name in names:
            if not name.lower().endswith(".md") or name.startswith("_"):
                continue
            path = Path(root) / name
            rel = path.relative_to(src_p).as_posix()
            text = path.read_text(encoding="utf-8")
            clean, n = sanitize(text, links_file=(name.lower() == "video_links.md"))
            total += n
            target = dst_p / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(clean, encoding="utf-8")
            files.append(rel)

    files.sort()
    (dst_p / "index.json").write_text(
        json.dumps({"files": files, "count": len(files)}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Sanitized {len(files)} note files; redacted {total} links in Links sections.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: sanitize_sync.py <source_dir> <out_dir>")
    main(sys.argv[1], sys.argv[2])
