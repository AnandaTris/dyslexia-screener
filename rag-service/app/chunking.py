def chunk_text(text: str, *, max_chars: int = 2400, overlap_chars: int = 400) -> list[str]:
    """Split text into overlapping chunks on word boundaries.

    ~2400 chars ≈ 600 tokens, ~400 char overlap ≈ 100 tokens. Every returned
    chunk is guaranteed to be at most `max_chars` long: a single token longer
    than `max_chars` is hard-sliced, and the overlap tail is dropped when
    carrying it would push a chunk over the limit.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    # Hard-slice any single token longer than max_chars so no word alone can
    # blow the budget.
    words: list[str] = []
    for w in text.split():
        while len(w) > max_chars:
            words.append(w[:max_chars])
            w = w[max_chars:]
        words.append(w)

    chunks: list[str] = []
    current: list[str] = []
    length = 0

    for word in words:
        add = len(word) + (1 if current else 0)
        if length + add > max_chars and current:
            chunk = " ".join(current)
            chunks.append(chunk)
            # start the next chunk with an overlapping tail of the previous one
            tail = chunk[-overlap_chars:]
            current = tail.split()
            length = len(" ".join(current))
            # if carrying the tail would overflow this word, drop the tail
            if length + len(word) + (1 if current else 0) > max_chars:
                current = []
                length = 0
                add = len(word)
        current.append(word)
        length += add

    if current:
        chunks.append(" ".join(current))
    return chunks
