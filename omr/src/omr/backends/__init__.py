"""Backend registry with lazy imports.

Backend modules may depend on torch/transformers; importing this package
must never pull those in. Concrete modules load only inside get_backend().
"""

from __future__ import annotations

import importlib
from collections.abc import Callable

from omr.backends.base import OMRBackend

_FACTORIES: dict[str, str] = {
    "legato_v1": "omr.backends.legato_v1:LegatoV1Backend",
    "legato2": "omr.backends.legato2:Legato2Backend",
}
_EXTRA: dict[str, Callable[..., OMRBackend]] = {}


def register_backend(name: str, factory: Callable[..., OMRBackend]) -> None:
    _EXTRA[name] = factory


def unregister_backend(name: str) -> None:
    _EXTRA.pop(name, None)


def available_backends() -> list[str]:
    return sorted(set(_FACTORIES) | set(_EXTRA))


def get_backend(name: str, **options: object) -> OMRBackend:
    if name in _EXTRA:
        return _EXTRA[name](**options)
    if name in _FACTORIES:
        module_name, _, attr = _FACTORIES[name].partition(":")
        module = importlib.import_module(module_name)
        return getattr(module, attr)(**options)
    raise ValueError(
        f"unknown backend '{name}'; available: {', '.join(available_backends())}"
    )
