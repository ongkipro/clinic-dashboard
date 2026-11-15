// The aftercare page's shared names (a "use server" file may export async functions only).
// `at` orders the two actions' answers: the page shows the latest one (review r1 P3-1).
export type OtpState = { step: "send" | "code" | "done"; message?: string; error?: string; blocked?: boolean; at?: number };
export const SESSION_COOKIE = "aftercare_session";
