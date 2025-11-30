# Unified Honey Data Product Studio - Architecture Diagram

## System Architecture Overview

```mermaid
graph TB
    subgraph "Consumer Snowflake Account"
        subgraph "Snowflake Native App"
            subgraph "Application Package Database"
                APP_DB["UNIFIED_HONEY_APPLICATION<br/>(Application Package)"]
                APP_CORE["CORE Schema<br/>- config_blueprints<br/>- config_blueprint_columns<br/>- Other config tables"]
                APP_SETUP["SETUP Schema<br/>- Stored Procedures"]
                APP_CONFIG["CONFIG Schema<br/>- Warehouse registration"]
                APP_STAGE["STAGE Schema<br/>- Temporary objects"]
                APP_SERVICES["SERVICES Schema<br/>- Service functions"]
                
                APP_DB --> APP_CORE
                APP_DB --> APP_SETUP
                APP_DB --> APP_CONFIG
                APP_DB --> APP_STAGE
                APP_DB --> APP_SERVICES
            end
            
            subgraph "Application Database"
                UH_DB["UNIFIED_HONEY<br/>(Created by App)"]
                UH_MOD["MODELLING Schema<br/>- Dimensional models<br/>- Analytical views<br/>- Tags: Domain, Process, PII"]
                UH_SEM["SEMANTIC Schema<br/>- Semantic layer<br/>- Business logic"]
                UH_STOR["STORAGE Schema<br/>- Nodes, edges<br/>- Attributes"]
                
                UH_DB --> UH_MOD
                UH_DB --> UH_SEM
                UH_DB --> UH_STOR
            end
            
            subgraph "Snowflake Container Services"
                COMPUTE_POOL["Compute Pool<br/>&lt;APP_DB&gt;_app_pool<br/>MIN_NODES: 1<br/>MAX_NODES: 1"]
                
                subgraph "Container: my-service"
                    CONTAINER["Docker Container<br/>python:3.10-slim"]
                    
                    subgraph "Frontend Service"
                        NEXTJS["Next.js 14<br/>Port: 3000<br/>Standalone Mode"]
                        NEXTJS_ROUTES["Frontend Routes<br/>- /dashboard<br/>- /model-catalog<br/>- /governance<br/>- /openflow<br/>- etc."]
                        NEXTJS --> NEXTJS_ROUTES
                    end
                    
                    subgraph "Backend Service"
                        FASTAPI["FastAPI<br/>Port: 8080"]
                        API_ROUTES["API Routes<br/>/api/v1/*<br/>- /utilities<br/>- /blueprints<br/>- /dimensional-models<br/>- /governance<br/>- /dashboard<br/>- /openflow"]
                        HEALTH["Health Check<br/>/health"]
                        DOCS["API Docs<br/>/docs<br/>/api-spec.json"]
                        
                        FASTAPI --> API_ROUTES
                        FASTAPI --> HEALTH
                        FASTAPI --> DOCS
                    end
                    
                    STARTUP["start.sh<br/>Orchestrates services"]
                    STARTUP --> NEXTJS
                    STARTUP --> FASTAPI
                    
                    CONTAINER --> STARTUP
                    CONTAINER --> NEXTJS
                    CONTAINER --> FASTAPI
                end
                
                SERVICE["Service<br/>services.uh_engine_app_service"]
                ENDPOINT["Public Endpoint<br/>my-endpoint<br/>Port: 8080"]
                SERVICE_FUNC["Service Function<br/>services.echo(varchar)"]
                
                COMPUTE_POOL --> CONTAINER
                SERVICE --> COMPUTE_POOL
                ENDPOINT --> SERVICE
                SERVICE_FUNC --> ENDPOINT
            end
            
            subgraph "References"
                WAREHOUSE_REF["Warehouse Reference<br/>consumer_warehouse<br/>- USAGE<br/>- OPERATE"]
            end
        end
        
        subgraph "Consumer Source Data"
            SOURCE_DB1["Source Database 1<br/>(Consumer-granted)"]
            SOURCE_DB2["Source Database N<br/>(Consumer-granted)"]
            SOURCE_SCHEMAS["Schemas & Tables<br/>(SELECT granted)"]
            
            SOURCE_DB1 --> SOURCE_SCHEMAS
            SOURCE_DB2 --> SOURCE_SCHEMAS
        end
        
        subgraph "Consumer Resources"
            CONSUMER_WH["Consumer Warehouse<br/>(Referenced)"]
        end
    end
    
    subgraph "Snowflake Infrastructure"
        OAUTH["OAuth Token<br/>/snowflake/session/token"]
        SPCS["Snowflake Container Services<br/>(SPCS)"]
    end
    
    subgraph "User Access"
        USER["Authenticated Snowflake User"]
        WEB_UI["Web UI<br/>(Via Snowflake)"]
        USER --> WEB_UI
    end
    
    %% Connections
    WEB_UI --> ENDPOINT
    ENDPOINT --> FASTAPI
    FASTAPI -.Proxy.-> NEXTJS
    NEXTJS --> NEXTJS_ROUTES
    
    FASTAPI --> APP_CORE
    FASTAPI --> APP_SETUP
    FASTAPI --> APP_CONFIG
    FASTAPI --> UH_MOD
    FASTAPI --> UH_SEM
    FASTAPI --> UH_STOR
    
    FASTAPI --> SOURCE_SCHEMAS
    FASTAPI --> CONSUMER_WH
    
    CONTAINER --> OAUTH
    OAUTH --> SPCS
    SPCS --> SERVICE
    
    WAREHOUSE_REF --> CONSUMER_WH
    
    APP_SETUP -.Creates.-> UH_DB
    APP_SETUP -.Creates.-> SERVICE
    APP_SETUP -.Creates.-> COMPUTE_POOL
    
    style CONTAINER fill:#e1f5ff
    style FASTAPI fill:#fff4e1
    style NEXTJS fill:#e8f5e9
    style UH_DB fill:#f3e5f5
    style SOURCE_SCHEMAS fill:#fff9c4
    style OAUTH fill:#ffebee
```

