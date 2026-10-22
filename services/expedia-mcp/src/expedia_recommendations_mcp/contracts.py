from datetime import date, time
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator
from tesserix_mcp_runtime import JsonValue

MAX_DATA_CHARS = 65536


def calendar_date(value: str) -> str:
    if date.fromisoformat(value).isoformat() != value:
        raise ValueError("date must use YYYY-MM-DD")
    return value


def clock_time(value: str) -> str:
    if time.fromisoformat(value).isoformat(timespec="minutes") != value:
        raise ValueError("time must use HH:MM")
    return value


def validate_airline_code(value: str) -> str:
    if not value.isascii() or not value.isalnum() or value != value.upper():
        raise ValueError("invalid airline code")
    return value


type Place = Annotated[str, Field(min_length=1, max_length=200)]
type Day = Annotated[
    str,
    Field(min_length=10, max_length=10, json_schema_extra={"format": "date"}),
    AfterValidator(calendar_date),
]
type Clock = Annotated[str, Field(min_length=5, max_length=5), AfterValidator(clock_time)]
type Labels = Annotated[
    list[Annotated[str, Field(min_length=1, max_length=80)]], Field(max_length=20)
]
type Nonnegative = Annotated[float, Field(ge=0, le=100000, allow_inf_nan=False)]
type Category = Literal["hotels", "flights", "activities", "cars"]


class Query(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", strict=True)
    query_text: Annotated[str, Field(max_length=2000)] = ""

    @model_validator(mode="after")
    def ordered_dates(self) -> Self:
        values = self.model_dump()
        for start, end in [
            ("check_in", "check_out"),
            ("start_date", "end_date"),
            ("pickup_date", "dropoff_date"),
        ]:
            if not values.get(start) or not values.get(end):
                continue
            if values[end] < values[start] or (
                start == "check_in" and values[end] == values[start]
            ):
                raise ValueError("end date must follow start date")
            if (
                start == "pickup_date"
                and values[end] == values[start]
                and values.get("pickup_time")
                and values.get("dropoff_time")
                and values["dropoff_time"] <= values["pickup_time"]
            ):
                raise ValueError("dropoff must follow pickup")
        return self


class HotelQuery(Query):
    destination: Place
    check_in: Day | None = None
    check_out: Day | None = None
    property_types: Labels | None = None
    number_of_travelers: Annotated[int, Field(ge=1, le=20)] | None = None
    min_bedrooms: Annotated[int, Field(ge=0, le=20)] | None = None
    amenities: Labels | None = None
    guest_rating: Annotated[float, Field(ge=0, le=10, allow_inf_nan=False)] | None = None
    star_ratings: Annotated[list[Annotated[int, Field(ge=1, le=5)]], Field(max_length=5)] | None = (
        None
    )
    sort_type: Annotated[str, Field(min_length=1, max_length=40)] | None = None
    distance: Nonnegative | None = None


class FlightQuery(Query):
    origin: Place
    destination: Place
    departure_date: Day | None = None
    airline_code: (
        Annotated[str, Field(min_length=2, max_length=3), AfterValidator(validate_airline_code)]
        | None
    ) = None
    number_of_stops: Annotated[int, Field(ge=0, le=4)] | None = None
    sort_type: Annotated[str, Field(min_length=1, max_length=40)] | None = None


class ActivityQuery(Query):
    destination: Place
    start_date: Day | None = None
    end_date: Day | None = None
    categories: Labels | None = None
    duration: Annotated[int, Field(ge=1, le=10080)] | None = None
    price_max: Nonnegative | None = None


class CarQuery(Query):
    pickup_location: Place
    dropoff_location: Place | None = None
    pickup_date: Day | None = None
    pickup_time: Clock | None = None
    dropoff_date: Day | None = None
    dropoff_time: Clock | None = None
    car_classes: Labels | None = None


class Result(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    status: Literal["ok", "unavailable"]
    data: JsonValue = None


class ToolResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    status: Literal["ok", "unavailable"]
    data_json: Annotated[str, Field(max_length=MAX_DATA_CHARS)] | None = None
