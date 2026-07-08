"""Vendored browser-act SKILL.md packs (see VENDOR.md) + catalog/manifest code.

This package root holds only our own code (``catalog.py``, ``manifest.py``).
The ``<category>/<pack-name>/`` subdirectories are vendored data (SKILL.md +
scripts/*.py, copied verbatim from https://github.com/browser-act/skills) and
are NOT Python packages themselves — they hold no ``__init__.py`` and are
never imported, only scanned/read as files by ``catalog.py``.
"""
