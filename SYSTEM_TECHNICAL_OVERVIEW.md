# Audit Process-Flow Mapper: Technical Overview

## 1. System Purpose

The Audit Process-Flow Mapper converts process walkthrough information into an
editable flowchart or swimlane diagram. Users can paste text, upload supported
documents, or use browser speech recognition. The generated diagram can be
edited, saved, reopened, and exported as JSON or PNG.

Supported inputs:

- Plain text, Markdown, and CSV
- Microsoft Word `.docx`
- PDF
- JPEG, PNG, GIF, and WebP images
- Live speech in browsers supporting the Web Speech API

PDF support currently requires an Anthropic model. Image support depends on the
selected model.

## 2. Current Architecture

| Layer | Technology | Purpose |
|---|---|---|
| Browser client | React 18, TypeScript, Vite | User interface and application state |
| Diagram canvas | React Flow and Dagre | Diagram rendering, editing, and automatic layout |
| Application server | Node.js 20 and Express | REST API, uploads, validation, and static file hosting |
| AI integration | Anthropic SDK or OpenRouter API | Process extraction and diagram refinement |
| Persistence | SQLite through `better-sqlite3` | Stores diagram metadata and graph JSON |
| Shared contract | TypeScript and JSON Schema | Defines and validates the process graph |

The browser communicates with the server through `/api` endpoints. Uploaded
content is held in server memory while it is parsed and sent to the selected AI
provider. The provider returns a structured process graph containing actors,
steps, decisions, controls, systems, and connections. The server validates this
graph before returning it to the browser.

Saved diagrams are stored in a SQLite `diagrams` table. Each record contains an
ID, title, complete graph as JSON, selected view mode, and creation/update
timestamps. SQLite Write-Ahead Logging is enabled.

## 3. Languages and System Requirements

Languages and formats used are TypeScript, JavaScript/JSX, HTML, CSS, SQL,
JSON, and JSON Schema.

Minimum requirements:

- Node.js 20 or later
- npm and access to an approved npm package registry
- Linux or Windows server; Linux x86-64 is the currently verified environment
- Persistent writable storage for the SQLite database
- A modern Chrome or Edge browser; live speech is browser-dependent
- HTTPS and network connectivity to the approved AI endpoint
- At least one AI model configuration for extraction and refinement

The application currently runs as one Node.js process on port `3001`. In
development, Vite also uses port `5173` and proxies API traffic to port `3001`.
Each uploaded file is limited to 25 MB. JSON request bodies are limited to
50 MB.

Installation and verification:

```bash
npm ci
npm run typecheck
npm run build
npm start
```

The production command serves both the REST API and the compiled browser client.
The health endpoint is `GET /api/health`.

Configuration:

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port; default `3001` |
| `DB_PATH` | No | SQLite file location; default `./diagrams.db` |
| `LLM_MODEL` | No | Default model when a request does not select one |
| `ANTHROPIC_API_KEY` | Current provider only | Credential for Anthropic models |
| `OPENROUTER_API_KEY` | Current provider only | Credential for OpenRouter models |

## 4. Main API Interfaces

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Reports service availability and configured providers |
| `POST /api/extract` | Accepts text/files and returns a process graph |
| `POST /api/extract/refine` | Applies instructions or transcript text to a graph |
| `GET /api/diagrams` | Lists saved diagrams |
| `GET /api/diagrams/:id` | Loads a saved diagram |
| `POST /api/diagrams` | Creates a saved diagram |
| `PUT /api/diagrams/:id` | Updates a saved diagram |
| `DELETE /api/diagrams/:id` | Deletes a saved diagram |

## 5. Direct Software Dependencies

Versions below are resolved by the current `package-lock.json`.

| Library | Version | Purpose | License |
|---|---:|---|---|
| React / React DOM | 18.3.1 | Browser user interface | MIT |
| Express | 4.22.2 | HTTP server and API routing | MIT |
| React Flow | 12.11.0 | Interactive diagram canvas | MIT |
| Dagre | 1.1.8 | Automatic graph layout | MIT |
| better-sqlite3 | 11.10.0 | SQLite database access; native module | MIT |
| Anthropic SDK | 0.102.0 | Current Anthropic integration | MIT |
| Multer | 2.1.1 | Multipart file uploads | MIT |
| Mammoth | 1.12.0 | Word document text extraction | BSD-2-Clause |
| html-to-image | 1.11.13 | PNG diagram export | MIT |
| dotenv | 16.6.1 | Local environment configuration | BSD-2-Clause |

Build tooling includes TypeScript 5.9.3, Vite 6.4.3, `tsx` 4.22.4, and the
React Vite plugin. The bank should run its approved software composition
analysis tool against the complete transitive dependency tree and retain an
SBOM before production approval.

## 6. Proposed Bank Deployment

The intended internal deployment is a private AWS environment. Public
Anthropic and OpenRouter calls should be replaced by a provider adapter for the
bank's approved AWS Bedrock API endpoints. Bedrock access should use an IAM
role, private networking, an approved AWS Region and model, and no static AWS
credentials in source code or configuration files.

Recommended baseline:

- Deploy one application instance in a private network behind approved HTTPS
  ingress and network access controls.
- Store SQLite on an encrypted, persistent volume with scheduled snapshots and
  tested restore procedures.
- Store configuration and secrets in the bank's approved secret-management
  service.
- Restrict outbound traffic to approved AWS services and package sources.
- Send application and infrastructure logs to the bank's central monitoring
  platform.
- Run dependency, container, source-code, and penetration testing before go-live.

## 7. Current Limitations and Required Review

The repository is a functional application baseline, not a certified
bank-production platform. It currently has no built-in authentication, SSO,
user-level authorization, diagram ownership, individual audit trail, rate
limiting, malware scanning, or formal retention controls. Network-restricted
shared access therefore cannot identify which individual viewed or changed a
diagram.

SQLite requires a single active application instance and limits horizontal
scaling and automated failover. Uploaded documents may contain confidential
information and must only be sent to an approved model endpoint. Browser speech
recognition must also be reviewed because its processing behavior depends on
the user's browser and enterprise browser policy.

Before production use, the bank should approve the target architecture, data
classification, Bedrock model and region, backup and retention policies,
security controls, capacity expectations, recovery objectives, and operational
support model.
