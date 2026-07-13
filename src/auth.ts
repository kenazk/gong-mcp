// Stytch OAuth 2.1 + email-domain auth for Confido MCP servers.
//
// Copy this file to sibling Confido MCP repos (cs-mcp, etc.) alongside
// well-known.ts. See /Users/bndemers/.claude/plans/how-easy-would-it-noble-zephyr.md
// for the multi-MCP architecture. When the fleet hits ~5 MCPs, extract to
// @confido/mcp-auth on GitHub Packages.
//
// Multi-MCP note: Stytch tokens have aud=project_id, so two MCPs sharing a
// project accept each other's tokens. To isolate them, add per-MCP OAuth
// scopes when the second MCP lands and validate here via claims.scope.

import { Client } from "stytch";

export interface AuthOk {
  ok: true;
  user: string;
}

export interface AuthFail {
  ok: false;
  reason:
    | "no_token"
    | "invalid_token"
    | "no_email"
    | "not_confido_staff";
}

export type AuthResult = AuthOk | AuthFail;

export interface AuthConfig {
  projectId: string;
  projectSecret: string;
  projectDomain: string;
  staffEmailDomain: string;
}

const EMAIL_CACHE_TTL_MS = 5 * 60 * 1000;

export function createAuthenticator(config: AuthConfig) {
  const client = new Client({
    project_id: config.projectId,
    secret: config.projectSecret,
    custom_base_url: config.projectDomain,
  });

  const staffDomain = config.staffEmailDomain.toLowerCase();
  const emailCache = new Map<string, { email: string; expiresAt: number }>();

  const emailForSubject = async (subject: string): Promise<string | null> => {
    const cached = emailCache.get(subject);
    if (cached && cached.expiresAt > Date.now()) return cached.email;

    try {
      const response = await client.users.get({ user_id: subject });
      const verified = response.emails.find((e) => e.verified);
      const email = verified?.email ?? response.emails[0]?.email ?? null;
      if (email) {
        emailCache.set(subject, {
          email,
          expiresAt: Date.now() + EMAIL_CACHE_TTL_MS,
        });
      }
      return email;
    } catch {
      return null;
    }
  };

  return async function authenticate(bearer: string): Promise<AuthResult> {
    if (!bearer) return { ok: false, reason: "no_token" };

    try {
      const claims = await client.idp.introspectTokenLocal(bearer);
      const email = await emailForSubject(claims.subject);
      if (!email) return { ok: false, reason: "no_email" };

      const domain = email.toLowerCase().split("@").at(-1);
      if (domain !== staffDomain) {
        return { ok: false, reason: "not_confido_staff" };
      }

      return { ok: true, user: email };
    } catch {
      return { ok: false, reason: "invalid_token" };
    }
  };
}
