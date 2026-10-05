import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";
import { formatCentsAsUsd } from "../lib/money";

export interface EmailService {
  sendOwnershipConfirmation(args: {
    to: string;
    brandName: string;
    slotNumber: number;
    amountCents: number;
    managementUrl: string;
  }): Promise<void>;

  sendManagementLink(args: { to: string; slotNumber: number; managementUrl: string }): Promise<void>;

  sendPaymentReceipt(args: {
    to: string;
    brandName: string;
    amountCents: number;
    providerPaymentId: string | null;
  }): Promise<void>;

  sendOutbidNotification(args: {
    to: string;
    brandName: string;
    slotNumber: number;
    newBidCents: number;
  }): Promise<void>;
}

/** Development-friendly implementation that logs instead of sending real email. */
class ConsoleEmailService implements EmailService {
  async sendOwnershipConfirmation(args: {
    to: string;
    brandName: string;
    slotNumber: number;
    amountCents: number;
    managementUrl: string;
  }): Promise<void> {
    console.log(
      `[email] Ownership confirmation -> ${args.to}\n` +
        `  Your brand "${args.brandName}" now owns Spot #${args.slotNumber} for ${formatCentsAsUsd(args.amountCents)}.\n` +
        `  Manage it here: ${args.managementUrl}`,
    );
  }

  async sendManagementLink(args: { to: string; slotNumber: number; managementUrl: string }): Promise<void> {
    console.log(
      `[email] Management link -> ${args.to}\n  Spot #${args.slotNumber}: ${args.managementUrl}`,
    );
  }

  async sendPaymentReceipt(args: {
    to: string;
    brandName: string;
    amountCents: number;
    providerPaymentId: string | null;
  }): Promise<void> {
    console.log(
      `[email] Payment receipt -> ${args.to}\n` +
        `  ${formatCentsAsUsd(args.amountCents)} for "${args.brandName}" (payment ${args.providerPaymentId ?? "n/a"})`,
    );
  }

  async sendOutbidNotification(args: {
    to: string;
    brandName: string;
    slotNumber: number;
    newBidCents: number;
  }): Promise<void> {
    console.log(
      `[email] Outbid notice -> ${args.to}\n` +
        `  "${args.brandName}" was outbid on Spot #${args.slotNumber}. New bid: ${formatCentsAsUsd(args.newBidCents)}.`,
    );
  }
}

/**
 * Shared implementation for every "real" provider: builds the same branded
 * (subject, html, text) for each notification, then hands off to whatever
 * `deliver` does the actual transmission. Keeps the email copy/design in one
 * place regardless of which provider is active, and means adding a new
 * provider is just implementing `deliver` — never touching the templates.
 *
 * Every send is best-effort: `deliver` implementations are expected to log
 * and swallow their own failures, never throw. Callers (see
 * paymentService.ts) fire these without awaiting — an unhandled rejection
 * from a real network call would otherwise be able to crash the process
 * over something as inconsequential as a transient delivery failure, for an
 * email that was never on the critical path to begin with (the
 * payment/ownership transfer already happened before we try to send
 * anything).
 */
abstract class RealEmailService implements EmailService {
  protected abstract deliver(to: string, subject: string, html: string, text: string): Promise<void>;

