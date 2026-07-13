#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';
import express from 'express';
import { createAuthenticator } from './auth.js';
import { registerWellKnownRoutes, resourceMetadataUrl } from './well-known.js';

dotenv.config();

const isStdioMode = !process.env.PORT;
if (isStdioMode) {
  const originalConsole = { ...console };
  console.log = (...args) => originalConsole.error(...args);
  console.info = (...args) => originalConsole.error(...args);
  console.warn = (...args) => originalConsole.error(...args);
}

const GONG_API_URL = `${process.env.GONG_API_URL}/v2`;
const GONG_ACCESS_KEY = process.env.GONG_ACCESS_KEY;
const GONG_ACCESS_SECRET = process.env.GONG_ACCESS_SECRET;

if (!GONG_ACCESS_KEY || !GONG_ACCESS_SECRET || !process.env.GONG_API_URL) {
  console.error("Error: GONG_ACCESS_KEY, GONG_ACCESS_SECRET, and GONG_API_URL environment variables are required");
  process.exit(1);
}

const REQUIRED_HTTP_ENVS = [
  "STYTCH_PROJECT_ID",
  "STYTCH_PROJECT_SECRET",
  "STYTCH_PROJECT_DOMAIN",
  "MCP_RESOURCE_URL",
] as const;

if (!isStdioMode) {
  const missing = REQUIRED_HTTP_ENVS.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Error: HTTP mode requires ${missing.join(", ")}`);
    process.exit(1);
  }
}

// Type definitions
interface GongCall {
  id: string;
  title: string;
  scheduled?: string;
  started?: string;
  duration?: number;
  direction?: string;
  system?: string;
  scope?: string;
  media?: string;
  language?: string;
  url?: string;
}

interface GongTranscript {
  speakerId: string;
  topic?: string;
  sentences: Array<{
    start: number;
    text: string;
  }>;
}

interface GongListCallsPageResponse {
  requestId: string;
  records: {
    totalRecords: number;
    currentPageSize: number;
    currentPageNumber: number;
    cursor?: string;
  };
  calls: GongCall[];
}

interface GongListCallsResponse {
  totalRecords: number;
  truncated: boolean;
  calls: GongCall[];
}

interface GongRetrieveTranscriptsResponse {
  transcripts: GongTranscript[];
}

interface GongCallExtensive {
  metaData: {
    id: string;
    url?: string;
    title?: string;
    scheduled?: string;
    started?: string;
    duration?: number;
    primaryUserId?: string;
    direction?: string;
    system?: string;
    scope?: string;
    media?: string;
    language?: string;
    purpose?: string;
    isPrivate?: boolean;
  };
  parties?: Array<{
    id?: string;
    emailAddress?: string;
    name?: string;
    title?: string;
    userId?: string;
    speakerId?: string;
    affiliation?: string;
  }>;
  content?: {
    structure?: Array<{ name: string; duration: number }>;
    topics?: Array<{ name: string; duration?: number }>;
    trackers?: Array<{ id?: string; name: string; count?: number; occurrences?: Array<unknown> }>;
    brief?: string;
    outline?: Array<{ section: string; startTime?: number; duration?: number; items?: Array<{ text: string }> }>;
    highlights?: Array<{ title: string; items: Array<{ text?: string }> }>;
    callOutcome?: { id: string; category: string; name: string };
    keyPoints?: Array<{ text: string }>;
  };
  interaction?: {
    speakers?: Array<{ id: string; userId?: string; talkTime?: number }>;
    questions?: {
      companyCount?: number;
      nonCompanyCount?: number;
    };
    personInteractionStats?: Array<{
      speakerId?: string;
      talkTime?: number;
    }>;
  };
  collaboration?: {
    publicComments?: Array<{
      id?: string;
      commenterUserId?: string;
      comment?: string;
      commentTime?: string;
      duringCall?: boolean;
    }>;
  };
}

interface GongCallsExtensiveResponse {
  requestId: string;
  records: {
    totalRecords: number;
    currentPageSize: number;
    currentPageNumber: number;
    cursor?: string;
  };
  calls: GongCallExtensive[];
}

const ContentSelector = {
  SUMMARY: "summary",
  DETAILED: "detailed",
  FULL: "full",
} as const;

type ContentSelectorPreset = typeof ContentSelector[keyof typeof ContentSelector];

interface GongCallsExtensiveArgs {
  callIds?: string[];
  fromDateTime?: string;
  toDateTime?: string;
  contentSelector?: ContentSelectorPreset;
}

interface GongListCallsArgs {
  [key: string]: string | undefined;
  fromDateTime?: string;
  toDateTime?: string;
}

interface GongRetrieveTranscriptsArgs {
  callIds: string[];
}

const MAX_LIST_CALLS = 500;
const PAGINATION_DELAY_MS = 350; // ~3 req/sec rate limit

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Gong API Client
class GongClient {
  private accessKey: string;
  private accessSecret: string;

  constructor(accessKey: string, accessSecret: string) {
    this.accessKey = accessKey;
    this.accessSecret = accessSecret;
  }

  private async generateSignature(method: string, path: string, timestamp: string, params?: unknown): Promise<string> {
    const stringToSign = `${method}\n${path}\n${timestamp}\n${params ? JSON.stringify(params) : ''}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.accessSecret);
    const messageData = encoder.encode(stringToSign);
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      messageData
    );
    
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  private async request<T>(method: string, path: string, params?: Record<string, string | undefined>, data?: Record<string, unknown>): Promise<T> {
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const timestamp = new Date().toISOString();
      const url = `${GONG_API_URL}${path}`;

      try {
        const response = await axios({
          method,
          url,
          params,
          data,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${this.accessKey}:${this.accessSecret}`).toString('base64')}`,
            'X-Gong-AccessKey': this.accessKey,
            'X-Gong-Timestamp': timestamp,
            'X-Gong-Signature': await this.generateSignature(method, path, timestamp, data || params)
          }
        });

        return response.data as T;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 429 && attempt < maxRetries) {
          const retryAfter = parseInt(error.response.headers['retry-after'] ?? '5', 10);
          console.warn(`Rate limited (429). Retrying after ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})`);
          await delay(retryAfter * 1000);
          continue;
        }
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  }

  async listCalls(fromDateTime?: string, toDateTime?: string): Promise<GongListCallsResponse> {
    const params: GongListCallsArgs = {};
    if (fromDateTime) params.fromDateTime = fromDateTime;
    if (toDateTime) params.toDateTime = toDateTime;

    const allCalls: GongCall[] = [];
    let totalRecords = 0;

    // First page uses date filters
    let page = await this.request<GongListCallsPageResponse>('GET', '/calls', params);
    allCalls.push(...page.calls);
    totalRecords = page.records.totalRecords;

    // Follow cursor for subsequent pages
    while (page.records.cursor && allCalls.length < MAX_LIST_CALLS) {
      await delay(PAGINATION_DELAY_MS);
      page = await this.request<GongListCallsPageResponse>('GET', '/calls', { cursor: page.records.cursor });
      allCalls.push(...page.calls);
    }

    const truncated = allCalls.length > MAX_LIST_CALLS;
    return {
      totalRecords,
      truncated,
      calls: truncated ? allCalls.slice(0, MAX_LIST_CALLS) : allCalls,
    };
  }

  async retrieveTranscripts(callIds: string[]): Promise<GongRetrieveTranscriptsResponse> {
    return this.request<GongRetrieveTranscriptsResponse>('POST', '/calls/transcript', undefined, {
      filter: {
        callIds,
        includeEntities: true,
        includeInteractionsSummary: true,
        includeTrackers: true
      }
    });
  }

  async getCallDetails(args: GongCallsExtensiveArgs, preset: ContentSelectorPreset): Promise<GongCallsExtensiveResponse> {
    const filter: Record<string, unknown> = {};
    if (args.callIds) filter.callIds = args.callIds;
    if (args.fromDateTime) filter.fromDateTime = args.fromDateTime;
    if (args.toDateTime) filter.toDateTime = args.toDateTime;

    return this.request<GongCallsExtensiveResponse>('POST', '/calls/extensive', undefined, {
      filter,
      contentSelector: buildContentSelector(preset),
    });
  }
}

