import { apiRequest } from "./trip-api";
import type { Group, GroupList } from "./group-budget";
import type { GroupChange, CreateGroup } from "./group-budget-contract";
export type { GroupChange } from "./group-budget-contract";
const read = <T>(
  path: string,
  payload: unknown,
  signal?: AbortSignal,
  method: "GET" | "POST" = "POST",
) => apiRequest<T>(path, payload, (res) => res.json(), 20000, signal, method);
export const listGroups = (after?: string, signal?: AbortSignal) =>
  read<GroupList>(
    `/v1/groups${after ? "?after=" + encodeURIComponent(after) : ""}`,
    undefined,
    signal,
    "GET",
  );
export const getGroup = (id: string, signal?: AbortSignal) =>
  read<Group>(`/v1/groups/${encodeURIComponent(id)}`, undefined, signal, "GET");
export const createGroup = (input: CreateGroup, signal?: AbortSignal) =>
  read<Group>("/v1/groups", input, signal);
export const changeGroup = (
  group: Group,
  requestId: string,
  change: GroupChange,
  signal?: AbortSignal,
) =>
  read<Group>(
    `/v1/groups/${encodeURIComponent(group.id)}/commands`,
    { requestId, expectedRevision: group.revision, change },
    signal,
  );
export const joinGroup = (id: string, signal?: AbortSignal) =>
  read<Group>(`/v1/groups/${encodeURIComponent(id)}/join`, {}, signal);
