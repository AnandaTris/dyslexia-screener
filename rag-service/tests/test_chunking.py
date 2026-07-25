from app.chunking import chunk_text


def test_short_text_is_one_chunk():
    assert chunk_text("hello world") == ["hello world"]


def test_blank_text_yields_no_chunks():
    assert chunk_text("   \n  ") == []


def test_long_text_splits_with_overlap():
    text = " ".join(f"word{i}" for i in range(1000))  # ~7000 chars
    chunks = chunk_text(text, max_chars=2000, overlap_chars=200)
    assert len(chunks) > 1
    assert all(len(c) <= 2000 for c in chunks)
    # consecutive chunks overlap: the tail of one appears at the head region
    # of the next (some shared words), proving overlap is applied.
    assert chunks[0][-50:] in chunks[1] or chunks[1].startswith(chunks[0][-50:][:20])


def test_single_oversized_token_is_hard_split():
    token = "x" * 5000  # one token, no spaces, far bigger than max_chars
    chunks = chunk_text(token, max_chars=2000, overlap_chars=200)
    assert len(chunks) > 1
    assert all(len(c) <= 2000 for c in chunks)


def test_oversized_token_within_normal_text():
    text = "start " + ("y" * 4000) + " end and some more words here"
    chunks = chunk_text(text, max_chars=1500, overlap_chars=200)
    assert all(len(c) <= 1500 for c in chunks)
