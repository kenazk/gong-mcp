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

4. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

5. Edit `.env` and replace the values in the configuration file with your Gong credentials.

THe `.env` file is ignored in the `.gitignore` and `.dockerignore` files so it won't be accidentally shared.

### Docker

Build the container:

```bash
docker build -t gong-mcp .
```

You can also use `npm run docker:build` as a shortcut.

Test the container image using environment file (recommended):

```bash
docker run -i --rm --env-file .env gong-mcp
```

Or test with individual environment variables:

```bash
docker run -i --rm  \
  -e GONG_ACCESS_KEY="your_access_key_here" \
  -e GONG_ACCESS_SECRET="your_access_secret_here" \
  gong-mcp
```

Press `CTRL-C` to stop the container.


## Configuring Claude Desktop

1. Open Claude Desktop settings and go to the **Developer** tab.
1. Press **Edit Config**.
1. Open the `claude_desktop_config.json` file in your editor.
1. Navigate to the `mcpServers` section or add it if it doesn't exist.
1. Add a new server with one of the following configurations:

### Option 1: Using Environment File (Recommended)

This keeps credentials out of the Claude Desktop config file:

```json
{
  "mcpServers": {
    "gong": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--env-file",
        "/absolute/path/to/gong-mcp/.env",
        "gong-mcp"
      ]
    }
  }
}
```

Replace `/absolute/path/to/gong-mcp/.env` with the actual absolute path to your
`.env` file. Specify the entire path; you won't be able to use `~/` in the configuration.

### Option 2: Using Inline Environment Variables

This embeds credentials directly in the config file (not ideal:)

```json
{
  "mcpServers": {
    "gong": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e", "GONG_ACCESS_KEY=your_access_key_here",
        "-e", "GONG_ACCESS_SECRET=your_access_secret_here",
        "gong-mcp"
      ]
    }
  }
}
```

Replace `your_access_key_here` and `your_access_secret_here` with your actual Gong API credentials.

---

After configuring, save the file and restart Claude Desktop. You can then ask Claude to list Gong calls and retrieve transcripts.

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