## Data Flow Diagram

```mermaid
sequenceDiagram
    participant User as Authenticated User
    participant WebUI as Web UI (Next.js)
    participant API as FastAPI Backend
    participant Snowflake as Snowflake (via Connector)
    participant SourceDB as Source Databases
    participant AppDB as UNIFIED_HONEY DB
    participant ConfigDB as Application Config DB
    
    User->>WebUI: Access via Snowflake UI
    WebUI->>API: API Request (/api/v1/*)
    
    Note over API: Authenticates via OAuth token<br/>from /snowflake/session/token
    
    API->>Snowflake: Connect (OAuth)
    Snowflake-->>API: Connection established
    
    alt Read Source Data
        API->>Snowflake: SHOW DATABASES (discover)
        Snowflake-->>API: List of accessible databases
        API->>Snowflake: SELECT FROM source_table
        Snowflake->>SourceDB: Query source data
        SourceDB-->>Snowflake: Return data
        Snowflake-->>API: Query results
        API-->>WebUI: JSON response
    else Read Configuration
        API->>Snowflake: SELECT FROM config tables
        Snowflake->>ConfigDB: Query config
        ConfigDB-->>Snowflake: Config data
        Snowflake-->>API: Configuration
        API-->>WebUI: JSON response
    else Write Transformed Data
        API->>Snowflake: CREATE/INSERT INTO UNIFIED_HONEY
        Snowflake->>AppDB: Write transformed data
        AppDB-->>Snowflake: Confirmation
        Snowflake-->>API: Success
        API-->>WebUI: Success response
    end
    
    WebUI-->>User: Display results
```

## Security Architecture

