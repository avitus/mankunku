"""Typed errors for the OMR subsystem."""


class OMRError(Exception):
    """Base class for all OMR subsystem errors."""


class UnsupportedInputError(OMRError):
    """The input file type is not one the pipeline accepts."""


class CorruptedInputError(OMRError):
    """The input file exists but cannot be decoded."""


class BackendUnavailableError(OMRError):
    """The selected backend cannot run (missing release, missing credentials...)."""


class Legato2NotAvailableError(BackendUnavailableError):
    """LEGATO 2 has not been publicly released; see docs/omr/legato2.md."""
