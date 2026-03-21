"""Search term configuration and store type mapping."""

from dataclasses import dataclass, field
from typing import Optional

# (type_key, google_search_text, storedb_store_type)
# Order determines priority: first match wins for deduplication.
SEARCH_TERMS: list[tuple[str, str, str]] = [
    ("thrift",  "thrift store",     "Thrift"),
    ("antique", "antique store",    "Antique"),
    ("antique", "antique mall",     "Antique"),
    ("vintage", "vintage store",    "Vintage"),
    ("vintage", "consignment shop", "Vintage"),
    ("flea",    "flea market",      "Flea"),
    ("surplus", "surplus store",    "Surplus"),
]

ALL_TYPE_KEYS: set[str] = {key for key, _, _ in SEARCH_TERMS}

MILES_TO_METERS: float = 1609.344
MAX_RADIUS_METERS: int = 50_000

# Field masks
NEARBY_SEARCH_FIELD_MASK = "places.id,places.displayName,places.primaryType"
DETAILS_FIELD_MASK = (
    "id,displayName,formattedAddress,location,"
    "regularOpeningHours,googleMapsUri,types,primaryType"
)

# API endpoints
NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
PLACE_DETAILS_URL_TMPL = "https://places.googleapis.com/v1/places/{place_id}"


@dataclass
class PlaceCandidate:
    place_id: str
    display_name: str
    store_type: str


@dataclass
class PlaceDetails:
    place_id: str
    display_name: str
    store_type: str
    formatted_address: Optional[str]
    address: Optional[str]          # street portion
    city: Optional[str]
    state: Optional[str]
    zip: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    google_maps_uri: Optional[str]
    google_cid: Optional[str]
    has_hours: bool                 # True if regularOpeningHours was present
    hours_raw: Optional[dict]       # raw regularOpeningHours dict
    types: list[str] = field(default_factory=list)
    primary_type: Optional[str] = None
