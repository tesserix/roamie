from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator


class ForecastQuery(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", strict=True)
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    forecast_days: int = Field(default=7, ge=1, le=16)


class ForecastDay(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    local_date: date = Field(json_schema_extra={"maxLength": 10})
    weather_code: int = Field(ge=0, le=99, strict=True)
    maximum_celsius: Decimal = Field(
        ge=-100, le=70, allow_inf_nan=False, json_schema_extra={"maxLength": 32}
    )
    minimum_celsius: Decimal = Field(
        ge=-100, le=70, allow_inf_nan=False, json_schema_extra={"maxLength": 32}
    )
    precipitation_probability_percent: int = Field(ge=0, le=100, strict=True)
    uv_index: Decimal = Field(ge=0, le=30, allow_inf_nan=False, json_schema_extra={"maxLength": 32})

    @field_validator("maximum_celsius", "minimum_celsius", "uv_index", mode="before")
    @classmethod
    def bounded_measurement(cls, value: object) -> object:
        if len(str(value)) > 32:
            raise ValueError("measurement exceeds precision bound")
        return value

    @field_serializer("maximum_celsius", "minimum_celsius", "uv_index")
    def decimal_text(self, value: Decimal) -> str:
        return str(value)


class ForecastResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    status: Literal["ok", "unavailable"]
    source_url: Literal["https://open-meteo.com/en/docs"] = Field(
        default="https://open-meteo.com/en/docs", max_length=100
    )
    attribution: Literal["Weather data by Open-Meteo (CC BY 4.0)"] = Field(
        default="Weather data by Open-Meteo (CC BY 4.0)", max_length=100
    )
    observed_at: str | None = Field(default=None, max_length=40)
    timezone: str | None = Field(default=None, min_length=1, max_length=100)
    days: tuple[ForecastDay, ...] = Field(default=(), max_length=16)