  async sendOwnershipConfirmation(args: {
    to: string;
    brandName: string;
    slotNumber: number;
    amountCents: number;
    managementUrl: string;
  }): Promise<void> {
    const amount = formatCentsAsUsd(args.amountCents);
    await this.deliver(
      args.to,
      `Your 100BID Spot #${args.slotNumber} is confirmed`,
      emailShell(`
        <p style="${p}">Your claim is confirmed.</p>
        ${detailTable([
          ["Spot", `#${args.slotNumber}`],
          ["Current amount", amount],
        ])}
        <p style="${p}">You currently hold this spot on the 100BID wall. If someone pays more,
        the spot will move to them.</p>
        ${button("Manage spot", args.managementUrl)}
        <p style="${muted}">Keep this private link safe. Anyone with the link can manage the spot.</p>
      `),
      `Your 100BID Spot #${args.slotNumber} is confirmed.\n\n` +
        `Spot: #${args.slotNumber}\n` +
        `Current amount: ${amount}\n\n` +
        `You currently hold this spot on the 100BID wall. If someone pays more, the spot will move to them.\n\n` +
        `Manage spot: ${args.managementUrl}\n\n` +
        `Keep this private link safe. Anyone with the link can manage the spot.`,
    );
  }

  async sendManagementLink(args: { to: string; slotNumber: number; managementUrl: string }): Promise<void> {
    await this.deliver(
      args.to,
      `Your 100BID management link for Spot #${args.slotNumber}`,
      emailShell(`
        <p style="${p}">Here is your private management link for Spot #${args.slotNumber}.</p>
        ${button("Manage spot", args.managementUrl)}
        <p style="${muted}">Keep this private link safe. Anyone with the link can manage the spot.</p>
      `),
      `Your management link for Spot #${args.slotNumber}: ${args.managementUrl}\n\n` +
        `Keep this private link safe. Anyone with the link can manage the spot.`,
    );
  }

  async sendPaymentReceipt(args: {
    to: string;
    brandName: string;
    amountCents: number;
    providerPaymentId: string | null;
  }): Promise<void> {
    const amount = formatCentsAsUsd(args.amountCents);
    await this.deliver(
      args.to,
      `Receipt: ${amount} on 100BID`,
      emailShell(`
        <p style="${p}">This confirms your payment for ${escapeHtml(args.brandName)} on 100BID.</p>
        ${detailTable([
          ["Amount", amount],
          ["Payment ID", args.providerPaymentId ?? "n/a"],
        ])}
      `),
      `Receipt for ${args.brandName} on 100BID\nAmount: ${amount}\nPayment ID: ${args.providerPaymentId ?? "n/a"}`,
    );
  }

  async sendOutbidNotification(args: {
    to: string;
    brandName: string;
    slotNumber: number;
    newBidCents: number;
  }): Promise<void> {
    const amount = formatCentsAsUsd(args.newBidCents);
    await this.deliver(
      args.to,
      `Spot #${args.slotNumber} has a new holder`,
      emailShell(`
        <p style="${p}">Spot #${args.slotNumber} has a new holder.</p>
        ${detailTable([
          ["Spot", `#${args.slotNumber}`],
          ["New amount", amount],
        ])}
        <p style="${p}">${escapeHtml(args.brandName)} no longer holds this spot — someone paid
        more. Your history stays on the spot's record, and you can claim it back any time by
        paying more than the current amount.</p>
        ${button("View the wall", `${env.APP_URL.replace(/\/$/, "")}`)}
      `),
      `Spot #${args.slotNumber} has a new holder. ${args.brandName} no longer holds it — someone paid ${amount}.\n\n` +
        `You can claim it back any time by paying more than the current amount.\n\n` +
        `View the wall: ${env.APP_URL.replace(/\/$/, "")}`,
    );
  }
}

/**
 * Delivery via Resend's HTTP API. Unlike Gmail's SMTP, Resend sends from a
 * verified sending domain (100bid.lol, once its DNS records are added) —
 * so EMAIL_FROM is used as-is, no address substitution needed the way
 * GmailEmailService has to for its From header.
 */
class ResendEmailService extends RealEmailService {
  protected async deliver(to: string, subject: string, html: string, text: string): Promise<void> {
    try {
      if (!env.EMAIL_API_KEY) {
        throw new Error(
          "Resend is not configured. Set EMAIL_API_KEY to your Resend API key " +
            "(from resend.com/api-keys), or set EMAIL_PROVIDER=console for local development.",
        );
      }

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.EMAIL_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html, text }),
      });

      if (!response.ok) {
        throw new Error(`Resend API error: ${response.status} ${await response.text()}`);
      }
    } catch (err) {
      console.error(`[email] Failed to send "${subject}" to ${to}:`, err);
    }
  }
}

/**
 * Real email delivery over Gmail's SMTP server, authenticated with a Gmail
 * account + an app password (not the account's normal login password —
 * Gmail requires app passwords for SMTP when 2-Step Verification is on,
 * which it must be to generate one at all).
 */
