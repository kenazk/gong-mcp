#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';

// Redirect all console output to stderr
const originalConsole = { ...console };
console.log = (...args) => originalConsole.error(...args);
console.info = (...args) => originalConsole.error(...args);
console.warn = (...args) => originalConsole.error(...args);

dotenv.config();

const GONG_API_URL = 'https://api.gong.io/v2';
const GONG_ACCESS_KEY = process.env.GONG_ACCESS_KEY;
const GONG_ACCESS_SECRET = process.env.GONG_ACCESS_SECRET;

// Check for required environment variables
if (!GONG_ACCESS_KEY || !GONG_ACCESS_SECRET) {
  console.error("Error: GONG_ACCESS_KEY and GONG_ACCESS_SECRET environment variables are required");
  process.exit(1);
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

interface GongListCallsResponse {
  calls: GongCall[];
}

interface GongRetrieveTranscriptsResponse {
  transcripts: GongTranscript[];
}

interface GongListCallsArgs {
  [key: string]: string | undefined;
  fromDateTime?: string;
  toDateTime?: string;
}

interface GongRetrieveTranscriptsArgs {
  callIds: string | string[];
}

interface GongGetCallsArgs {
  ids: string | string[];
}

interface GongGetCallsForEmailArgs {
  emailAddress: string;
}

interface GongDataForEmailResponse {
  requestId: string;
  emails: unknown[];
  calls: Array<{
    id: string;
    status: string;
    externalSystems: unknown[];
  }>;
  meetings: unknown[];
  customerData: unknown[];
  customerEngagement: unknown[];
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
    const timestamp = new Date().toISOString();
    const url = `${GONG_API_URL}${path}`;
    
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
  }

  async listCalls(fromDateTime?: string, toDateTime?: string): Promise<GongListCallsResponse> {
    const params: GongListCallsArgs = {};
    if (fromDateTime) params.fromDateTime = fromDateTime;
    if (toDateTime) params.toDateTime = toDateTime;

    return this.request<GongListCallsResponse>('GET', '/calls', params);
  }

  async retrieveTranscripts(callIds: string | string[]): Promise<GongRetrieveTranscriptsResponse> {
    const idsArray = typeof callIds === 'string' ? [callIds] : callIds;
    return this.request<GongRetrieveTranscriptsResponse>('POST', '/calls/transcript', undefined, {
      filter: {
        callIds: idsArray,
        includeEntities: true,
        includeInteractionsSummary: true,
        includeTrackers: true
      }
    });
  }

  async getCalls(ids: string | string[]): Promise<GongCall | GongCall[]> {
    if (typeof ids === 'string') {
      try {
        return await this.request<GongCall>('GET', `/calls/${ids}`);
      } catch (error: any) {
        // Handle error gracefully for single calls too
        const statusCode = error?.response?.status || error?.status;
        let reason = 'Unknown error';
        
        if (statusCode === 404) {
          reason = 'Call not found or not accessible (may be scheduled/incomplete)';
        } else if (statusCode === 403) {
          reason = 'Access denied';
        } else if (statusCode === 400) {
          reason = 'Invalid call ID format';
        } else {
          reason = error instanceof Error ? error.message : String(error);
        }
        
        // Return structured error for single calls
        return {
          calls: [],
          skipped: [{ id: ids, reason }],
          summary: `Retrieved 0 calls, skipped 1 calls`
        } as any;
      }
    }
    
    const results: GongCall[] = [];
    const skipped: Array<{id: string, reason: string}> = [];
    
    // Fetch calls sequentially to avoid rate limiting issues
    for (const id of ids) {
      try {
        const call = await this.request<GongCall>('GET', `/calls/${id}`);
        results.push(call);
      } catch (error: any) {
        console.error(`Failed to fetch call ${id}:`, error);
        
        // Handle different error types gracefully
        const statusCode = error?.response?.status || error?.status;
        let reason = 'Unknown error';
        
        if (statusCode === 404) {
          reason = 'Call not found or not accessible (may be scheduled/incomplete)';
        } else if (statusCode === 403) {
          reason = 'Access denied';
        } else if (statusCode === 400) {
          reason = 'Invalid call ID format';
        } else {
          reason = error instanceof Error ? error.message : String(error);
        }
        
        skipped.push({ id, reason });
      }
    }
    
    // Return results with information about skipped calls
    if (skipped.length > 0) {
      const resultWithSkipped = {
        calls: results,
        skipped: skipped,
        summary: `Retrieved ${results.length} calls, skipped ${skipped.length} calls`
      };
      return resultWithSkipped as any; // Cast to maintain return type compatibility
    }
    
    return results;
  }

  async getCallsForEmail(emailAddress: string): Promise<GongDataForEmailResponse['calls']> {
    const response = await this.request<GongDataForEmailResponse>('GET', '/data-privacy/data-for-email-address', { emailAddress });
    return response.calls;
  }
}

const gongClient = new GongClient(GONG_ACCESS_KEY, GONG_ACCESS_SECRET);