const gongClient = new GongClient(GONG_ACCESS_KEY, GONG_ACCESS_SECRET);

// Build Gong API contentSelector based on detail level preset
function buildContentSelector(preset: ContentSelectorPreset): Record<string, unknown> {
  const content: Record<string, boolean> = {
    brief: true,
    keyPoints: true,
    highlights: true,
    topics: true,
    callOutcome: true,
  };

  if (preset === ContentSelector.DETAILED || preset === ContentSelector.FULL) {
    content.outline = true;
    content.structure = true;
  }

  if (preset === ContentSelector.FULL) {
    content.trackers = true;
  }

  const selector: Record<string, unknown> = {
    context: preset === ContentSelector.FULL ? "Extended" : "None",
    exposedFields: {
      parties: true,
      content,
    },
  };

  if (preset === ContentSelector.DETAILED || preset === ContentSelector.FULL) {
    (selector.exposedFields as Record<string, unknown>).interaction = {
      personInteractionStats: true,
      questions: true,
      speakers: true,
    };
    (selector.exposedFields as Record<string, unknown>).collaboration = {
      publicComments: true,
    };
  }

  return selector;
}

// Tool definitions
const LIST_CALLS_TOOL: Tool = {
  name: "list_calls",
  description: "List Gong calls with optional date range filtering. Returns call details including ID, title, start/end times, participants, and duration. Use this first to discover calls, then use get_call_details to get summaries.",
  inputSchema: {
    type: "object",
    properties: {
      fromDateTime: {
        type: "string",
        description: "Start date/time in ISO format (e.g. 2024-03-01T00:00:00Z)"
      },
      toDateTime: {
        type: "string",
        description: "End date/time in ISO format (e.g. 2024-03-31T23:59:59Z)"
      }
    }
  }
};

