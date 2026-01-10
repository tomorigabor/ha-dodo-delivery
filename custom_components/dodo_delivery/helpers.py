\
from __future__ import annotations

import re
from typing import Optional

CODE_RE = re.compile(r"\b([A-Za-z0-9]{8})\b")
URL_RE = re.compile(r"t\.idodo\.group/([A-Za-z0-9]{8})", re.IGNORECASE)

def extract_code(text: str | None) -> Optional[str]:
    if not text:
        return None
    m = URL_RE.search(text)
    if m:
        return m.group(1).upper()
    m2 = CODE_RE.search(text)
    if m2:
        return m2.group(1).upper()
    return None
