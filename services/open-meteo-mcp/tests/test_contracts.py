import pytest
from pydantic import ValidationError

from open_meteo_mcp.contracts import ForecastQuery


def test_forecast_accepts_one_location_and_bounded_horizon():
    query = ForecastQuery(latitude=-37.8, longitude=145.0, forecast_days=3)
    assert query.model_dump() == {"latitude": -37.8, "longitude": 145.0, "forecast_days": 3}


@pytest.mark.parametrize(
    "changes",
    [
        {"latitude": 91},
        {"longitude": -181},
        {"latitude": float("nan")},
        {"latitude": "-37.8"},
        {"latitude": True},
        {"forecast_days": 17},
        {"forecast_days": 0},
        {"forecast_days": "3"},
        {"url": "http://169.254.169.254"},
        {"apikey": "caller-key"},
    ],
)
def test_invalid_coordinates_horizons_or_upstream_parameters_are_rejected(changes):
    with pytest.raises(ValidationError):
        ForecastQuery.model_validate({"latitude": -37.8, "longitude": 145.0, **changes})
