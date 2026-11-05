import type { Metadata } from "next";
import { ActivationFormLoader } from "@/components/activation-form-loader";
import { AuthPanel } from "@/components/auth-panel";

export const metadata: Metadata = {
  title: "New password",
  // A personal link: no referrer to other sites, as on the activation page
  // ("same-origin", not "no-referrer": see app/activate/page.tsx)
  referrer: "same-origin",
};

/**
 * A new password with a one-time reset link from the supplier (Sprint
 * 12C). There is no public "forgot password": the account manager creates
 * the link in the Backoffice.
 */
export default function ResetPasswordPage() {
  return (
    <AuthPanel
      title="Choose a new password"
      intro="Set a new password for your shop access. The link from your account manager works once and for 4 hours."
    >
      <ActivationFormLoader purpose="reset" />
    </AuthPanel>
  );
}
