import json
from collections.abc import Mapping
from importlib.resources import files
from typing import Any, Protocol

from jsonschema import Draft202012Validator
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

CONTRACT = json.loads(files("roamie_travel_mcp").joinpath("contract.json").read_text())


class Provider(Protocol):
    async def search(
        self, arguments: Mapping[str, JsonValue], *, context: CallContext
    ) -> JsonValue: ...


class UnavailableProvider:
    async def search(
        self, arguments: Mapping[str, JsonValue], *, context: CallContext
    ) -> JsonValue:
        return {"status": "unavailable", "facts": []}


class TravelTool:
    metadata = ToolMetadata(
        name="travel_search",
        title="Search Roamie travel evidence",
        description="Read travel evidence; unconfigured providers return unavailable.",
        effect=ToolEffect.READ,
        approval=ApprovalRequirement.NOT_REQUIRED,
        idempotency=IdempotencyRequirement.NOT_APPLICABLE,
        required_scopes=("roamie:travel:read",),
    )
    input_schema = CONTRACT["input"]
    output_schema = CONTRACT["output"]

    def __init__(self, provider: Provider) -> None:
        self._provider = provider

    def parse_input(self, arguments: Mapping[str, JsonValue]) -> dict[str, JsonValue]:
        document = dict(arguments)
        if not Draft202012Validator(CONTRACT["validation"]["input"]).is_valid(document):
            raise ValueError("invalid travel input")
        return document

    async def handler(
        self, input_model: dict[str, JsonValue], *, context: CallContext
    ) -> JsonValue:
        return await self._provider.search(input_model, context=context)

    def serialize_output(self, output_model: JsonValue) -> JsonValue:
        if not Draft202012Validator(CONTRACT["validation"]["output"]).is_valid(output_model):
            raise ValueError("invalid travel output")
        return output_model


class TravelAuthorization:
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
            raise RuntimeFailure(code=ErrorCode.FORBIDDEN)


class SafeTelemetry:
    def emit(self, event: object) -> None:
        # Runtime errors have already been scrubbed; do not print request arguments.
        return None


def build_application(
    *, transport: ApplicationTransport, provider: Provider | None = None
) -> Application:
    return Application(
        catalog=ToolCatalog([TravelTool(provider or UnavailableProvider())]),
        authorizer=TravelAuthorization(),
        transport=transport,
        telemetry=SafeTelemetry(),
        limits=ApplicationLimits(drain_timeout=10),
        clock=SystemClock(),
        execution_limits=ExecutionLimits(max_call_seconds=8, max_tool_seconds=8, max_attempts=1),
    )
