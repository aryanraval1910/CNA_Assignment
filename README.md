
# access key : m4g26SqfmJvYudmVbsaK915NHlbGteazJ7qVrI81

<!-- Outputs:

frontend_url = "http://52.91.221.120:3000"
instance_id = "i-008405721df3dee8b"
instance_public_ip = "52.91.221.120"
rabbitmq_management_url = "http://52.91.221.120:15672" -->

# Logistics Control Tower — Distributed Autonomous Monorepo

A production-grade, distributed, event-driven Logistics Control Tower platform designed to orchestrate freight order lifecycles, carrier assignments, real-time GPS telemetry ingestion, and explainable baseline ETA and delay-risk prediction.

---

## 1. System Architecture

```mermaid
flowchart TD
    Client["Control Tower Dashboard\n(React 18 + Vite + Tailwind + Leaflet)\nPort: 3000 / 5173"]

    subgraph Cluster ["Autonomous Microservices Mesh"]
        MS1["MS1: Order Service\n(Node.js / TypeScript / Express)\nPort: 3001 | MySQL 8.0"]
        MS2["MS2: Shipment Service\n(Node.js / TypeScript / Express)\nPort: 3002 | PostgreSQL 16"]
        MS3["MS3: Tracking Service\n(Python 3.11 / FastAPI)\nPort: 3003 | MongoDB 7.0"]
        MS4["MS4: Prediction Service\n(C++17 / CMake / cpp-httplib)\nPort: 3004 | Native Math Engine"]
    end

    subgraph Messaging ["Message Broker (RabbitMQ)"]
        Broker["Exchange: logistics.events (Topic)\nPort: 5672 | UI: 15672"]
        DLX["Exchange: logistics.dlx (Direct)"]
        DLQ["Queue: logistics.dlq"]
    end

    subgraph Storage ["Autonomous Data Stores"]
        DB1[("MySQL 8.0\nlogistics_orders")]
        DB2[("PostgreSQL 16\nlogistics_shipments")]
        DB3[("MongoDB 7.0\nlogistics_tracking")]
    end

    Client -->|Order Lifecycle API| MS1
    Client -->|Shipment & Fleet API| MS2
    Client -->|Live GPS Telemetry API| MS3
    Client -->|ETA & Delay Risk API| MS4

    MS1 --> DB1
    MS2 --> DB2
    MS3 --> DB3

    MS1 -.->|order.created.v1\norder.confirmed.v1| Broker
    Broker -.->|order.confirmed.v1| MS2
    MS2 -.->|shipment.created.v1\nshipment.status_changed.v1| Broker
    MS3 -.->|tracking.location_received.v1| Broker
    MS4 -.->|REST Query| MS2 & MS3
    Broker -.->|Max Retries Exceeded| DLX --> DLQ
```

---

## 2. Microservice Stack & Service Matrix

