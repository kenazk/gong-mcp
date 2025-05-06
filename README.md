# Gong MCP Server

A Model Context Protocol (MCP) server that provides access to Gong's API for retrieving call recordings and transcripts. This server allows Claude to interact with Gong data through a standardized interface.

## Features

- List Gong calls with optional date range filtering
- Retrieve detailed transcripts for specific calls
- Secure authentication using Gong's API credentials
- Standardized MCP interface for easy integration with Claude

## Prerequisites

- Node.js 18 or higher
- Docker (optional, for containerized deployment)
- Gong API credentials (Access Key and Secret)

## Installation

### Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

### Docker

Build the container:
```bash
docker build -t gong-mcp .
```

## Configuring Claude

1. Open Claude Desktop settings
2. Navigate to the MCP Servers section
3. Add a new server with the following configuration:

```json
{
  "command": "docker",
  "args": [
    "run",
    "-i",
    "--rm",
    "-e", "GONG_ACCESS_KEY",
    "-e", "GONG_ACCESS_SECRET",
    "gong-mcp"
  ],
  "env": {
    "GONG_ACCESS_KEY": "your_access_key_here",
    "GONG_ACCESS_SECRET": "your_access_secret_here"
  }
}
```

4. Replace the placeholder credentials with your actual Gong API credentials from your `.env` file

## Available Tools

### List Calls

Retrieves a list of Gong calls with optional date range filtering.

```typescript
{
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
}
```

### Retrieve Transcripts

Retrieves detailed transcripts for specified call IDs.

```typescript
{
  name: "retrieve_transcripts",
  description: "Retrieve transcripts for specified call IDs. Returns detailed transcripts including speaker IDs, topics, and timestamped sentences.",
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
}
```

## License

MIT License - see LICENSE file for details

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request 