```mermaid
graph LR
    subgraph "Authentication & Authorization"
        USER_AUTH["User Authentication<br/>Snowflake Login"]
        OAUTH_TOKEN["OAuth Token<br/>Service Authentication"]
        RBAC["Role-Based Access Control<br/>Snowflake RBAC"]
        
        USER_AUTH --> RBAC
        OAUTH_TOKEN --> RBAC
    end
    
    subgraph "Network Security"
        NO_EGRESS["No External Egress<br/>0.0.0.0 not used"]
        INTERNAL_ONLY["Internal Communication<br/>localhost only"]
        SNOWFLAKE_API["Snowflake API Only<br/>Via Connector"]
        
        NO_EGRESS --> INTERNAL_ONLY
        INTERNAL_ONLY --> SNOWFLAKE_API
    end
    
    subgraph "Data Security"
        DATA_ISOLATION["Data Isolation<br/>Consumer Account Only"]
        READ_ONLY_SOURCE["Read-Only Source Access<br/>SELECT only"]
        CONSUMER_CONTROL["Consumer Controls<br/>GRANT/REVOKE"]
        
        DATA_ISOLATION --> READ_ONLY_SOURCE
        READ_ONLY_SOURCE --> CONSUMER_CONTROL
    end
    
    subgraph "Container Security"
        BASE_IMAGE["Minimal Base Image<br/>python:3.10-slim"]
        CVE_SCAN["CVE Scanning<br/>Regular scans"]
        NO_ROOT["Non-Root User<br/>(Planned)"]
        
        BASE_IMAGE --> CVE_SCAN
        CVE_SCAN --> NO_ROOT
    end
    
    USER_AUTH --> DATA_ISOLATION
    OAUTH_TOKEN --> DATA_ISOLATION
    RBAC --> CONSUMER_CONTROL
    NO_EGRESS --> DATA_ISOLATION
    
    style USER_AUTH fill:#e3f2fd
    style OAUTH_TOKEN fill:#e3f2fd
    style DATA_ISOLATION fill:#fff3e0
    style NO_EGRESS fill:#f1f8e9
```

## Component Interaction Diagram

```mermaid
graph TB
    subgraph "Frontend Layer"
        UI_COMPONENTS["React Components<br/>- Dashboard<br/>- Model Catalog<br/>- Governance<br/>- OpenFlow"]
        NEXTJS_API["Next.js API Routes<br/>/api/model-catalog/*"]
        STATE_MGMT["State Management<br/>Zustand + React Query"]
        
        UI_COMPONENTS --> STATE_MGMT
        UI_COMPONENTS --> NEXTJS_API
    end
    
    subgraph "Backend Layer"
        API_ROUTERS["FastAPI Routers<br/>- utilities<br/>- blueprints<br/>- dimensional_models<br/>- governance<br/>- dashboard<br/>- openflow"]
        CORE_MODULES["Core Modules<br/>- snowflake.py<br/>- sql_render.py<br/>- config_loader.py<br/>- references.py"]
        SQL_TEMPLATES["SQL Templates<br/>Jinja2 templates<br/>- create_model.sql<br/>- create_fact_view.sql<br/>- deploy_database.sql"]
        
        API_ROUTERS --> CORE_MODULES
        CORE_MODULES --> SQL_TEMPLATES
    end
    
    subgraph "Data Layer"
        SNOWFLAKE_CONN["Snowflake Connector<br/>OAuth Authentication"]
        CONFIG_TABLES["Configuration Tables<br/>core.config_*"]
        SOURCE_DATA["Source Data<br/>Consumer-granted"]
        TRANSFORMED_DATA["Transformed Data<br/>UNIFIED_HONEY.*"]
        
        SNOWFLAKE_CONN --> CONFIG_TABLES
        SNOWFLAKE_CONN --> SOURCE_DATA
        SNOWFLAKE_CONN --> TRANSFORMED_DATA
    end
    
    subgraph "Infrastructure"
        DOCKER_CONTAINER["Docker Container<br/>Multi-stage build"]
        SPCS_RUNTIME["SPCS Runtime<br/>Snowflake-managed"]
        COMPUTE_RESOURCES["Compute Resources<br/>CPU_X64_XS"]
        
        DOCKER_CONTAINER --> SPCS_RUNTIME
        SPCS_RUNTIME --> COMPUTE_RESOURCES
    end
    
    UI_COMPONENTS -.HTTP.-> API_ROUTERS
    API_ROUTERS --> SNOWFLAKE_CONN
    CORE_MODULES --> SNOWFLAKE_CONN
    SNOWFLAKE_CONN --> DOCKER_CONTAINER
    
    style UI_COMPONENTS fill:#e8f5e9
    style API_ROUTERS fill:#fff4e1
    style SNOWFLAKE_CONN fill:#e1f5ff
    style DOCKER_CONTAINER fill:#f3e5f5
```

