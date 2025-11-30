# Native Apps Security Questionnaire - Responses

**Organization**: Unified Honey Inc  
**Application Name**: Unified Honey Data Product Studio  
**Contact Email**: simon.yeoman@unifiedhoney.com  
**Snowflake Contact**: Kate Landmann <kate.landmann@snowflake.com>

---

## Application Overview

### What is your application's name?
**Unified Honey Data Product Studio**

### What does your application do?
Provides a repeatable way to go from "raw system data" (historians, IoT, ERP, EAM, CMMS, LIMS, finance systems and more) to "ready-to-consume data models and products" including star schemas (facts and dimensions), semantic views and governed metrics all inside your own Snowflake account.

### What are some of the use cases for the application?

#### Regulatory Reporting
The Studio creates a "golden thread" from raw source systems to final reported numbers, with every transformation, assumption and metric definition captured in Snowflake. This supports defensible internal and external reporting (board packs, regulatory returns, ESG and risk disclosures) with consistent calculations across entities and periods, reducing manual reconciliation and audit effort.

#### Inventory Management
Data Product Studio models stock movements, production runs, work orders and purchase flows into clean, reusable inventory data products. This gives finance and operations a single, reconciled view of inventory positions, ageing and writeoff risk, supporting tighter working-capital control and fewer surprises in monthend and group consolidation.

#### Supply Chain
The platform connects data across suppliers, logistics, production, inventory and finance into end-to-end supply-chain models and KPIs. CFOs and supply-chain leaders can see cost drivers, bottlenecks and service-level impacts on a common metric set, enabling more informed decisions on contracts, capacity, resilience and investment.

#### Financial Planning & Analysis
Unified Honey Data Product Studio brings together operational volumes, costs, contracts and revenue data into governed data products and metrics. This lets CFOs and finance teams analyse margins, price sensitivity and cost-per-unit off a single, trusted model instead of spreadsheet sprawl, supporting better pricing decisions and profitability analysis at group and BU level.

#### Workforce Analytics & Planning
Unifying HRIS, time-and-attendance, rostering, training and safety data into coherent workforce data products and KPIs. Metrics such as headcount, turnover, absenteeism, overtime, contractor mix and training compliance are defined once and reused across dashboards and reports. Because workforce metrics are linked to operational and financial data, HR and business leaders can see how staffing, capability and wellbeing decisions impact productivity, cost and risk.

#### Line of Business Systems
Beyond core ERP and finance, the Data Product Studio can model data from a wide range of line-of-business systems including CRM, LIMS, MES, SCADA, maintenance, scheduling and more into reusable data products.

Each domain gets clean, documented tables, dimensions and metrics that plug into analytics, AI and reporting, while still benefiting from the same engine for data quality, lineage and governance.

### Is your application ready to publish?
**Yes**

---

## Application Architecture

### Security Requirements Compliance
- **I have read the security requirements linked above**
- **My application meets the security requirements linked above**
- **I have read the security best practices**

### All containers in the application

**Single Container Service**: `services.uh_engine_app_service`

The application uses a single containerized service that runs both the frontend (Next.js) and backend (FastAPI) components:

- **Container Name**: `my-service`
- **Image**: `/uh_engine_app_database/public/images/uh_engine_app_service:latest`
- **Base Image**: Multi-stage build:
  - Frontend builder: `node:20-alpine`
  - Final image: `python:3.10-slim`
- **Port**: 8080 (required by Snowflake SPCS)
- **Health Check**: `/health` endpoint on port 8080
- **Readiness Probe**: Port 8080, path `/health`

**Container Components**:
1. **Frontend**: Next.js 14 application (standalone mode) running on port 3000
2. **Backend**: FastAPI application running on port 8080
3. **Startup Script**: `start.sh` orchestrates both services

**Container Environment Variables**:
- `PORT`: 8080
- `SNOWFLAKE_WAREHOUSE`: "NATIVE_APP_WH" (or consumer-provided warehouse)
- `SNOWFLAKE_DATABASE`: "UNIFIED_HONEY_APPLICATION"
- `SNOWFLAKE_SCHEMA`: "CORE"
- `CONFIG_SCHEMA_NAME`: "core"
- `DEPLOYMENT_LOGS_SCHEMA_NAME`: "CORE"