const GET_CALL_DETAILS_TOOL: Tool = {
  name: "get_call_details",
  description: "Retrieve detailed call data including AI-generated brief, key points, highlights, topics, call outcome, trackers, participant info, and interaction stats. Use this to understand what a call was about WITHOUT fetching the full transcript. Prefer this over retrieve_transcripts unless you need exact quotes or the full verbatim conversation. Defaults to \"summary\" contentSelector which returns brief, key points, highlights, and topics (~84% fewer tokens). Use \"detailed\" to add the full outline, or \"full\" for everything including CRM context and trackers.",
  inputSchema: {
    type: "object",
    properties: {
      callIds: {
        type: "array",
        items: { type: "string" },
        description: "Array of Gong call IDs to retrieve details for"
      },
      fromDateTime: {
        type: "string",
        description: "Start date/time in ISO format (e.g. 2024-03-01T00:00:00Z). Used when filtering by date range instead of call IDs."
      },
      toDateTime: {
        type: "string",
        description: "End date/time in ISO format (e.g. 2024-03-31T23:59:59Z). Used when filtering by date range instead of call IDs."
      },
      contentSelector: {
        type: "string",
        enum: ["summary", "detailed", "full"],
        description: "Controls response detail level. \"summary\" (default): brief + keyPoints + highlights + topics + parties (no CRM context). ~84% smaller. \"detailed\": summary + outline (no CRM context, no trackers). \"full\": everything (current behavior)."
      }
    }
  }
};

const RETRIEVE_TRANSCRIPTS_TOOL: Tool = {
  name: "retrieve_transcripts",
  description: "Retrieve the full verbatim transcript for specified call IDs. Returns detailed transcripts including speaker IDs, topics, and timestamped sentences. This returns a large amount of data - prefer get_call_details first for summaries, and only use this when you need exact quotes or the full conversation text.",
  inputSchema: {
    type: "object",
    properties: {
      callIds: {
        type: "array",
        items: { type: "string" },
        description: "Array of Gong call IDs to retrieve transcripts for"
      }
    },
    required: ["callIds"]
  }
};

// Server implementation

// Type guards
function isGongListCallsArgs(args: unknown): args is GongListCallsArgs {
  return (
    typeof args === "object" &&
    args !== null &&
    (!("fromDateTime" in args) || typeof (args as GongListCallsArgs).fromDateTime === "string") &&
    (!("toDateTime" in args) || typeof (args as GongListCallsArgs).toDateTime === "string")
  );
}

const VALID_CONTENT_SELECTORS = Object.values(ContentSelector);

