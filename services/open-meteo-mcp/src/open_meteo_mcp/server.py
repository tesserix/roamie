from collections.abc import Mapping
from typing import Any

from tesserix_mcp_runtime import (
    Application,
    ApplicationLimits,
    ApplicationTransport,
    ApprovalRequirement,
    CallContext,
    ErrorCode,
    ExecutionLimits,
    IdempotencyRequirement,
    JsonValue,
    RuntimeFailure,
    SystemClock,
    ToolCatalog,
    ToolDefinition,
    ToolEffect,
    ToolMetadata,
)

from open_meteo_mcp.client import JSON, OpenMeteoClient
from open_meteo_mcp.contracts import ForecastQuery, ForecastResult


class ForecastTool:
    def __init__(self, client: OpenMeteoClient) -> None:
        self._client = client
        self.metadata = ToolMetadata(
            name="get_weather_forecast",
            title="Open-Meteo daily weather forecast",
            description=(
                "Read up to 16 local forecast days for one coordinate. "
                "Retain Open-Meteo attribution; no long-term predictions or emergency warnings."
            ),
            effect=ToolEffect.READ,
            approval=ApprovalRequirement.NOT_REQUIRED,
            idempotency=IdempotencyRequirement.NOT_APPLICABLE,
            required_scopes=("weather:forecast:read",),
        )
        input_schema = JSON.validate_python(ForecastQuery.model_json_schema())
        output_schema = JSON.validate_python(ForecastResult.model_json_schema(mode="serialization"))
        if not isinstance(input_schema, dict) or not isinstance(output_schema, dict):
            raise ValueError("invalid tool schema")
        self.input_schema, self.output_schema = input_schema, output_schema

    def parse_input(self, arguments: Mapping[str, JsonValue]) -> ForecastQuery:
        return ForecastQuery.model_validate(dict(arguments))

    async def handler(self, input_model: ForecastQuery, *, context: CallContext) -> ForecastResult:
        return await self._client.forecast(input_model)

    def serialize_output(self, output_model: ForecastResult) -> JsonValue:
        return JSON.validate_python(output_model.model_dump(mode="json"))


def catalog(client: OpenMeteoClient) -> ToolCatalog:
    return ToolCatalog([ForecastTool(client)])


class Authorization:
    async def authorize(
        self,
        *,
        tool: ToolDefinition[Any, Any],
        arguments: Mapping[str, JsonValue],
        context: CallContext,
    ) -> None:
        if context.tenant != "roamie" or not set(tool.metadata.required_scopes) <= set(
            context.scopes
        ):
            raise RuntimeFailure(ErrorCode.FORBIDDEN)


class Telemetry:
    def emit(self, event: object) -> None:
        return None


def application(*, transport: ApplicationTransport, client: OpenMeteoClient) -> Application:
    return Application(
        catalog=catalog(client),
        authorizer=Authorization(),
        transport=transport,
        telemetry=Telemetry(),
        limits=ApplicationLimits(drain_timeout=10),
        clock=SystemClock(),
        execution_limits=ExecutionLimits(
            max_tools=1,
            max_input_bytes=8192,
            max_result_bytes=262144,
            max_global_concurrency=16,
            max_server_concurrency=16,
            max_tool_concurrency=8,
            max_tenant_concurrency=16,
            max_call_seconds=10,
            max_tool_seconds=9,
            max_attempts=1,
        ),
    )