### All public endpoints exposed by the application

**Public Endpoint**: `my-endpoint` on port 8080

The application exposes a single public endpoint through Snowflake's service endpoint system:

- **Endpoint Name**: `my-endpoint`
- **Port**: 8080
- **Public**: Yes (required for web UI access)
- **Service Function**: `services.echo(varchar)` - External function for testing

**API Routes** (accessible via the public endpoint):
- `/health` - Health check endpoint
- `/api/v1/*` - REST API endpoints for:
  - `/utilities` - Utility functions
  - `/blueprints` - Blueprint management
  - `/dimensional-models` - Dimensional model operations
  - `/openflow` - OpenFlow integration
  - `/governance` - Governance features
  - `/dashboard` - Dashboard data
- `/docs` - API documentation (Swagger UI)
- `/api-spec.json` - OpenAPI specification
- `/*` - Next.js frontend routes (proxied from FastAPI)

### All external integrations (provider or 3P services)

**None**

The application does not integrate with any external third-party services or APIs. All operations are performed within the consumer's Snowflake account using:

- Snowflake Container Services (SPCS) for container execution
- Snowflake OAuth authentication for service-to-Snowflake connections
- Snowflake SQL queries for all data operations
- Internal FastAPI-to-Next.js proxy for frontend routing

**No external HTTP/HTTPS calls** are made except:
- Internal `localhost:3000` calls from FastAPI to Next.js (within container)
- Snowflake API calls using the Snowflake Python connector (authenticated via OAuth token)

### Does your application use 0.0.0.0 for egress network rule/external access integration?

**No**

The application does not use `0.0.0.0` for egress network rules. The application does not require external network access and operates entirely within Snowflake's infrastructure.

### If no, please list all egress URLs used by your application

**N/A** - No egress URLs are used. The application operates entirely within Snowflake's infrastructure and does not make external network calls.

### Does your application use any machine learning models not included in the application package?

**No**

The application does not use any machine learning models. It performs data transformation, modeling, and analytics using SQL-based operations within Snowflake.

### Does your application need to download code not included in the application package?

**No**

All code is included in the application package:
- Frontend code is built into Next.js standalone output during Docker build
- Backend Python code is included in the container image
- All dependencies are installed during Docker build (`npm ci` and `pip install`)
- No runtime code downloads or dynamic code loading

### All UDFs

**None**

The application does not create or use User-Defined Functions (UDFs). All data processing is performed through:
- Stored procedures (defined in `app/setup.sql`)
- SQL queries executed via the Snowflake Python connector
- Service functions (e.g., `services.echo`)

### Authentication/Authorization controls

**OAuth (Snowflake Native App Authentication)**

The application uses Snowflake's native OAuth authentication:

1. **Service Authentication**: 
   - Container service authenticates to Snowflake using OAuth token from `/snowflake/session/token`
   - Token is automatically provided by Snowflake SPCS
   - No credentials stored in code or environment variables

2. **User Authentication**:
   - All users must authenticate through Snowflake first
   - Application inherits user's Snowflake session and permissions
   - Access is controlled via Snowflake's role-based access control (RBAC)

3. **Application Role**:
   - `app_public` role is used for application operations
   - Privileges are granted via stored procedures with `EXECUTE AS OWNER`
   - Consumer controls which databases/schemas the application can access via GRANT statements

### Other security controls

**Secured to the current user**

- All operations are executed in the context of the authenticated Snowflake user
- Application uses Snowflake's built-in security model
- No data is stored outside the consumer account
- All data transformations occur within the consumer's Snowflake account
- Consumer controls access via explicit GRANT statements

### Architecture Diagram

**Please provide a link to an architecture diagram showing information flow between all the components**

See **[Architecture Diagram.md](./Architecture%20Diagram.md)** for comprehensive architecture diagrams including:
- System Architecture Overview
- Data Flow Diagram
- Security Architecture
- Component Interaction Diagram
- Deployment Architecture

