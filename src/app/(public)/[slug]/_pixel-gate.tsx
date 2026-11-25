// Server-only pixel consent gate rendered ONLY on eligible routes (/{slug} and /{slug}/cabang/{branch}; PR-39, UX-51; T-127 r2).
// Re-verifies HMAC cookie against live DB { metaPixelId, gaMeasurementId } fingerprint; emits nonce-stamped loader ONLY on verified "terima".
import { headers } from "next/headers";
import { PixelConsentBanner, PixelConsentWithdraw } from "../_pixel-consent-banner";
import {
  buildPixelInitScript,
  hasActivePixel,
  normalizeActivePixelConfig,
  pixelConsentSecret,
  redactedPublicPath,
  safeTestStubOrigin,
  signBannerPresentationToken,
  verifyPixelConsentCookieForSite,
} from "../_pixel-policy";

export async function PublicPixelGate({
  slug,
  pathname,
  clinicName,
  metaPixelId,
  gaMeasurementId,
  pixelConfigRevision,
}: {
  slug: string;
  pathname: string;
  clinicName: string;
  metaPixelId: string | null;
  gaMeasurementId: string | null;
  pixelConfigRevision: number;
}) {
  const safePath = redactedPublicPath(pathname, slug);
  if (!safePath) return null;

  const config = normalizeActivePixelConfig({ metaPixelId, gaMeasurementId, revision: pixelConfigRevision });
  if (!hasActivePixel(config)) return null;

  const secret = pixelConsentSecret();
  if (!secret) return null;

  const hdrs = await headers();
  const cookieHeader = hdrs.get("cookie");
  const nonce = hdrs.get("x-nonce") ?? undefined;
  const choice = verifyPixelConsentCookieForSite(secret, cookieHeader, { slug, config });
  const action = `/api/v1/public/pixel-consent?slug=${encodeURIComponent(slug)}`;

  if (choice === "unset") {
    const presentationToken = signBannerPresentationToken(secret, { slug, config });
    return (
      <PixelConsentBanner
        clinicName={clinicName}
        slug={slug}
        action={action}
        returnTo={safePath}
        privacyHref={`/${encodeURIComponent(slug)}/kebijakan-privasi`}
        presentationToken={presentationToken}
      />
    );
  }

  return (
    <>
      {choice === "terima" && (
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: buildPixelInitScript(config, safePath, safeTestStubOrigin()),
          }}
        />
      )}
      <PixelConsentWithdraw slug={slug} action={action} returnTo={safePath} choice={choice} />
    </>
  );
}
