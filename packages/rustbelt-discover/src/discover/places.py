"""Google Places API (New) client for rustbelt-discover."""

import logging
import re
import time
from typing import Optional
from urllib.parse import parse_qs, urlparse

import requests

from discover.types import (
    DETAILS_FIELD_MASK,
    NEARBY_SEARCH_FIELD_MASK,
    NEARBY_SEARCH_URL,
    PLACE_DETAILS_URL_TMPL,
    PlaceCandidate,
    PlaceDetails,
)

logger = logging.getLogger(__name__)

_TRANSIENT_STATUS_CODES = {429, 503}
_SKIP_STATUS_CODES = {400, 404}
_MAX_PAGES = 3
_PAGE_SIZE = 20
_INTER_CALL_DELAY = 0.1  # seconds between API calls


def _parse_cid(google_maps_uri: Optional[str]) -> Optional[str]:
    """Extract CID from a Google Maps URI if present."""
    if not google_maps_uri:
        return None
    parsed = urlparse(google_maps_uri)
    params = parse_qs(parsed.query)
    cid_values = params.get("cid")
    return cid_values[0] if cid_values else None


def _parse_us_address(
    formatted_address: str,
) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    """Parse a Google-formatted US address into (street, city, state, zip).

    Handles typical formats like:
      "111 W Venice Ave, Venice, FL 34285, USA"
      "Venice Antique Mall, 111 W Venice Ave, Venice, FL 34285, USA"
    """
    match = re.search(r",\s*([^,]+),\s*([A-Z]{2})\s+(\d{5})", formatted_address)
    if not match:
        return None, None, None, None
    city = match.group(1).strip()
    state = match.group(2).strip()
    zip_code = match.group(3).strip()
    street = formatted_address[: match.start()].strip().rstrip(",").strip() or None
    return street, city, state, zip_code