## Deployment Architecture

```mermaid
graph TB
    subgraph "Build Phase"
        SOURCE_CODE["Source Code<br/>Git Repository"]
        DOCKERFILE["Dockerfile<br/>Multi-stage build"]
        BUILD_IMAGE["Build Image<br/>node:20-alpine"]
        FINAL_IMAGE["Final Image<br/>python:3.10-slim"]
        
        SOURCE_CODE --> DOCKERFILE
        DOCKERFILE --> BUILD_IMAGE
        BUILD_IMAGE --> FINAL_IMAGE
    end
    
    subgraph "Deployment Phase"
        SNOWFLAKE_REGISTRY["Snowflake Registry<br/>/uh_engine_app_database/public/images/"]
        APP_PACKAGE["Application Package<br/>unified_honey_application_pkg"]
        APP_INSTANCE["Application Instance<br/>unified_honey_application"]
        
        FINAL_IMAGE --> SNOWFLAKE_REGISTRY
        SNOWFLAKE_REGISTRY --> APP_PACKAGE
        APP_PACKAGE --> APP_INSTANCE
    end
    
    subgraph "Runtime Phase"
        GRANT_CALLBACK["Grant Callback<br/>setup.create_service()"]
        COMPUTE_POOL_CREATE["Create Compute Pool"]
        SERVICE_CREATE["Create Service"]
        DB_CREATE["Create UNIFIED_HONEY DB"]
        
        APP_INSTANCE --> GRANT_CALLBACK
        GRANT_CALLBACK --> COMPUTE_POOL_CREATE
        GRANT_CALLBACK --> SERVICE_CREATE
        GRANT_CALLBACK --> DB_CREATE
    end
    
    subgraph "Activation Phase"
        CONSUMER_GRANTS["Consumer Grants<br/>- Warehouse reference<br/>- Source DB access"]
        SERVICE_START["Service Starts<br/>Container running"]
        ENDPOINT_ACTIVE["Endpoint Active<br/>my-endpoint"]
        
        COMPUTE_POOL_CREATE --> CONSUMER_GRANTS
        SERVICE_CREATE --> SERVICE_START
        SERVICE_START --> ENDPOINT_ACTIVE
    end
    
    style FINAL_IMAGE fill:#e8f5e9
    style APP_INSTANCE fill:#fff4e1
    style SERVICE_START fill:#e1f5ff
    style ENDPOINT_ACTIVE fill:#f3e5f5
```

## Key Architecture Notes

### 1. **Single Container Architecture**
- One container runs both frontend (Next.js) and backend (FastAPI)
- Frontend proxies through FastAPI for routing
- Both services started by `start.sh` script

### 2. **Data Isolation**
- All consumer data remains in consumer account
- Application creates `UNIFIED_HONEY` database in consumer account
- No data leaves Snowflake infrastructure

### 3. **Authentication Flow**
- Users authenticate via Snowflake UI
- Container service authenticates via OAuth token
- All operations inherit user's Snowflake permissions

### 4. **Network Security**
- No external egress (0.0.0.0 not used)
- Only internal communication (localhost:3000 for Next.js)
- Snowflake API calls via authenticated connector

### 5. **Permission Model**
- Application requests minimal privileges (CREATE COMPUTE POOL, BIND SERVICE ENDPOINT, CREATE DATABASE)
- Consumer controls source data access via GRANT statements
- Warehouse access via reference binding

### 6. **Scalability**
- Compute pool: MIN_NODES=1, MAX_NODES=1 (can be scaled)
- Container can handle multiple concurrent requests
- FastAPI async/await for concurrent request handling

---

**Diagram Version**: 1.0  
**Last Updated**: 2024  
**Format**: Mermaid.js

