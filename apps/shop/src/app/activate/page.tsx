import type { Metadata } from "next";
import { ActivationFormLoader } from "@/components/activation-form-loader";
import { AuthPanel } from "@/components/auth-panel";

export const metadata: Metadata = {
  title: "Activate access",
  // The page is opened with a personal link: no referrer to other sites.
  // Not "no-referrer": browsers then send "Origin: null" with forms, and
  // the policy stays for the whole document, so the sign-in form reached
  // with "Continue to sign in" would fail the shop's origin check. The
  // token is in the fragment, which is never part of a referrer anyway.
  referrer: "same-origin",
};

/** First password with the one-time link from the supplier (no self-registration) */
export default function ActivatePage() {
  return (
    <AuthPanel
      title="Activate your access"
      intro="Choose the password for your shop access. The link from your invitation works once."
    >
      <ActivationFormLoader />
    </AuthPanel>
  );
}