// Tool definitions
const LIST_CALLS_TOOL: Tool = {
  name: "list_calls",
  description: "List Gong calls with optional date range filtering. Returns call details including ID, title, start/end times, participants, and duration.",
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

const RETRIEVE_TRANSCRIPTS_TOOL: Tool = {
  name: "retrieve_transcripts",
  description: "Retrieve transcripts for one or more call IDs. Returns detailed transcripts including speaker IDs, topics, and timestamped sentences. Accepts either a single call ID or an array of call IDs.",
  inputSchema: {
    type: "object",
    properties: {
      callIds: {
        oneOf: [
          {
            type: "string",
            description: "A single Gong call ID to retrieve transcript for"
          },
          {
            type: "array",
            items: { type: "string" },
            description: "Array of Gong call IDs to retrieve transcripts for"
          }
        ],
        description: "Either a single call ID string or an array of call ID strings"
      }
    },
    required: ["callIds"]
  }
};

const GET_CALLS_TOOL: Tool = {
  name: "get_calls",
  description: "Retrieve details for one or more Gong calls by ID(s). Returns call metadata including title, participants, duration, and other call details. Accepts either a single call ID or an array of call IDs.",
  inputSchema: {
    type: "object",
    properties: {
      ids: {
        oneOf: [
          {
            type: "string",
            description: "A single Gong call ID to retrieve"
          },
          {
            type: "array",
            items: { type: "string" },
            description: "Array of Gong call IDs to retrieve"
          }
        ],
        description: "Either a single call ID string or an array of call ID strings"
      }
    },
    required: ["ids"]
  }
};

const GET_CALLS_FOR_EMAIL_TOOL: Tool = {
  name: "get_calls_for_email",
  description: "Retrieve all Gong calls associated with a specific email address. Returns call IDs, status, and external system information for meeting preparation.",
  inputSchema: {
    type: "object",
    properties: {
      emailAddress: {
        type: "string",
        description: "The email address to retrieve associated calls for"
      }
    },
    required: ["emailAddress"]
  }
};

// Server implementation
const server = new Server(
  {
    name: "example-servers/gong",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Type guards
function isGongListCallsArgs(args: unknown): args is GongListCallsArgs {
  return (
    typeof args === "object" &&
    args !== null &&
    (!("fromDateTime" in args) || typeof (args as GongListCallsArgs).fromDateTime === "string") &&
    (!("toDateTime" in args) || typeof (args as GongListCallsArgs).toDateTime === "string")
  );
}

function isGongRetrieveTranscriptsArgs(args: unknown): args is GongRetrieveTranscriptsArgs {
  if (typeof args !== "object" || args === null || !("callIds" in args)) {
    return false;
  }
  
  let callIds = (args as any).callIds;
  
  // Handle case where Claude sends JSON-encoded strings
  if (typeof callIds === "string") {
    try {
      const parsed = JSON.parse(callIds);
      if (Array.isArray(parsed)) {
        callIds = parsed;
        (args as any).callIds = callIds; // Update the original args
      }
    } catch {
      // If parsing fails, treat as regular string
    }
  }
  
  return (
    typeof callIds === "string" ||
    (Array.isArray(callIds) && callIds.every((id: unknown) => typeof id === "string"))
  );
}

function isGongGetCallsArgs(args: unknown): args is GongGetCallsArgs {
  if (typeof args !== "object" || args === null || !("ids" in args)) {
    return false;
  }
  
  let ids = (args as any).ids;
  
  // Handle case where Claude sends JSON-encoded strings
  if (typeof ids === "string") {
    try {
      const parsed = JSON.parse(ids);
      if (Array.isArray(parsed)) {
        ids = parsed;
        (args as any).ids = ids; // Update the original args
      }
    } catch {
      // If parsing fails, treat as regular string
    }
  }
  
  return (
    typeof ids === "string" ||
    (Array.isArray(ids) && ids.every((id: unknown) => typeof id === "string"))
  );
}

function isGongGetCallsForEmailArgs(args: unknown): args is GongGetCallsForEmailArgs {
  return (
    typeof args === "object" &&
    args !== null &&
    "emailAddress" in args &&
    typeof (args as GongGetCallsForEmailArgs).emailAddress === "string"
  );
}

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [LIST_CALLS_TOOL, RETRIEVE_TRANSCRIPTS_TOOL, GET_CALLS_TOOL, GET_CALLS_FOR_EMAIL_TOOL],
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

      case "get_calls": {
        if (!isGongGetCallsArgs(args)) {
          throw new Error("Invalid arguments for get_calls");
        }
        const { ids } = args;
        const response = await gongClient.getCalls(ids);
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify(response, null, 2)
          }],
          isError: false,
        };
      }

      case "get_calls_for_email": {
        if (!isGongGetCallsForEmailArgs(args)) {
          throw new Error("Invalid arguments for get_calls_for_email");
        }
        const { emailAddress } = args;
        const response = await gongClient.getCallsForEmail(emailAddress);
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

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
}); 