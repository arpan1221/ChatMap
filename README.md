# ChatMap 🗺️

AI-powered conversational isochrone mapping application that combines natural language queries with real-time map visualizations. Ask questions like "coffee shops I can bike to in 15 minutes" and get instant visual results with AI explanations.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)
![Next.js](https://img.shields.io/badge/Next.js-15.5-black)
![Ollama](https://img.shields.io/badge/Ollama-Local%20LLM-green)

[![Watch the video](https://img.shields.io/badge/▶-Watch%20Demo-red?style=for-the-badge&logo=googledrive)](https://drive.google.com/file/d/1BGFxtVCfXXB2BLT-UVvdcCuGUntfclC_/view)

## ⚡ Quick Start

### One-Command Setup

```bash
git clone https://github.com/yourusername/ChatMap.git
cd ChatMap/chatmap
./setup-local.sh  # Automated setup with Ollama + Qdrant
npm run dev       # Runs on http://localhost:3000
```

**Prerequisites:**
- Node.js 18+
- Docker & Docker Compose (for Qdrant vector database)
- Ollama (for local LLM)
- Valid OpenRouteService API key

### Automated Setup (Recommended)

The `setup-local.sh` script handles everything:

```bash
./setup-local.sh
```

This will:
1. ✅ Check prerequisites (Node.js, Docker, Ollama)
2. ✅ Start Qdrant vector database
3. ✅ Download AI models (llama3.2:3b, nomic-embed-text)
4. ✅ Install npm dependencies
5. ✅ Create `.env.local` with your API key
6. ✅ Verify all services are running

### Manual Setup (If Needed)

```bash
# 1. Start Qdrant vector database
docker-compose up -d

# 2. Install Ollama models
ollama pull llama3.2:3b          # Main chat model (~2GB)
ollama pull nomic-embed-text     # Embeddings (~274MB)

# 3. Install dependencies
npm install

# 4. Configure environment
cp .env.example .env.local
# Edit .env.local with your OpenRouteService API key
```

---

## 🎯 Key Features

### **Intelligent Query Processing**
- **Natural Language Understanding**: Parse complex location queries with AI agents
- **Query Classification**: Automatic intent detection (find-nearest, find-within-time, find-near-poi, find-enroute)
- **Multi-Step Reasoning**: Complex queries decomposed into coordinated steps
- **Contextual Follow-ups**: "how about drive then?" maintains previous query context

### **Advanced POI Discovery**
- **4 Query Types Supported**:
  1. Find nearest X → "Find nearest cafe"
  2. Find X within Y minutes → "Find restaurants within 15 min walk"
  3. Find X near nearest Y → "Find coffee shops near the nearest park"
  4. Find X enroute to Y → "Find gas station before airport in 30 mins"

### **Transparent AI Reasoning**
- **Agent Metadata Display**: See how the AI classifies and processes queries
- **Execution Metrics**: Response time, API call count, confidence scores
- **Reasoning Steps**: Step-by-step logic visualization
- **Tool Usage**: Track which tools the agent uses

### **Geospatial Intelligence**
- **Isochrone Generation**: Real-time reachability analysis
- **Route Optimization**: Find optimal stopovers along routes
- **Multi-Modal Transport**: Walking, driving, cycling, public transport
- **POI Filtering**: Polygon-based spatial filtering with Turf.js

### **Memory & Personalization** 🧠
- **Semantic Memory**: Vector-based memory storage with Qdrant
- **User Preferences**: Learns favorite transport modes, POI types, cuisines
- **Conversation History**: Remembers past interactions and context
- **Location Patterns**: Tracks frequently visited places and times
- **Smart Recommendations**: Personalized suggestions based on history
- **Multi-turn Context**: Maintains conversation state across sessions

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │     Chat     │  │     Map      │  │  Agent Metadata    │   │
│  │  Component   │  │  (Leaflet)   │  │     Display        │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────┘   │
│         │                 │                    │                │
│         └─────────────────┴────────────────────┘                │
│                           │                                     │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Routes Layer                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐ │
│  │ /api/    │  │ /api/poi/│  │ /api/    │  │  /api/agent    │ │
│  │  pois    │  │ nearest  │  │ geocode  │  │   (Intelligent │ │
│  │          │  │ near-poi │  │ directions│  │    Routing)    │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬───────┘ │
│       │ Validate    │ Validate     │ Validate         │         │
│       │ + Delegate  │ + Delegate   │ + Delegate       │         │
└───────┼─────────────┼──────────────┼──────────────────┼─────────┘
        │             │              │                  │
        ▼             ▼              ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Agent Orchestration                          │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐ │
│  │     Query      │  │  Simple Query    │  │  Multi-Step     │ │
│  │  Classifier    │→ │     Agent        │  │  Query Agent    │ │
│  │  (LLM-based)   │  │  (1-2 API calls) │  │  (4-7 API calls)│ │
│  └────────────────┘  └────────┬─────────┘  └────────┬────────┘ │
│                               │                      │          │
│                   ┌───────────┴──────────────────────┘          │
│                   │                                             │
│                   ▼                                             │
│          ┌──────────────────┐                                  │
│          │  LangChain Tools │                                  │
│          │  - find_nearest  │                                  │
│          │  - find_within   │                                  │
│          │  - calculate_mtx │                                  │
│          │  - get_directions│                                  │
│          │  - optimize      │                                  │
│          └────────┬─────────┘                                  │
└───────────────────┼──────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Use Cases Layer                           │
│  ┌───────────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │ findNearestPOI│  │findPOIsWithin  │  │  findPOIsNearPOI │  │
│  │               │  │     Time       │  │                  │  │
│  └───────┬───────┘  └────────┬───────┘  └────────┬─────────┘  │
│          │ Business Logic     │                   │            │
│          │ Coordination       │                   │            │
└──────────┼────────────────────┼───────────────────┼────────────┘
           │                    │                   │
           ▼                    ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Client Layer                                │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │   ORS Client │  │   Nominatim  │  │  Overpass Client    │  │
│  │  (Routing &  │  │   Client     │  │  (OSM POI Search)   │  │
│  │  Isochrones) │  │  (Geocoding) │  │                     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘  │
│         │ Retry + Backoff │                     │              │
│         │ Rate Limiting   │                     │              │
└─────────┼─────────────────┼─────────────────────┼──────────────┘
          │                 │                     │
          ▼                 ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     External APIs                                │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │OpenRouteService  │Nominatim OSM │  │  Overpass API      │  │
│  │- Isochrone   │  │- Geocoding   │  │  - POI Search      │  │
│  │- Matrix      │  │- Reverse     │  │  - OSM Data        │  │
│  │- Directions  │  │              │  │                    │  │
│  │- Optimization│  │              │  │                    │  │
│  └──────────────┘  └──────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Ollama (Local LLM)                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  llama3.2:3b - Query Classification & Response Generation│  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Qdrant (Vector DB)                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  nomic-embed-text - Semantic Memory & User Preferences  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### **Architecture Principles**

- **Clean Architecture**: Routes validate, use cases contain logic, clients handle APIs
- **Separation of Concerns**: Clear boundaries between layers
- **Type Safety**: Full TypeScript coverage with Zod validation
- **Error Handling**: Structured error codes with retry logic
- **Observability**: Execution metrics, API call tracking, warnings

---

## 📚 API Documentation

### **Intelligent Agent Endpoint**

```bash
POST /api/agent
Content-Type: application/json

{
  "query": "Find coffee shops within 15 minutes walk",
  "userId": "user123",
  "userLocation": {
    "lat": 51.5074,
    "lng": -0.1278,
    "display_name": "London"
  },
  "memoryEnabled": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "classification": {
      "intent": "find-within-time",
      "complexity": "simple",
      "confidence": 0.95,
      "entities": {
        "primaryPOI": "cafe",
        "timeConstraint": 15,
        "transport": "walking"
      }
    },
    "agentUsed": "SimpleQueryAgent",
    "result": {
      "success": true,
      "data": {
        "pois": [...],
        "count": 25,
        "isochrone": {...}
      },
      "toolsUsed": ["find_pois_within_time"],
      "reasoningSteps": [...]
    }
  }
}
```

### **Core Endpoints**

| Endpoint | Purpose | Complexity |
|----------|---------|------------|
| `POST /api/agent` | Intelligent query routing | Variable |
| `POST /api/pois` | Find POIs within time | Simple (2 API calls) |
| `POST /api/poi/nearest` | Find nearest POI | Simple (2 API calls) |
| `POST /api/poi/near-poi` | Find X near nearest Y | Complex (4 API calls) |
| `POST /api/poi/enroute` | Find POI along route | Complex (5-7 API calls) |
| `POST /api/geocode` | Address to coordinates | Simple (1 API call) |
| `POST /api/directions` | Calculate route | Simple (1 API call) |
| `POST /api/memory` | Store memory | 1 API call + embedding |
| `GET /api/memory` | Search/list memories | Vector search |
| `GET /api/memory/context` | Get user context | Aggregation |

### **Example Queries**

```bash
# Intelligent Agent Query (Recommended)
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Find restaurants within 15 minutes walk",
    "userId": "user123",
    "userLocation": {"lat": 51.5074, "lng": -0.1278, "display_name": "London"},
    "memoryEnabled": true
  }'

# Store User Preference
curl -X POST http://localhost:3000/api/memory \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "content": "User prefers Italian restaurants and walking over driving",
    "type": "preference",
    "metadata": {"cuisine": "italian", "transport": "walking"}
  }'

# Search Memories Semantically
curl "http://localhost:3000/api/memory?userId=user123&query=food%20preferences"

# Get User Context
curl "http://localhost:3000/api/memory/context?userId=user123"
```

---

## 🛠️ Tech Stack

### **Frontend**
- **Next.js 15.5** - React framework with Turbopack
- **TypeScript 5.0** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Leaflet** - Interactive maps
- **Lucide React** - Beautiful icons

### **Backend**
- **Next.js API Routes** - Serverless endpoints
- **LangChain** - Agent orchestration & tool execution
- **Ollama** - Local LLM inference (zero-cost)
- **Zod** - Runtime type validation

### **Geospatial Stack**
- **OpenRouteService** - Routing, isochrones, optimization
- **Nominatim** - Geocoding (OSM)
- **Overpass API** - POI discovery (OSM)
- **Turf.js** - Geospatial analysis

### **AI & Memory Stack** 🧠
- **llama3.2:3b** - Query classification & response generation (~2GB)
- **nomic-embed-text** - 768-dim embeddings for semantic search (~274MB)
- **Qdrant** - High-performance vector database
- **Mem0-style Architecture** - Intelligent user memory system
  - Semantic similarity search
  - Automatic context aggregation
  - User preference learning
  - Conversation history tracking

---

## 📂 Project Structure

```
chatmap/
├── src/
│   ├── app/
│   │   ├── api/              # API route handlers
│   │   │   ├── agent/        # Intelligent agent endpoint
│   │   │   ├── pois/         # POI search
│   │   │   ├── poi/
│   │   │   │   ├── nearest/  # Find nearest POI
│   │   │   │   ├── near-poi/ # Complex multi-step
│   │   │   │   └── enroute/  # Route optimization
│   │   │   ├── geocode/      # Address → coordinates
│   │   │   ├── directions/   # Routing
│   │   │   └── memory/       # User memory
│   │   ├── layout.tsx
│   │   └── page.tsx          # Main application
│   ├── components/
│   │   ├── Chat.tsx          # Chat interface
│   │   ├── Map.tsx           # Leaflet map
│   │   ├── AgentMetadata.tsx # Agent reasoning display
│   │   └── QueryInput.tsx    # Search input
│   ├── agents/
│   │   ├── query-classifier.ts       # LLM-based classification
│   │   ├── simple-query-agent.ts     # Single-step queries
│   │   ├── multi-step-query-agent.ts # Complex queries
│   │   ├── agent-orchestrator.ts     # Agent routing
│   │   ├── tools/index.ts            # LangChain tools
│   │   └── prompts/                  # Prompt templates
│   ├── usecases/
│   │   ├── find-nearest-poi.ts       # Business logic
│   │   ├── find-pois-within-time.ts
│   │   ├── find-pois-near-poi.ts
│   │   ├── find-poi-enroute.ts
│   │   └── types.ts                  # Use case types
│   ├── clients/
│   │   ├── ors-client.ts             # OpenRouteService
│   │   ├── nominatim-client.ts       # Geocoding
│   │   ├── overpass-client.ts        # POI search
│   │   ├── ollama-client.ts          # LLM
│   │   └── memory-client.ts          # Memory system
│   └── lib/
│       ├── types.ts                  # Core types
│       ├── config.ts                 # Configuration
│       ├── retry.ts                  # Retry logic
│       ├── rate-limiter.ts           # Rate limiting
│       └── agent-api.ts              # Agent API client
├── public/                           # Static assets
├── e2e/                             # End-to-end tests
├── .env.local                        # Environment config
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🧪 Testing

### **Health Check**
```bash
curl http://localhost:3000/api/agent
# Should return: {"status":"healthy","data":{...}}
```

### **Query Examples**

**Simple Query:**
```
"Find restaurants within 15 minutes walk"
→ SimpleQueryAgent → 2 API calls → ~2-4s
```

**Complex Query:**
```
"Find coffee shops near the nearest park"
→ MultiStepQueryAgent → 4 API calls → ~5-7s
→ Steps:
  1. Find nearest park
  2. Search cafes near park
  3. Calculate travel times
  4. Sort by distance
```

**Route Optimization:**
```
"Find gas station before airport in 30 mins"
→ MultiStepQueryAgent → 5-7 API calls → ~8-12s
→ Steps:
  1. Geocode destination
  2. Calculate direct route
  3. Find POIs along route
  4. Optimize stopover
  5. Return best route
```

---

## 🚀 Performance


**Memory Performance:**
- ✅ Vector embeddings cached by Ollama
- ✅ Qdrant provides sub-100ms vector search
- ✅ Memory failures don't block main flow
- ✅ Automatic retry with exponential backoff

**Optimization Opportunities:**
- Response caching for common queries
- Parallel API call execution
- Progressive result streaming
- Pre-computed isochrones
- Memory batch operations

---

## 🤝 Contributing

Contributions welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

MIT License - Build amazing location-based AI applications!

---

## 🙏 Acknowledgments

- **OpenRouteService** - Routing and isochrone APIs
- **OpenStreetMap** - POI data via Nominatim & Overpass
- **Ollama** - Local LLM inference
- **LangChain** - Agent orchestration framework
- **Qdrant** - Vector database for memory
- **Leaflet** - Interactive mapping library

---

## 📞 Support

For issues, questions, or feature requests, please open an issue on GitHub.

Built with ❤️ for intelligent location discovery.