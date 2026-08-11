"""Backend protocol conformance and registry selection tests."""

import subprocess
import sys

import pytest
from conftest import FakeBackend

from omr.backends import available_backends, get_backend, register_backend, unregister_backend
from omr.backends.base import OMRBackend


def test_fake_backend_satisfies_protocol(fake_backend: FakeBackend) -> None:
    assert isinstance(fake_backend, OMRBackend)


def test_registry_selection_and_listing() -> None:
    register_backend("fake", FakeBackend)
    try:
        backend = get_backend("fake")
        assert backend.name == "fake"
        assert "fake" in available_backends()
        assert "legato_v1" in available_backends()
        assert "legato2" in available_backends()
    finally:
        unregister_backend("fake")


def test_registry_passes_options_through() -> None:
    register_backend("fake", FakeBackend)
    try:
        backend = get_backend("fake", fail=True)
        assert backend._fail is True
    finally:
        unregister_backend("fake")


def test_unknown_backend_error_lists_available() -> None:
    with pytest.raises(ValueError, match=r"unknown backend 'nope'.*legato2"):
        get_backend("nope")


def test_backend_module_import_is_lazy() -> None:
    # Importing the registry must not import backend modules (they may carry
    # heavy model deps). Checked in a fresh interpreter so this test cannot
    # be poisoned by other tests importing backends first.
    code = (
        "import sys; import omr.backends; "
        "assert 'omr.backends.legato_v1' not in sys.modules; "
        "assert 'torch' not in sys.modules"
    )
    subprocess.run([sys.executable, "-c", code], check=True)