class GmailEmailService extends RealEmailService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
      throw new Error(
        "Gmail email is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD " +
          "(an app password from your Google Account's 2-Step Verification settings, " +
          "not your normal Gmail password), or set EMAIL_PROVIDER=console for local development.",
      );
    }

    this.transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: env.GMAIL_USER,
        // App passwords are shown by Google with spaces for readability
        // (e.g. "abcd efgh ijkl mnop") — strip them defensively in case
        // it was copy-pasted verbatim into the env file.
        pass: env.GMAIL_APP_PASSWORD.replace(/\s+/g, ""),
      },
    });

    return this.transporter;
  }

  /**
   * Gmail's SMTP server only accepts (or silently rewrites) a From address
   * that matches the authenticated mailbox or a verified "Send As" alias —
   * so unlike EMAIL_FROM's use elsewhere, only its display name survives
   * here, paired with the real GMAIL_USER address. This is also exactly why
   * Gmail-sent mail lands in spam far more often than a domain-authenticated
   * provider like Resend: recipients' filters see a brand name attached to
   * an unrelated free-mail address with no SPF/DKIM alignment to back it up.
   */
  private fromHeader(): string {
    const displayName = env.EMAIL_FROM.match(/^"?([^"<]+?)"?\s*</)?.[1]?.trim() || "100BID";
    return `"${displayName}" <${env.GMAIL_USER}>`;
  }

  protected async deliver(to: string, subject: string, html: string, text: string): Promise<void> {
    try {
      await this.getTransporter().sendMail({
        from: this.fromHeader(),
        to,
        subject,
        html,
        text,
      });
    } catch (err) {
      console.error(`[email] Failed to send "${subject}" to ${to}:`, err);
    }
  }
}

const p = "margin:0 0 14px;font-size:15px;line-height:1.6;color:#1c1916;";
const muted = "margin:20px 0 0;font-size:12px;line-height:1.5;color:#8a8279;";

/**
 * A plain bordered button, not a solid brand-color block — the same design
 * choice as the rest of this shell. Filled CTA buttons and heavy branding
 * read as "marketing template" to spam classifiers even on legitimately
 * transactional mail; a plainer, more document-like email consistently
 * lands in the inbox instead of spam.
 */
function button(label: string, url: string): string {
  return `
    <table role="presentation" style="margin:20px 0 4px;">
      <tr>
        <td style="border:1px solid #d6cfc5;border-radius:6px;">
          <a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 20px;font-size:14px;font-weight:600;color:#1c1916;text-decoration:none;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

/** A simple two-column key/value table — spot number, amount, payment ID,
 * whatever the message needs to state plainly rather than bury in prose. */
function detailTable(rows: Array<[string, string]>): string {
  return `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
      ${rows
        .map(
          ([label, value], i) => `
        <tr>
          <td style="padding:7px 0;${i > 0 ? "border-top:1px solid #ece6de;" : ""}color:#8a8279;">${escapeHtml(label)}</td>
          <td style="padding:7px 0;${i > 0 ? "border-top:1px solid #ece6de;" : ""}text-align:right;font-weight:600;color:#1c1916;">${escapeHtml(value)}</td>
        </tr>`,
        )
        .join("")}
    </table>`;
}

/**
 * Minimal, inline-styled HTML shell — email clients strip <style> blocks
 * and external stylesheets unpredictably, so every rule that matters lives
 * inline on the element itself.
 *
 * Deliberately plain: no logo, no color block, no rounded card shadow —
 * just a thin border and a small plain-text wordmark. A transactional email
 * that looks like a document rather than an ad campaign gets better inbox
 * placement, on top of just being the more honest tone for a receipt.
 */
function emailShell(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" style="width:100%;background:#f5f2ee;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" style="width:100%;max-width:440px;background:#ffffff;border:1px solid #e5dfd9;">
            <tr>
              <td style="padding:24px 28px 0;">
                <p style="margin:0 0 18px;font-size:13px;font-weight:600;letter-spacing:0.02em;color:#8a8279;">
                  100BID
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 26px;">
                ${bodyHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createEmailService(): EmailService {
  switch (env.EMAIL_PROVIDER) {
    case "resend":
      return new ResendEmailService();
    case "gmail":
      return new GmailEmailService();
    case "console":
    default:
      return new ConsoleEmailService();
  }
}

export const emailService: EmailService = createEmailService();
