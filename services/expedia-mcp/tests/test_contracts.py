import pytest
from pydantic import ValidationError

from expedia_recommendations_mcp.contracts import ActivityQuery, CarQuery, FlightQuery, HotelQuery


@pytest.mark.parametrize(
    "extra",
    [
        {"tenant_id": "other"},
        {"destination": ""},
        {"destination": "x" * 201},
        {"query_text": "x" * 2001},
        {"number_of_travelers": True},
        {"number_of_travelers": 21},
        {"number_of_travelers": -1},
        {"amenities": ["pool"] * 21},
        {"guest_rating": float("inf")},
        {"check_in": "2026-02-30"},
        {"check_in": "2026-W42-1"},
        {"check_in": "2026-12-10", "check_out": "2026-12-09"},
    ],
)
def test_invalid_or_unbounded_queries_are_rejected(extra: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        HotelQuery.model_validate({"destination": "Paris", **extra})


def test_same_day_activity_and_car_searches_remain_valid() -> None:
    assert (
        ActivityQuery(destination="Paris", start_date="2026-12-10", end_date="2026-12-10").end_date
        == "2026-12-10"
    )
    query = CarQuery(
        pickup_location="Paris",
        pickup_date="2026-12-10",
        dropoff_date="2026-12-10",
        pickup_time="09:00",
        dropoff_time="18:00",
    )
    assert query.dropoff_time == "18:00"


def test_bad_times_and_airline_codes_are_rejected() -> None:
    with pytest.raises(ValidationError):
        CarQuery(pickup_location="Paris", pickup_time="25:00")
    with pytest.raises(ValidationError):
        CarQuery(
            pickup_location="Paris",
            pickup_date="2026-12-10",
            dropoff_date="2026-12-10",
            pickup_time="18:00",
            dropoff_time="09:00",
        )
    with pytest.raises(ValidationError):
        FlightQuery(origin="MEL", destination="LHR", airline_code="\r\n")
