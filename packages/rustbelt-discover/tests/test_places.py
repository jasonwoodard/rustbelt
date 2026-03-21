"""Tests for discover.places — Google Places API client helpers."""

import pytest

from discover.places import _parse_cid, _parse_us_address


class TestParseCid:
    def test_extracts_cid_from_url(self):
        uri = "https://maps.google.com/?cid=12345678901234567"
        assert _parse_cid(uri) == "12345678901234567"

    def test_returns_none_when_no_cid(self):
        uri = "https://maps.google.com/maps/place/Venice+Antique+Mall"
        assert _parse_cid(uri) is None

    def test_returns_none_for_none_input(self):
        assert _parse_cid(None) is None

    def test_returns_none_for_empty_string(self):
        assert _parse_cid("") is None


class TestParseUsAddress:
    def test_standard_us_address(self):
        addr = "111 W Venice Ave, Venice, FL 34285, USA"
        street, city, state, zip_code = _parse_us_address(addr)
        assert street == "111 W Venice Ave"
        assert city == "Venice"
        assert state == "FL"
        assert zip_code == "34285"

    def test_address_with_store_name_prefix(self):
        addr = "Venice Antique Mall, 111 W Venice Ave, Venice, FL 34285, USA"
        street, city, state, zip_code = _parse_us_address(addr)
        assert city == "Venice"
        assert state == "FL"
        assert zip_code == "34285"
        assert street is not None

    def test_non_us_address_returns_nones(self):
        addr = "10 Downing Street, London, SW1A 2AA, UK"
        street, city, state, zip_code = _parse_us_address(addr)
        assert zip_code is None

    def test_zip_only_five_digits(self):
        addr = "123 Main St, Anytown, NY 10001-1234, USA"
        _, _, _, zip_code = _parse_us_address(addr)
        assert zip_code == "10001"
