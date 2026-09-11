"""Package identity: the version the CLI and JSON payloads stamp must be the
version the package is built with."""

import tomllib
from pathlib import Path

import omr


def test_version_matches_pyproject() -> None:
    # `omr_version` in every .omr.json and the `omr <version>` identity line
    # come from omr.__version__; pyproject.toml is what uv builds. A bump to
    # one without the other would stamp outputs with the wrong identity.
    pyproject = Path(__file__).resolve().parents[1] / "pyproject.toml"
    project = tomllib.loads(pyproject.read_text(encoding="utf-8"))["project"]
    assert omr.__version__ == project["version"]
