import type { Metadata } from "next";
import { ActivationForm } from "@/components/activation-form";
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
      <ActivationForm />
    </AuthPanel>
  );
}
