import type { Metadata } from "next";
import { ActivationFormLoader } from "@/components/activation-form-loader";
import { AuthPanel } from "@/components/auth-panel";

export const metadata: Metadata = {
  title: "Activate access",
  // The page is opened with a personal link: no referrer to other sites
  referrer: "no-referrer",
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