The architecture diagram is provided in Mermaid.js format and can be viewed in any Markdown viewer that supports Mermaid (GitHub, GitLab, VS Code with Mermaid extension, etc.).

---

## Data Access

### All consumer data accessed by the application

The application accesses consumer data through:

1. **Source Databases** (consumer-granted):
   - Databases, schemas, and tables explicitly granted via `GRANT USAGE` and `GRANT SELECT`
   - Discovered via `SHOW DATABASES`, `SHOW SCHEMAS`, `SHOW TABLES` commands
   - Accessed via SQL queries using Snowflake Python connector

2. **Application Database** (`UNIFIED_HONEY`):
   - Created by the application in the consumer account
   - Contains three schemas:
     - `MODELLING` - Dimensional models and analytical views
     - `SEMANTIC` - Semantic layer and business logic
     - `STORAGE` - Storage layer for nodes, edges, and attributes

3. **Application Configuration Database** (`UNIFIED_HONEY_APPLICATION`):
   - Application package database
   - Contains `CORE` schema with configuration tables:
     - `config_blueprints` - Blueprint definitions
     - `config_blueprint_columns` - Column mappings
     - Other configuration and metadata tables
   - Contains `STAGE` schema for temporary staging objects

**Data Access Pattern**:
- Read-only access to consumer source data (SELECT only)
- Read-write access to application-created databases and schemas
- No access to data not explicitly granted by consumer

### Does your application store any consumer data outside the consumer account?

**No**

All consumer data remains within the consumer's Snowflake account:
- Source data is read but never copied outside the account
- Transformed data is stored in the `UNIFIED_HONEY` database within the consumer account
- Configuration and metadata are stored in the application database within the consumer account
- No data is transmitted to external systems or provider accounts

### If yes, please list all the consumer data stored by the application outside the consumer account

**N/A** - No consumer data is stored outside the consumer account.

### Does your application access any data stored in provider account?

**No**

The application does not access any data from the provider account. All operations are performed within the consumer account using:
- Consumer-granted access to source databases
- Application-created databases within the consumer account
- No cross-account data access

### All provider data accessed from the application that's not included in the app package

**None**

No provider data is accessed. The application package is self-contained and does not reference external data sources.

---

## Security Assurance

### SDLC security activities followed during development

- **Peer reviews** - All code changes are reviewed by team members
- **Static analysis to discover security issues** - Code is reviewed for security vulnerabilities
- **Dependency scans for supply chain risks** - Python and Node.js dependencies are scanned
- **CVE scans** - Regular CVE scanning of dependencies and base images

**Note**: Additional security activities (threat modeling, dynamic security testing, penetration testing) are planned for future releases.

### Vulnerability management activities performed

- **Dependency scans** - Regular scanning of Python (`requirements.txt`) and Node.js (`package.json`) dependencies
- **CVE scans** - Docker images are scanned for CVEs before deployment
- **Patch management** - Dependencies are updated regularly to address security vulnerabilities
- **Vulnerability risk assessment** - Identified vulnerabilities are assessed for risk and impact

### Do you have an incident response plan with published SLAs?

**Yes**

**Contact Information for Security Incidents**:
- **Email**: security@unifiedhoney.com
- **Primary Contact**: Simon Yeoman (simon.yeoman@unifiedhoney.com)
- **Response SLA**: 
  - Critical issues: 4 hours
  - High severity: 24 hours
  - Medium severity: 72 hours

### Do you have a vendor security program?

**Yes**

Unified Honey maintains a vendor security program that includes:
- Vendor risk assessments
- Security requirements for third-party services
- Regular vendor security reviews
- Contractual security obligations

**Details**: The program includes assessment criteria, review schedules, and remediation processes for vendor-related security issues.

### List all applicable certifications

- ⬜ SOC 2
- ⬜ PCI DSS
- ⬜ HIPAA
- ⬜ ISO 27034/27001 compliance
- ⬜ NIST SP 800.218 compliance
- ⬜ Other: _Currently pursuing SOC 2 Type II certification_

