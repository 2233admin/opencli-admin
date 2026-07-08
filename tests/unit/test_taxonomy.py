"""Tests for the closed top-level category set (backend/taxonomy.py)."""

import pytest

from backend.taxonomy import TOP_LEVEL_CATEGORIES, is_valid_category


@pytest.mark.parametrize("category", TOP_LEVEL_CATEGORIES)
def test_is_valid_category_accepts_every_seed_value(category):
    assert is_valid_category(category) is True


def test_is_valid_category_rejects_unknown_name():
    assert is_valid_category("不存在的分类") is False


def test_is_valid_category_rejects_empty_string():
    assert is_valid_category("") is False


def test_is_valid_category_is_case_sensitive_for_non_matching_ascii():
    # Sanity check it's a strict membership test, not a fuzzy/normalized match.
    assert is_valid_category("Model Capability") is False


def test_top_level_categories_has_no_duplicates():
    assert len(TOP_LEVEL_CATEGORIES) == len(set(TOP_LEVEL_CATEGORIES))
