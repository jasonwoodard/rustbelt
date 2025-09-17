import csv
import requests
import time
import sys
import os
from datetime import datetime

API_KEY = "YOUR_GOOGLE_PLACES_API_KEY"

def get_place_id(name, address):
    """Find a Google Place ID from store name + address."""
    query = f"{name}, {address}"
    url = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
    params = {
        "input": query,
        "inputtype": "textquery",
        "fields": "place_id",
        "key": API_KEY
    }
    r = requests.get(url, params=params).json()
    candidates = r.get("candidates", [])
    if candidates:
        return candidates[0]["place_id"]
    return None

def get_opening_hours(place_id):
    """Fetch opening hours + source URL from a Place ID."""
    url = "https://maps.googleapis.com/maps/api/place/details/json"
    params = {
        "place_id": place_id,
        "fields": "opening_hours,formatted_address,name,url",
        "key": API_KEY
    }
    r = requests.get(url, params=params).json()
    result = r.get("result", {})

    hours_text = result.get("opening_hours", {}).get("weekday_text", [])
    gmap_url = result.get("url", "")

    return hours_text, gmap_url

def to_24h_range(time_range):
    """
    Convert ranges like:
      '9:00 AM – 5:00 PM'
      '9:00 AM – 12:00 PM, 1:00 PM – 5:00 PM'
    into:
      '09:00 - 17:00'
      '09:00 - 12:00, 13:00 - 17:00'
    """
    time_range = time_range.strip()
    if not time_range or "Closed" in time_range:
        return "Closed"
    if "Appointment" in time_range:
        return "By Appointment"

    segments = [seg.strip() for seg in time_range.split(",")]
    converted_segments = []

    for seg in segments:
        parts = [p.strip() for p in seg.replace("–", "-").split("-")]
        if len(parts) != 2:
            converted_segments.append(seg)  # fallback
            continue

        start, end = parts
        try:
            dt_start = datetime.strptime(start, "%I:%M %p")
        except ValueError:
            try:
                dt_start = datetime.strptime(start, "%I %p")
            except ValueError:
                dt_start = None

        try:
            dt_end = datetime.strptime(end, "%I:%M %p")
        except ValueError:
            try:
                dt_end = datetime.strptime(end, "%I %p")
            except ValueError:
                dt_end = None

        if dt_start and dt_end:
            converted_segments.append(f"{dt_start.strftime('%H:%M')} - {dt_end.strftime('%H:%M')}")
        else:
            converted_segments.append(seg)  # fallback

    return ", ".join(converted_segments)

def normalize_hours(weekday_text):
    """
    Convert Google's weekday_text list into a dict with 24h times.
    Example input: ["Monday: 9:00 AM – 5:00 PM", ...]
    """
    day_map = {
        "Monday": "Closed",
        "Tuesday": "Closed",
        "Wednesday": "Closed",
        "Thursday": "Closed",
        "Friday": "Closed",
        "Saturday": "Closed",
        "Sunday": "Closed",
    }

    for entry in weekday_text:
        try:
            day, hours = entry.split(":", 1)
            hours = hours.strip()
            day_map[day] = to_24h_range(hours)
        except Exception:
            continue

    return day_map

def compress_raw_hours(weekday_text):
    """
    Compact Google weekday_text into a single field.
    Example: "Mon: 9-5; Tue: 9-5; Wed: Closed ..."
    """
    parts = []
    for entry in weekday_text:
        try:
            day, hours = entry.split(":", 1)
            parts.append(f"{day[:3]} {hours.strip()}")
        except Exception:
            continue
    return "; ".join(parts)

def main():
    if len(sys.argv) < 2:
        print("Usage: python google-hours.py <input_csv>")
        sys.exit(1)

    input_csv = sys.argv[1]
    if not os.path.exists(input_csv):
        print(f"Error: File not found: {input_csv}")
        sys.exit(1)

    output_csv = "store_hours_output.csv"

    with open(input_csv, newline='', encoding="utf-8") as f_in, \
         open(output_csv, "w", newline='', encoding="utf-8") as f_out:

        reader = csv.DictReader(f_in)
        fieldnames = [
            "StoreID", "StoreName", "Address",
            "Monday Hours", "Tuesday Hours", "Wednesday Hours",
            "Thursday Hours", "Friday Hours", "Saturday Hours", "Sunday Hours",
            "RawHours", "Source"
        ]
        writer = csv.DictWriter(f_out, fieldnames=fieldnames)
        writer.writeheader()

        for row in reader:
            store_id = row.get("StoreID", "").strip()
            store_name = row.get("StoreName", "").strip()
            address = row.get("Address", "").strip()

            place_id = get_place_id(store_name, address)
            if place_id:
                hours_text, source_url = get_opening_hours(place_id)
                day_map = normalize_hours(hours_text)
                raw_hours = compress_raw_hours(hours_text)
            else:
                day_map = {day: "Unknown" for day in
                           ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]}
                raw_hours = "Unknown"
                source_url = ""

            out_row = {
                "StoreID": store_id,
                "StoreName": store_name,
                "Address": address,
                "Monday Hours": day_map["Monday"],
                "Tuesday Hours": day_map["Tuesday"],
                "Wednesday Hours": day_map["Wednesday"],
                "Thursday Hours": day_map["Thursday"],
                "Friday Hours": day_map["Friday"],
                "Saturday Hours": day_map["Saturday"],
                "Sunday Hours": day_map["Sunday"],
                "RawHours": raw_hours,
                "Source": source_url
            }
            writer.writerow(out_row)

            print(f"Processed: {store_id} {store_name}")
            time.sleep(0.2)  # stay gentle on quota

    print(f"\n✅ Finished! Results saved to {output_csv}")

if __name__ == "__main__":
    main()