**Note**: Certification efforts are ongoing. Current focus is on SOC 2 Type II compliance.

---

## Images

### Does your application use minimal base images (chainguard, distroless, etc.)?

**No**

The application uses standard base images:
- **Frontend builder**: `node:20-alpine` (Alpine Linux-based, minimal)
- **Final image**: `python:3.10-slim` (Debian-based slim image)

**Rationale**: The `python:3.10-slim` image provides a good balance between security and functionality. While not distroless, it is a minimal Debian-based image that excludes unnecessary packages. The Alpine-based Node.js builder further reduces attack surface during the build process.

**Future Enhancement**: We plan to evaluate distroless or Chainguard images for future releases to further reduce attack surface.

### Please provide the path for all custom code developed by you in the image

**Custom Code Paths**:

1. **Backend Python Code**:
   - `/app/` - Main application directory
   - `/app/app.py` - FastAPI application entry point
   - `/app/api/` - API routes and schemas
   - `/app/core/` - Core functionality (Snowflake client, SQL rendering, configuration)
   - `/app/static/` - Static files (Swagger UI assets)

2. **Frontend Next.js Code**:
   - `/app/` - Next.js standalone build (from `.next/standalone`)
   - `/app/.next/static/` - Next.js static assets
   - `/app/public/` - Public assets (logos, images)

3. **Startup Script**:
   - `/app/start.sh` - Container startup script

**Build Process**:
- Frontend is built in multi-stage Docker build using `node:20-alpine`
- Built artifacts are copied to final `python:3.10-slim` image
- All custom code is included in the image at build time

### Have the images in the application been scanned for CVEs?

**Yes**

Docker images are scanned for CVEs using:
- Snowflake's built-in image scanning (when images are pushed to Snowflake registry)
- Local scanning tools during development
- Regular scans as part of CI/CD pipeline

### Do the images contain any critical or high severity CVEs? If yes, please provide an explanation

**No**

Current images do not contain any critical or high severity CVEs. All identified CVEs are:
- Low or medium severity
- In non-runtime dependencies (build tools, etc.)
- Mitigated through image configuration and runtime security

**Ongoing Process**: We maintain a process to monitor and remediate CVEs as they are discovered, including:
- Regular dependency updates
- Base image updates when security patches are available
- CVE monitoring and assessment

### Have the images in the application been scanned for malware?

**Yes**

Images are scanned for malware using:
- Snowflake's security scanning capabilities
- Standard Docker security scanning tools
- No malware has been detected in application images

### Does the container in your application run with a non root user that has minimum privileges required for the application to function?

**No** (Currently runs as root, but this is being addressed)

**Current State**: The container currently runs as root user. This is a known limitation that we are addressing.

**Remediation Plan**:
- Create a non-root user in the Dockerfile
- Set appropriate file permissions
- Update startup script to run as non-root user
- Test thoroughly to ensure all functionality works with reduced privileges

**Target Timeline**: This will be addressed in the next release cycle.

### Are image layers and command history available in the images?

**Yes**

Image layers and command history are available for security auditing:
- Docker build history is preserved
- All RUN commands are visible in image layers
- This enables security teams to audit what was installed and configured

---

## Application

### Please list all the objects created and permissions requested in a consumer account by your application

**Objects Created**:

1. **Database**: `UNIFIED_HONEY`
   - Created with `CREATE DATABASE` privilege
   - Contains schemas: `MODELLING`, `SEMANTIC`, `STORAGE`
   - Contains tags: `Domain`, `Process`, `PII` (in MODELLING schema)

2. **Schemas**:
   - `UNIFIED_HONEY.MODELLING` - Dimensional models
   - `UNIFIED_HONEY.SEMANTIC` - Semantic layer
   - `UNIFIED_HONEY.STORAGE` - Storage layer
   - `<APP_DB>.STAGE` - Staging schema in application database

3. **Tables** (in `UNIFIED_HONEY_APPLICATION.CORE`):
   - `config_blueprints` - Blueprint definitions
   - `config_blueprint_columns` - Column mappings
   - Other configuration and metadata tables

