import LegalLayout from "../components/ui/LegalLayout";
import { useSettings } from "../context/SettingsContext";

export default function Privacy() {
  const { settings } = useSettings();
  const name = settings.siteName || "our platform";

  return (
    <LegalLayout
      title="Privacy Policy"
      updated="August 2026"
      intro={`This Privacy Policy explains how ${name} collects, uses, and protects your information when you use our website and services. By using ${name}, you agree to the practices described below.`}
      sections={[
        {
          h: "1. Information we collect",
          p: [
            "Account information: when you register, we collect your name, email address, and (for certain plans) phone number.",
            "Usage data: quizzes and tests you attempt, scores, progress, bookmarks, and activity needed to show your results and analytics.",
            "Payment information: when you purchase a plan, payments are processed by our payment provider (e.g. Razorpay). We do not store your full card or bank details on our servers.",
            "Technical data: basic device and browser information and cookies used to keep you signed in and improve the service.",
          ],
        },
        {
          h: "2. How we use your information",
          p: [
            "To create and manage your account, deliver quizzes, test series and study material, and show your performance analytics.",
            "To process subscriptions and payments and to provide customer support.",
            "To send important service messages (such as results, renewals, and security notices) and, where permitted, updates about new content.",
            "To keep the platform secure and to improve our features.",
          ],
        },
        {
          h: "3. Sharing your information",
          p: [
            `We do not sell your personal information. We share it only with trusted service providers who help us run ${name} (such as hosting, email, and payment processing), and only as needed to provide the service.`,
            "We may disclose information if required by law or to protect the rights, safety, and security of our users and platform.",
          ],
        },
        {
          h: "4. Data retention",
          p: "We keep your information for as long as your account is active or as needed to provide the service and meet legal obligations. You may request deletion of your account and associated personal data at any time.",
        },
        {
          h: "5. Your choices and rights",
          p: [
            "You can view and update your profile details from your account.",
            "You may request access to, correction of, or deletion of your personal data by contacting us.",
            "You can opt out of non-essential emails at any time.",
          ],
        },
        {
          h: "6. Security",
          p: "We use reasonable technical and organisational measures to protect your data. However, no method of transmission or storage is completely secure, and we cannot guarantee absolute security.",
        },
        {
          h: "7. Children's privacy",
          p: "Our services are intended for exam aspirants and students. If you are a minor, please use the platform under the guidance of a parent or guardian.",
        },
        {
          h: "8. Changes to this policy",
          p: "We may update this Privacy Policy from time to time. We will post the updated version on this page with a revised date.",
        },
      ]}
    />
  );
}
