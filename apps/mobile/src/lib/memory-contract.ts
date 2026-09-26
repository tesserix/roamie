// Generated from Rust memories.rs; run cargo test export_memory_contract.
export type Theme = "postcard" | "cinema" | "journal";
export type Soundtrack = "none" | "wander" | "sunset" | "upload";
export type MemoryOptions = { theme: Theme, soundtrack: Soundtrack, openingCaption: string, year?: number, audio?: string, };
