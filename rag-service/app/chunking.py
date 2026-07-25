def chunk_text(text: str, *, max_chars: int = 2400, overlap_chars: int = 400) -> list[str]:
    """Split text into overlapping chunks on word boundaries.

    ~2400 chars ≈ 600 tokens, ~400 char overlap ≈ 100 tokens.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    words = text.split()
    chunks: list[str] = []
    current: list[str] = []
    length = 0

    for word in words:
        add = len(word) + (1 if current else 0)
        if length + add > max_chars and current:
            chunk = " ".join(current)
            chunks.append(chunk)
            # start next chunk with an overlapping tail of the previous one
            tail = chunk[-overlap_chars:]
            current = tail.split()
            length = len(" ".join(current))
        current.append(word)
        length += add

    if current:
        chunks.append(" ".join(current))
    return chunks