4. **Stored Procedures** (in `UNIFIED_HONEY_APPLICATION.SETUP`):
   - `setup.create_service()` - Creates compute pool and service
   - `setup.suspend_service()` - Suspends the service
   - `setup.resume_service()` - Resumes the service
   - `setup.drop_service_and_pool()` - Cleans up resources
   - `setup.service_status()` - Gets service status
   - `setup.grant_unified_honey_privileges()` - Grants privileges on UNIFIED_HONEY database

5. **Stored Procedures** (in `UNIFIED_HONEY_APPLICATION.CONFIG`):
   - `config.register_warehouse()` - Registers warehouse reference

6. **Service**:
   - `services.uh_engine_app_service` - Container service

7. **Service Function**:
   - `services.echo(varchar)` - Test function

8. **Compute Pool**:
   - `<APP_DB>_app_pool` - Compute pool for the service

**Permissions Requested** (via manifest.yml):

1. **CREATE COMPUTE POOL** (required_at_setup: true)
   - Used to create the compute pool for the container service

2. **BIND SERVICE ENDPOINT** (required_at_setup: true)
   - Used to create and bind the public endpoint

3. **CREATE DATABASE** (required_at_setup: true)
   - Used to create the `UNIFIED_HONEY` database

**Permissions Requested** (via references):

1. **WAREHOUSE Reference** (`consumer_warehouse`):
   - `USAGE` - To use the warehouse for queries
   - `OPERATE` - To start/stop the warehouse
   - Object Type: `WAREHOUSE`

**Permissions Required** (via manual GRANT statements by consumer):

1. **Source Database Access** (consumer-controlled):
   - `GRANT USAGE ON DATABASE <database>` - To access source databases
   - `GRANT USAGE ON SCHEMA <database>.<schema>` - To access schemas
   - `GRANT SELECT ON ALL TABLES IN SCHEMA <database>.<schema>` - To read source tables

2. **Warehouse Access** (if not using reference):
   - `GRANT USAGE ON WAREHOUSE <warehouse>` - To use warehouse
   - `GRANT OPERATE ON WAREHOUSE <warehouse>` - To operate warehouse

### Can any functionality in your application be accessed by a user without that user authenticating through Snowflake first?

**No**

All functionality requires Snowflake authentication:
- Users must be authenticated Snowflake users
- Application inherits user's Snowflake session
- All API calls are authenticated via Snowflake OAuth
- No anonymous or unauthenticated access is possible
- Frontend is served through Snowflake's authenticated endpoint system

---

## Architecture Diagram

**Link to Architecture Diagram**: [Architecture Diagram.md](./Architecture%20Diagram.md)

The architecture diagram document contains multiple detailed diagrams in Mermaid.js format:
1. **System Architecture Overview** - Complete system architecture showing all components
2. **Data Flow Diagram** - Sequence diagram showing data flow between components
3. **Security Architecture** - Security boundaries and authentication flows
4. **Component Interaction Diagram** - How components interact with each other
5. **Deployment Architecture** - Build, deployment, and runtime phases

---

## Additional Information

### Custom Code Locations

All custom code is located in the following paths within the container:

- **Backend**: `/app/` (Python FastAPI application)
- **Frontend**: `/app/` (Next.js standalone build)
- **Static Assets**: `/app/public/`, `/app/.next/static/`
- **Startup Script**: `/app/start.sh`

### Security Notes

1. **No External Dependencies**: The application does not make external API calls or connect to third-party services
2. **Data Isolation**: All consumer data remains within the consumer's Snowflake account
3. **OAuth Authentication**: Uses Snowflake's native OAuth for secure service-to-Snowflake communication
4. **Least Privilege**: Application requests only necessary permissions
5. **Consumer Control**: Consumers control which databases/schemas the application can access

### Compliance and Certifications

- Currently pursuing SOC 2 Type II certification
- Regular security assessments and vulnerability scanning
- Incident response plan in place
- Vendor security program established

---

**Document Version**: 1.0  
**Last Updated**: 2024  
**Prepared By**: Unified Honey Inc Security Team

