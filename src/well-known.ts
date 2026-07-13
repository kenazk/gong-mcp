// RFC 9728 (protected resource metadata) + RFC 8414 (auth server metadata proxy)
// for MCP OAuth 2.1 discovery. See /Users/bndemers/.claude/plans/how-easy-would-it-noble-zephyr.md.
//
// The MCP spec (2025-06-18) requires the resource server to publish
// oauth-protected-resource metadata. We ALSO proxy Stytch's
// oauth-authorization-server metadata through the MCP host — the Stytch
// example does this so a single origin serves both endpoints, sidestepping
// discovery quirks in some MCP clients.

import type { Application, Request, Response } from "express";

export interface WellKnownConfig {
  resourceUrl: string;
  authorizationServerUrl: string;
}

export function registerWellKnownRoutes(
  app: Application,
  config: WellKnownConfig,
) {
  app.get(
    "/.well-known/oauth-protected-resource",
    (_req: Request, res: Response) => {
      res.json({
        resource: config.resourceUrl,
        authorization_servers: [config.authorizationServerUrl],
        bearer_methods_supported: ["header"],
      });
    },
  );

  app.get(
    "/.well-known/oauth-authorization-server",
    async (_req: Request, res: Response) => {
      try {
        const upstream = await fetch(
          `${config.authorizationServerUrl}/.well-known/oauth-authorization-server`,
        );
        if (!upstream.ok) {
          res.status(502).json({
            error: "auth_server_metadata_unavailable",
            status: upstream.status,
          });
          return;
        }
        const metadata = await upstream.json();
        res.json(metadata);
      } catch (err) {
        res.status(502).json({
          error: "auth_server_metadata_unreachable",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}

export function resourceMetadataUrl(mcpServerBaseUrl: string): string {
  return `${mcpServerBaseUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
}
