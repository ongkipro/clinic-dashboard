// The Meta messaging port for the Pesan inbox (PR-28, TD-25; T-090, DEC-102). Only the mock adapter exists (mock.ts; DEC-082: no live Meta
// call). The app calls it, then records the result through the inbox definers; the port never reaches SQL.
export type TemplateCategory = "utility" | "marketing" | "authentication";

export type SendInput =
  | { kind: "text"; metaWabaId: string; phoneNumberId: string; to: string; body: string; accessToken: string }
  | { kind: "template"; metaWabaId: string; phoneNumberId: string; to: string; templateName: string; language: string; params: string[]; accessToken: string };

export type RemoteTemplate = { name: string; language: string; category: TemplateCategory; status: "pending" | "approved" | "rejected"; body: string; paramCount: number };

export interface InboxPort {
  sendMessage(i: SendInput): Promise<{ providerMessageId: string }>;
  fetchTemplates(i: { metaWabaId: string; accessToken: string }): Promise<RemoteTemplate[]>;
}