class GooglePlacesClient:
    def __init__(
        self,
        session: requests.Session,
        api_key: str,
        timeout: int = 20,
        retries: int = 3,
    ) -> None:
        self._session = session
        self._api_key = api_key
        self._timeout = timeout
        self._retries = retries
        self.nearby_search_calls: int = 0
        self.place_details_calls: int = 0

    def _request(
        self,
        method: str,
        url: str,
        **kwargs,
    ) -> Optional[requests.Response]:
        """Make an HTTP request with exponential backoff on transient errors.

        Returns None if retries are exhausted or a network error occurs.
        Returns the response (even non-2xx) so callers can handle skip codes.
        """
        last_exc: Optional[Exception] = None
        resp: Optional[requests.Response] = None

        for attempt in range(self._retries + 1):
            if attempt > 0:
                wait = 2 ** (attempt - 1)  # 1s, 2s, 4s
                logger.warning("Retrying in %ds (attempt %d)…", wait, attempt + 1)
                time.sleep(wait)

            try:
                resp = self._session.request(
                    method, url, timeout=self._timeout, **kwargs
                )
            except requests.RequestException as exc:
                last_exc = exc
                logger.warning("Request error (attempt %d): %s", attempt + 1, exc)
                continue

            if resp.status_code in _SKIP_STATUS_CODES:
                return resp  # caller decides whether to skip

            if resp.status_code in _TRANSIENT_STATUS_CODES:
                logger.warning(
                    "Transient HTTP %d (attempt %d)", resp.status_code, attempt + 1
                )
                last_exc = None
                continue

            return resp  # success or other error

        if last_exc:
            logger.warning("All retries exhausted: %s", last_exc)
        elif resp is not None:
            logger.warning(
                "All retries exhausted with HTTP %d", resp.status_code
            )
        return None

    def nearby_search(
        self,
        lat: float,
        lon: float,
        radius_meters: float,
        search_text: str,
    ) -> list[PlaceCandidate]:
        """Run a text search near (lat, lon) and return up to 60 candidates."""
        candidates: list[PlaceCandidate] = []
        page_token: Optional[str] = None

        for page_num in range(_MAX_PAGES):
            time.sleep(_INTER_CALL_DELAY)
            self.nearby_search_calls += 1

            body: dict = {
                "textQuery": search_text,
                "locationRestriction": {
                    "circle": {
                        "center": {"latitude": lat, "longitude": lon},
                        "radius": radius_meters,
                    }
                },
                "maxResultCount": _PAGE_SIZE,
            }
            if page_token:
                body["pageToken"] = page_token

            resp = self._request(
                "POST",
                NEARBY_SEARCH_URL,
                headers={
                    "X-Goog-Api-Key": self._api_key,
                    "X-Goog-FieldMask": NEARBY_SEARCH_FIELD_MASK,
                },
                json=body,
            )

            if resp is None:
                logger.warning(
                    "Nearby Search failed for '%s' page %d; skipping remaining pages.",
                    search_text,
                    page_num + 1,
                )
                break

            if resp.status_code != 200:
                logger.warning(
                    "Nearby Search HTTP %d for '%s': %s",
                    resp.status_code,
                    search_text,
                    resp.text[:200],
                )
                break

            data = resp.json()
            places = data.get("places", [])

            for place in places:
                place_id = place.get("id")
                if not place_id:
                    continue
                display_name = (place.get("displayName") or {}).get("text", "")
                candidates.append(
                    PlaceCandidate(
                        place_id=place_id,
                        display_name=display_name,
                        store_type="",  # assigned by caller after dedup
                    )
                )

            page_token = data.get("nextPageToken")
            if not page_token or len(places) < _PAGE_SIZE:
                break  # no more pages

        return candidates

    def place_details(
        self,
        place_id: str,
        store_type: str,
    ) -> Optional[PlaceDetails]:
        """Fetch Place Details for a single place ID.

        Returns None on unrecoverable error (skip this place).
        Returns a PlaceDetails with formatted_address=None if the response
        had no address (caller should skip and record the error).
        """
        time.sleep(_INTER_CALL_DELAY)
        self.place_details_calls += 1

        url = PLACE_DETAILS_URL_TMPL.format(place_id=place_id)
        resp = self._request(
            "GET",
            url,
            headers={
                "X-Goog-Api-Key": self._api_key,
                "X-Goog-FieldMask": DETAILS_FIELD_MASK,
            },
        )

        if resp is None:
            logger.warning("[skip] '%s': Place Details request failed after retries", place_id)
            return None

        if resp.status_code == 404:
            logger.warning("[skip] '%s': Place Details returned 404 — not found", place_id)
            return None

        if resp.status_code == 400:
            logger.warning("[skip] '%s': Place Details returned 400 — bad request", place_id)
            return None

        if resp.status_code != 200:
            logger.warning(
                "[skip] '%s': Place Details HTTP %d", place_id, resp.status_code
            )
            return None

        data = resp.json()
        display_name = (data.get("displayName") or {}).get("text", place_id)
        formatted_address: Optional[str] = data.get("formattedAddress")

        street: Optional[str] = None
        city: Optional[str] = None
        state: Optional[str] = None
        zip_code: Optional[str] = None
        if formatted_address:
            street, city, state, zip_code = _parse_us_address(formatted_address)

        location = data.get("location") or {}
        lat: Optional[float] = location.get("latitude")
        lon: Optional[float] = location.get("longitude")

        google_maps_uri: Optional[str] = data.get("googleMapsUri")
        google_cid = _parse_cid(google_maps_uri)

        hours_raw: Optional[dict] = data.get("regularOpeningHours")

        return PlaceDetails(
            place_id=place_id,
            display_name=display_name,
            store_type=store_type,
            formatted_address=formatted_address,
            address=street,
            city=city,
            state=state,
            zip=zip_code,
            lat=lat,
            lon=lon,
            google_maps_uri=google_maps_uri,
            google_cid=google_cid,
            has_hours=hours_raw is not None,
            hours_raw=hours_raw,
            types=data.get("types") or [],
            primary_type=data.get("primaryType"),
        )
