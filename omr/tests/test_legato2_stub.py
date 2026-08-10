"""The Legato2Backend stub: present, honest, and unusable by design."""

import pytest

from omr.backends import get_backend
from omr.backends.base import OMRBackend
from omr.backends.legato2 import Legato2Backend
from omr.errors import Legato2NotAvailableError
from omr.ingest import load_score


def test_stub_instantiates_and_satisfies_protocol() -> None:
    backend = Legato2Backend()
    assert isinstance(backend, OMRBackend)
    assert backend.name == "legato2"
    info = backend.model_info()
    assert info.model_id is None  # no released checkpoint exists to name


def test_stub_is_selectable_via_registry() -> None:
    assert isinstance(get_backend("legato2"), Legato2Backend)


def test_transcribe_raises_with_precise_blocker_message(png_score) -> None:
    backend = Legato2Backend()
    source = load_score(png_score)

    with pytest.raises(Legato2NotAvailableError) as exc_info:
        backend.transcribe(source)

    message = str(exc_info.value)
    assert "LEGATO 2" in message
    assert "not been released" in message
    # names the exact unusable artifacts and where to watch
    assert "legato-1.5" in message
    assert "2607.05769" in message
    assert "docs/omr/legato2.md" in message
