// /vendor: the console opens on Tenant (every vendor role reads it, 19 §3).
import { redirect } from "next/navigation";

export default function VendorHome() {
  redirect("/vendor/tenant");
}
