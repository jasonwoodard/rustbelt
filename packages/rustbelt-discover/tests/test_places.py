"""Tests for discover.places — Google Places API client helpers."""

import pytest

from discover.places import GooglePlacesClient, _parse_cid, _parse_us_address


class _FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = ""

    def json(self):
        return self._payload


class _RecordingSession:
    """Captures the request kwargs of the last call and returns a canned page."""

    def __init__(self, payload):
        self._payload = payload
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        return _FakeResponse(self._payload)


class TestNearbySearchRequestShape:
    def test_uses_location_bias_circle_not_restriction(self):
        # Text Search (New) rejects a circle under locationRestriction (400);
        # a circle is only valid under locationBias. Guard against regressing.
        session = _RecordingSession({"places": []})
        client = GooglePlacesClient(session=session, api_key="k")

        client.nearby_search(
            lat=37.27, lon=-79.94, radius_meters=48280.0, search_text="thrift store"
        )

        body = session.calls[0]["json"]
        assert "locationBias" in body
        assert "locationRestriction" not in body
        assert body["locationBias"]["circle"]["radius"] == 48280.0
        assert body["textQuery"] == "thrift store"


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
