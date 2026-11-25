// Public aftercare OTP route handler (PR-70, ARCH-3, DEC-117 Rows 1/7).
import type { NextRequest } from "next/server";
import { appPool } from "../../../../../modules/org/context/store";
import { handleAftercarePost } from "./handler";

export async function POST(request: NextRequest) {
  return handleAftercarePost(request, await appPool());
}
