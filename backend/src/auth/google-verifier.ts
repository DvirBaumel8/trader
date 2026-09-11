import { Injectable, Logger } from '@nestjs/common';

export interface GoogleIdentity {
  googleId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Verifies a Google ID token.
 *
 * Its own injectable for the same reason `YahooClient` is: it is the only
 * thing here that talks to the network, so it is the only thing tests have to
 * stub, and swapping identity providers touches one file.
 *
 * Unconfigured is a first-class state, not an error. Without
 * GOOGLE_CLIENT_ID there is nothing to verify against, `isConfigured()` says
 * so, and the frontend never offers the button — the same shape the LLM's
 * `configured` flag already uses.
 */
@Injectable()
export class GoogleVerifier {
  private readonly logger = new Logger(GoogleVerifier.name);

  isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_CLIENT_ID);
  }

  async verify(idToken: string): Promise<GoogleIdentity | null> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return null;

    try {
      // Imported lazily so the dependency is only loaded when Google sign-in
      // is actually configured — and so a deployment without it cannot fail
      // to boot over a package it never uses.
      const { OAuth2Client } = await import('google-auth-library');
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({
        idToken,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub) return null;
      // An unverified email must not be trusted to match an existing account:
      // that is an account-takeover path, not a convenience.
      const email = payload.email_verified ? (payload.email ?? null) : null;
      return {
        googleId: payload.sub,
        email,
        displayName: payload.name ?? null,
        avatarUrl: payload.picture ?? null,
      };
    } catch (error) {
      this.logger.warn(`Google ID token rejected: ${String(error)}`);
      return null;
    }
  }
}
