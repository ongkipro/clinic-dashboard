// Any unknown /vendor/* path renders the vendor not-found inside the vendor layout (a
// request render with the CSP nonce), not the prerendered global 404.
import { notFound } from "next/navigation";

export default function VendorUnknown() {
  notFound();
}
