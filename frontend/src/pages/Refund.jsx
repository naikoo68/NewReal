import LegalLayout from "../components/ui/LegalLayout";
import { useSettings } from "../context/SettingsContext";

export default function Refund() {
  const { settings } = useSettings();
  const name = settings.siteName || "our platform";

  return (
    <LegalLayout
      title="Refund & Cancellation Policy"
      updated="August 2026"
      intro={`This policy explains how refunds and cancellations work for paid subscriptions on ${name}.`}
      sections={[
        {
          h: "1. Digital subscriptions",
          p: `${name} sells digital access to quizzes, test series, and study material. Because access is granted immediately after payment, subscriptions are generally non-refundable once activated, except as described below.`,
        },
        {
          h: "2. Free trial",
          p: "Where a free trial or free content is available, we encourage you to try the platform before purchasing a paid plan so you know what you are getting.",
        },
        {
          h: "3. When you may be eligible for a refund",
          p: [
            "You were charged more than once for the same plan (duplicate payment).",
            "A technical error on our side prevented you from accessing the paid features and we were unable to resolve it within a reasonable time.",
            "You cancelled within any cooling-off period explicitly stated at the time of purchase.",
          ],
        },
        {
          h: "4. How to request a refund",
          p: [
            "Contact us within 7 days of the payment with your registered email and the payment details.",
            "We will review the request and, if approved, process the refund to the original payment method. Refunds may take several business days to appear, depending on your bank or payment provider.",
          ],
        },
        {
          h: "5. Cancellation",
          p: [
            "You can choose not to renew at any time; your access remains active until the end of the current paid period.",
            "Cancelling stops future renewals but does not automatically refund the current period unless you qualify under section 3.",
          ],
        },
        {
          h: "6. Changes to this policy",
          p: "We may update this Refund & Cancellation Policy from time to time. The latest version will always be available on this page.",
        },
      ]}
    />
  );
}
