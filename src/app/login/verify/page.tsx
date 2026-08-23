import Image from "next/image";
import { VerifyForm } from "./verify-form";

export const metadata = { title: "Enter your code — Mastline" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = (await searchParams).next ?? "/work";

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Image alt="Mastline" height={30} priority src="/mastline-wordmark.png" width={174} />
        <h1>Enter your code</h1>
        <p className="section-note">
          Your password was accepted. Open your authenticator app and enter the current six-digit
          code.
        </p>
        <div className="spacer" />
        <VerifyForm next={next} />
      </div>
    </main>
  );
}
