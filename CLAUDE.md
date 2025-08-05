# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Build**: `npm run build` - Compiles TypeScript to JavaScript in the `dist/` directory
- **Start**: `npm start` - Runs the compiled server from `dist/index.js`
- **Development**: Build before testing changes locally

## Architecture Overview

This is a Model Context Protocol (MCP) server that provides Claude with access to Gong's API for retrieving call data and transcripts.

### Core Components

- **GongClient class** (src/index.ts:79-154): Handles Gong API authentication and requests
  - Uses Basic Auth with access key/secret from environment variables
  - Implements HMAC-SHA256 signature generation for API security
  - Provides methods: `listCalls()`, `retrieveTranscripts()`, `getCall()`

- **MCP Tools**: Three main tools exposed to Claude:
  - `list_calls`: Retrieve calls with optional date filtering
  - `retrieve_transcripts`: Get detailed transcripts for specific call IDs
  - `get_call`: Retrieve metadata for a single call by ID

### Configuration

- Requires `GONG_ACCESS_KEY` and `GONG_ACCESS_SECRET` environment variables
- Server connects via stdio transport for MCP communication
- All console output redirected to stderr to avoid interfering with MCP protocol

### Key Patterns

- All API responses are returned as JSON strings in MCP tool responses
- Type guards validate tool arguments before processing
- Error handling returns structured MCP error responses
- Call IDs are consistently handled as strings throughout the codebase