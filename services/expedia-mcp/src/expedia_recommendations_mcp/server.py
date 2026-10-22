import json
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

from expedia_recommendations_mcp.client import JSON, ExpediaClient
from expedia_recommendations_mcp.contracts import (
    ActivityQuery,
    CarQuery,
    Category,
    FlightQuery,
    HotelQuery,
    Query,
    Result,
    ToolResult,
)


class RecommendationTool:
    def __init__(self, client: ExpediaClient, category: Category, model: type[Query]) -> None:
        self._client = client
        self._category = category
        self._model = model
        self.metadata = ToolMetadata(
            name=f"get_{category[:-1] if category != 'activities' else 'activity'}_recommendations",
            title=f"Expedia {category} recommendations",
            description=f"Read Expedia {category} recommendations; no booking or payment action.",
            effect=ToolEffect.READ,
            approval=ApprovalRequirement.NOT_REQUIRED,
            idempotency=IdempotencyRequirement.NOT_APPLICABLE,
            required_scopes=("travel:recommendations:read",),
        )
        input_schema = JSON.validate_python(model.model_json_schema())
        output_schema = JSON.validate_python(ToolResult.model_json_schema())
        if not isinstance(input_schema, dict) or not isinstance(output_schema, dict):
            raise ValueError("invalid tool schema")
        self.input_schema = input_schema
        self.output_schema = output_schema

    def parse_input(self, arguments: Mapping[str, JsonValue]) -> Query:
        return self._model.model_validate(dict(arguments))

    async def handler(self, input_model: Query, *, context: CallContext) -> Result:
        return await self._client.search(self._category, input_model)

    def serialize_output(self, output_model: Result) -> JsonValue:
        result = ToolResult(
            status=output_model.status,
            data_json=json.dumps(output_model.data, separators=(",", ":"), ensure_ascii=False)
            if output_model.status == "ok"
            else None,
        )
        return JSON.validate_python(result.model_dump(mode="json"))


def catalog(client: ExpediaClient) -> ToolCatalog:
    tools: list[ToolDefinition[Any, Any]] = [
        RecommendationTool(client, "hotels", HotelQuery),
        RecommendationTool(client, "flights", FlightQuery),
        RecommendationTool(client, "activities", ActivityQuery),
        RecommendationTool(client, "cars", CarQuery),
    ]
    return ToolCatalog(tools)


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


def application(*, transport: ApplicationTransport, client: ExpediaClient) -> Application:
    return Application(
        catalog=catalog(client),
        authorizer=Authorization(),
        transport=transport,
        telemetry=Telemetry(),
        limits=ApplicationLimits(drain_timeout=10),
        clock=SystemClock(),
        execution_limits=ExecutionLimits(
            max_tools=4,
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