function isGongCallsExtensiveArgs(args: unknown): args is GongCallsExtensiveArgs {
  if (typeof args !== "object" || args === null) return false;
  const a = args as Record<string, unknown>;
  if ("callIds" in a && (!Array.isArray(a.callIds) || !a.callIds.every(id => typeof id === "string"))) return false;
  if ("fromDateTime" in a && typeof a.fromDateTime !== "string") return false;
  if ("toDateTime" in a && typeof a.toDateTime !== "string") return false;
  if ("contentSelector" in a && (typeof a.contentSelector !== "string" || !VALID_CONTENT_SELECTORS.includes(a.contentSelector as ContentSelectorPreset))) return false;
  return true;
}

function isGongRetrieveTranscriptsArgs(args: unknown): args is GongRetrieveTranscriptsArgs {
  return (
    typeof args === "object" &&
    args !== null &&
    "callIds" in args &&
    Array.isArray((args as GongRetrieveTranscriptsArgs).callIds) &&
    (args as GongRetrieveTranscriptsArgs).callIds.every(id => typeof id === "string")
  );
}

function createServer(): Server {
  const server = new Server(
    {
      name: "confido-gong",
      title: "Gong (Confido)",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [LIST_CALLS_TOOL, GET_CALL_DETAILS_TOOL, RETRIEVE_TRANSCRIPTS_TOOL],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments?: unknown } }) => {
    try {
      const { name, arguments: args } = request.params;

      if (!args) {
        throw new Error("No arguments provided");
      }

      switch (name) {
        case "list_calls": {
          if (!isGongListCallsArgs(args)) {
            throw new Error("Invalid arguments for list_calls");
          }
          const { fromDateTime, toDateTime } = args;
          const response = await gongClient.listCalls(fromDateTime, toDateTime);
          return {
            content: [{
              type: "text",
              text: JSON.stringify(response, null, 2)
            }],
            isError: false,
          };
        }

        case "get_call_details": {
          if (!isGongCallsExtensiveArgs(args)) {
            throw new Error("Invalid arguments for get_call_details");
          }
          const preset = args.contentSelector ?? ContentSelector.SUMMARY;
          const detailsResponse = await gongClient.getCallDetails(args, preset);
          return {
            content: [{
              type: "text",
              text: JSON.stringify(detailsResponse, null, 2)
            }],
            isError: false,
          };
        }

        case "retrieve_transcripts": {
          if (!isGongRetrieveTranscriptsArgs(args)) {
            throw new Error("Invalid arguments for retrieve_transcripts");
          }
          const { callIds } = args;
          const response = await gongClient.retrieveTranscripts(callIds);
          return {
            content: [{
              type: "text",
              text: JSON.stringify(response, null, 2)
            }],
            isError: false,
          };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

async function runStdio() {
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
}

async function runHttp() {
  const mcpResourceUrl = process.env.MCP_RESOURCE_URL!;
  const stytchProjectDomain = process.env.STYTCH_PROJECT_DOMAIN!;
  const mcpServerBaseUrl = new URL(mcpResourceUrl).origin;
  const wwwAuthenticate = `Bearer resource_metadata="${resourceMetadataUrl(mcpServerBaseUrl)}"`;

  const authenticate = createAuthenticator({
    projectId: process.env.STYTCH_PROJECT_ID!,
    projectSecret: process.env.STYTCH_PROJECT_SECRET!,
    projectDomain: stytchProjectDomain,
    staffEmailDomain: process.env.CONFIDO_STAFF_EMAIL_DOMAIN ?? "confidotech.com",
  });

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  registerWellKnownRoutes(app, {
    resourceUrl: mcpResourceUrl,
    authorizationServerUrl: stytchProjectDomain,
  });

  app.post("/mcp", async (req, res) => {
    const authHeader = req.headers.authorization ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const result = await authenticate(bearer);
    if (!result.ok) {
      res.setHeader("WWW-Authenticate", wwwAuthenticate);
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: `Unauthorized (${result.reason})` },
        id: null,
      });
      return;
    }
    const method = typeof req.body?.method === "string" ? req.body.method : "?";
    console.log(`[${result.user}] ${method}`);

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const port = Number(process.env.PORT);
  app.listen(port, "0.0.0.0", () => {
    console.log(`Gong MCP HTTP server listening on :${port}`);
  });
}

const run = isStdioMode ? runStdio : runHttp;
run().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