| Service | Technology Stack | Port | Primary Database | Key Responsibilities |
| :--- | :--- | :--- | :--- | :--- |
| **MS1 — Order Service** | Node.js, Express, TypeScript | `3001` | MySQL 8.0 (`3306`) | Exact decimal currency math, order lifecycle (`PENDING` $\rightarrow$ `CONFIRMED` $\rightarrow$ `CANCELLED`), idempotency key guarantees, transactional outbox worker. |
| **MS2 — Shipment Service** | Node.js, Express, TypeScript | `3002` | PostgreSQL 16 (`5432`) | Shipment staging, carrier / truck / driver allocation, status transitions, RabbitMQ consumer for `order.confirmed.v1`, outbox publisher. |
| **MS3 — Tracking Service** | Python, FastAPI, Motor | `3003` | MongoDB 7.0 (`27017`) | High-throughput GPS ingestion, latitude/longitude boundary validation, monotonic timestamp fencing, route GeoJSON generation, integrated GPS simulator. |
| **MS4 — Prediction Service** | C++17, CMake, `cpp-httplib` | `3004` | None (Direct HTTP/Math) | Deterministic Great-Circle Haversine distance, speed blending, estimated transit hours, multi-factor delay risk scoring (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`). |
| **Frontend Dashboard** | React 18, Vite, Tailwind CSS, Leaflet | `3000` | Browser State | Real-time KPI metric cards, orders page with create modal, fleet management, live interactive Leaflet OpenStreetMap tracking, shipment deep-dive modal, analytics dashboard. |
| **RabbitMQ Broker** | RabbitMQ 3.13 Management | `5672` (AMQP), `15672` (UI) | In-Memory / Disk Volume | Durable topic exchanges, dead-letter exchanges (`logistics.dlx`), idempotent consumers. |

---

## 3. Quick Start with Docker Compose (Recommended)

To start the complete platform including all 4 microservices, 3 databases, RabbitMQ broker with preconfigured exchanges/queues, and the React frontend dashboard:

```bash
# 1. Clone or enter the workspace
cd e:\map_assignment

# 2. Copy the environment configuration
cp .env.example .env

# 3. Build and launch all 9 containers
docker compose up -d --build
```

### Accessing Running Services & Dashboards

- **Frontend Control Tower Dashboard**: [http://localhost:3000](http://localhost:3000)
- **RabbitMQ Management Dashboard**: [http://localhost:15672](http://localhost:15672) (User: `guest`, Password: `guest`)
- **MS1 Order Service Health**: [http://localhost:3001/health](http://localhost:3001/health)
- **MS2 Shipment Service Health**: [http://localhost:3002/health](http://localhost:3002/health)
- **MS3 Tracking Service Health**: [http://localhost:3003/health](http://localhost:3003/health)
- **MS4 C++ Prediction Service Health**: [http://localhost:3004/health](http://localhost:3004/health)

---

## 4. End-to-End Operational Workflow

The system provides a seamless automated flow across services:

1. **Order Creation (MS1)**:
   Navigate to the **Orders** tab on the frontend (or POST `/api/v1/orders`). Submit an order with item lines and currency.
2. **Order Confirmation & Outbox Event (MS1 $\rightarrow$ MS2)**:
   Click **Confirm** on the pending order. MS1 updates status to `CONFIRMED` and stores `order.confirmed.v1` in its transactional outbox.
3. **Automated Shipment Provisioning (MS2)**:
   The Shipment Service RabbitMQ consumer receives `order.confirmed.v1`, verifies idempotency, and automatically stages a new shipment in PostgreSQL with origin and destination coordinates.
4. **Fleet Carrier Assignment (MS2)**:
   On the **Shipments** tab, click **+ Assign Carrier** to attach a carrier company, vehicle plate, and driver.
5. **GPS Movement Simulation (MS3)**:
   On the **Live Tracking** tab, select the shipment and click **Start / Reset Simulation** or **Advance 1 GPS Waypoint**. MS3 ingests realistic waypoints along the I-5 West Coast highway corridor and publishes `tracking.location_received.v1`.
6. **Real-time Baseline ETA & Delay Risk Prediction (MS4)**:
   Click the eye icon on any shipment to open the **Shipment Deep Dive**. MS4 evaluates remaining Haversine distance, speed, and scheduled delivery window, displaying predicted ETA, risk level, and explanatory factors.

---

## 5. Running Automated Tests

All services include dedicated automated unit and integration tests.

### Run All 5 Suites via Master Script

```powershell
.\tests\run_all_tests.ps1
```

### Run Tests by Service

- **MS1 (Order Service)**:
  ```bash
  cd services/order-service
  npm run test:unit
  ```
  *Result: 21 passed (validation, money arithmetic, idempotency, lifecycle)*

- **MS2 (Shipment Service)**:
  ```bash
  cd services/shipment-service
  npm run test:unit
  ```
  *Result: 5 passed (Zod input validation, coordinates range, state transitions)*

- **MS3 (Tracking Service)**:
  ```bash
  python -m pytest services/tracking-service/tests
  ```
  *Result: 7 passed (bounds validation, bearing calculations, route generation, monotonic timestamp fencing)*

- **MS4 (C++ Prediction Service)**:
  Tested automatically during multi-stage Docker build:
  ```bash
  docker build -t logistics-prediction-service services/prediction-service
  ```
  *Result: test_prediction passed (Haversine distance, speed blending, SLA delay risk scoring)*

- **Frontend Dashboard Build**:
  ```bash
  cd frontend
  npm run build
  ```
  *Result: TypeScript compilation and Vite production bundle generated successfully*

- **Cross-Service Contract & Sanity Suite**:
  ```bash
  python tests/e2e/test_e2e_flow.py
  ```
  *Result: 4 passed (Haversine contract, status machine, monotonic fencing, risk categorizations)*

---

## 6. API Documentation & Postman Collection

- Complete OpenAPI/REST API specification: [`docs/api-spec.md`](./docs/api-spec.md)
- Complete Event-driven RabbitMQ Contracts: [`docs/event-contracts.md`](./docs/event-contracts.md)
- Importable Postman Collection: [`docs/postman_collection.json`](./docs/postman_collection.json)

---

## 7. Clean Shutdown & Cleanup

To stop and remove all containers:

```bash
docker compose down
```

To stop containers and wipe database volumes for a clean reset:

```bash
docker compose down -v
```

---

## 8. CI/CD with GitHub Actions

The repository includes two workflows:

- `.github/workflows/ci.yml` runs service tests, the frontend build, contract tests, Docker Compose validation, and Terraform validation on pull requests and pushes to `main` or `develop`.
- `.github/workflows/deploy.yml` deploys a successful `main` branch push to the existing EC2 instance through AWS Systems Manager (SSM), rebuilds the Docker images sequentially, recreates the Compose services, and checks the frontend. It does not require GitHub-hosted runners to access SSH.

Add these repository-level GitHub Actions secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `AWS_REGION` | `us-east-1` |
| `AWS_ROLE_ARN` | IAM role GitHub Actions may assume through OIDC |
| `EC2_INSTANCE_ID` | Current EC2 instance ID |

The IAM role used by `AWS_ROLE_ARN` must trust GitHub's OIDC provider and restrict the `sub` claim to this repository and its `main` branch. It needs permission to call `ssm:SendCommand`, `ssm:GetCommandInvocation`, and `ec2:DescribeInstances`.

Terraform attaches `AmazonSSMManagedInstanceCore` to the EC2 instance and installs the SSM agent. The EC2 host must already contain the repository at `/opt/logistics-control-tower`, as created by Terraform. The deployment workflow uses the instance metadata service to discover its current public IP and supplies it as `PUBLIC_HOST` to Docker Compose for backend CORS configuration.

For the current AWS account, the deployment role created for `AWS_ROLE_ARN` is:

```text
arn:aws:iam::869987461137:role/logistics-control-tower-github-actions
```

For stable deployments, associate an Elastic IP with the instance; an ordinary EC2 public IP changes after stop/start operations.
