# Architecture Diagrams - Raw Mermaid Files

This directory contains raw Mermaid (`.mmd`) diagram files for the Unified Honey Data Product Studio architecture.

## Files

### 1. `system-architecture.mmd`
**Type**: Graph (Top-Bottom)  
**Description**: Complete system architecture showing all components, databases, services, and their relationships within the Snowflake Native App.

**Key Components**:
- Application Package Database (UNIFIED_HONEY_APPLICATION)
- Application Database (UNIFIED_HONEY)
- Container Services (SPCS)
- Frontend (Next.js) and Backend (FastAPI)
- Consumer source data and resources
- Authentication and infrastructure

### 2. `data-flow.mmd`
**Type**: Sequence Diagram  
**Description**: Shows the data flow and interaction sequence between user, frontend, backend, and Snowflake components.

**Key Flows**:
- User authentication and access
- Reading source data
- Reading configuration
- Writing transformed data

### 3. `security-architecture.mmd`
**Type**: Graph (Left-Right)  
**Description**: Security architecture showing authentication, network security, data security, and container security layers.

**Key Security Aspects**:
- Authentication & Authorization (OAuth, RBAC)
- Network Security (no external egress)
- Data Security (isolation, read-only access)
- Container Security (base images, CVE scanning)

### 4. `component-interaction.mmd`
**Type**: Graph (Top-Bottom)  
**Description**: Shows how different layers (Frontend, Backend, Data, Infrastructure) interact with each other.

**Key Layers**:
- Frontend Layer (React components, Next.js API routes)
- Backend Layer (FastAPI routers, core modules, SQL templates)
- Data Layer (Snowflake connector, config tables, source/transformed data)
- Infrastructure (Docker container, SPCS runtime, compute resources)

### 5. `deployment-architecture.mmd`
**Type**: Graph (Top-Bottom)  
**Description**: Shows the complete deployment lifecycle from build to activation.

**Key Phases**:
- Build Phase (source code → Docker image)
- Deployment Phase (registry → package → instance)
- Runtime Phase (grant callbacks, resource creation)
- Activation Phase (consumer grants, service startup)

---

## Simplified Diagrams

For high-level overviews and presentations, simplified versions are also available:

### 6. `system-architecture-simple.mmd`
**Type**: Graph (Top-Bottom)  
**Description**: Simplified system architecture showing only the main components and their relationships.

**Key Components**:
- User and Web UI
- Container Service (Next.js + FastAPI)
- Application and Data Databases
- Source Data and Warehouse
- Snowflake Infrastructure

### 7. `data-flow-simple.mmd`
**Type**: Sequence Diagram  
**Description**: Simplified data flow showing the essential interaction sequence.

**Key Flows**:
- User access
- API requests
- Data reading and transformation

### 8. `security-simple.mmd`
**Type**: Graph (Left-Right)  
**Description**: Simplified security architecture showing the four main security layers.

**Key Security Layers**:
- Authentication
- Network Security
- Data Security
- Container Security

### 9. `deployment-simple.mmd`
**Type**: Graph (Left-Right)  
**Description**: Simplified deployment lifecycle showing the four main phases.

**Key Phases**:
- Build → Deploy → Install → Activate

### 10. `architecture-overview-simple.mmd`
**Type**: Graph (Top-Bottom)  
**Description**: High-level architecture overview showing the main application layers.

**Key Layers**:
- User interface
- Frontend and Backend
- Data storage (Config, Data, Source)
- Snowflake platform

---

## Generic Diagrams

For reusable templates and generic documentation:

### 11. `deployment-architecture-generic.mmd`
**Type**: Graph (Top-Bottom)  
**Description**: Generic deployment architecture with placeholder names instead of specific application details.

**Use Cases**:
- Template documentation
- Reusable architecture patterns
- Generic presentations
- Documentation that doesn't need specific naming

**Key Differences from Detailed Version**:
- Uses placeholder names (`<app_name>`, `<app_db>`, etc.)
- Generic image descriptions
- Abstract registry paths
- No specific database or service names

### 10. `architecture-overview-simple.mmd`
**Type**: Graph (Top-Bottom)  
**Description**: High-level architecture overview showing the main application layers.

**Key Layers**:
- User interface
- Frontend and Backend
- Data storage (Config, Data, Source)
- Snowflake platform

## When to Use Which Diagram

### Detailed Diagrams (1-5)
Use the detailed versions when you need:
- Complete technical documentation
- Security questionnaire responses
- Developer onboarding
- Deep technical reviews
- Architecture audits

### Simplified Diagrams (6-10)
Use the simplified versions when you need:
- Executive presentations
- Quick overviews
- High-level documentation
- Stakeholder communications
- Slide decks and demos

## Usage

These `.mmd` files can be used with:

1. **Mermaid Live Editor**: https://mermaid.live/
   - Copy and paste the content to view/edit

2. **VS Code**: 
   - Install "Markdown Preview Mermaid Support" extension
   - Or use "Mermaid Preview" extension

3. **GitHub/GitLab**:
   - These files can be referenced in Markdown files
   - GitHub/GitLab will render Mermaid diagrams automatically

4. **Documentation Tools**:
   - Many documentation platforms support Mermaid
   - Can be embedded in HTML, Markdown, or documentation sites

5. **Mermaid CLI**:
   ```bash
   npm install -g @mermaid-js/mermaid-cli
   mmdc -i system-architecture.mmd -o system-architecture.png
   ```

## Viewing in Markdown

To use these diagrams in Markdown files, wrap them in code blocks:

````markdown
```mermaid
[content from .mmd file]
```
````

## Integration

These diagrams are integrated into:
- `../Architecture Diagram.md` - Main architecture documentation
- `../Native Apps Security Questionnaire - Responses.md` - Security questionnaire responses

All files are located in the `snowflake-question/` directory.

---

**Version**: 1.0  
**Last Updated**: 2024  
**Format**: Mermaid.js

