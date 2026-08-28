import LegalLayout from "../components/ui/LegalLayout";
import { useSettings } from "../context/SettingsContext";

export default function Terms() {
  const { settings } = useSettings();
  const name = settings.siteName || "our platform";

  return (
    <LegalLayout
      title="Terms of Service"
      updated="August 2026"
      intro={`Welcome to ${name}. By accessing or using our website and services, you agree to these Terms of Service. Please read them carefully.`}
      sections={[
        {
          h: "1. Using our service",
          p: [
            `${name} provides quizzes, test series, study material, and performance analytics for exam preparation. You may browse free content, and access additional features by creating an account or purchasing a plan.`,
            "You agree to use the platform lawfully and not to misuse, disrupt, or attempt to gain unauthorised access to any part of the service.",
          ],
        },
        {
          h: "2. Accounts",
          p: [
            "You are responsible for keeping your login details confidential and for all activity under your account.",
            "You agree to provide accurate information and to keep it up to date. We may suspend or terminate accounts that violate these terms.",
          ],
        },
        {
          h: "3. Subscriptions and payments",
          p: [
            "Some features require a paid subscription. Prices and plan details are shown on the pricing page and at checkout.",
            "Payments are processed securely through our payment provider. Access to paid features is granted for the duration of the plan you purchase.",
            "Please see our Refund & Cancellation Policy for details on refunds.",
          ],
        },
        {
          h: "4. Content and intellectual property",
          p: [
            `All content on ${name} — including questions, tests, study material, text, and design — is owned by us or our licensors and is protected by law.`,
            "You may use the content for your personal exam preparation only. You may not copy, redistribute, resell, or publicly share the content without our written permission.",
          ],
        },
        {
          h: "5. Acceptable use",
          p: [
            "Do not upload harmful, unlawful, or infringing material, attempt to scrape or copy the question bank, or share your account to give others unauthorised access.",
            "We reserve the right to remove content or restrict accounts that breach these rules.",
          ],
        },
        {
          h: "6. Disclaimer",
          p: [
            `${name} is a preparation aid. While we work hard to keep content accurate and up to date, we do not guarantee any particular exam result or that the content is error-free.`,
            "The service is provided \u201Cas is\u201D without warranties of any kind, to the extent permitted by law.",
          ],
        },
        {
          h: "7. Limitation of liability",
          p: "To the maximum extent permitted by law, we are not liable for any indirect, incidental, or consequential damages arising from your use of the service.",
        },
        {
          h: "8. Changes to the service and terms",
          p: "We may update, add, or remove features, and we may revise these terms from time to time. Continued use of the platform after changes means you accept the updated terms.",
        },
        {
          h: "9. Governing law",
          p: "These terms are governed by the applicable laws of India, and any disputes will be subject to the jurisdiction of the competent courts.",
        },
      ]}
    />
  );
}
