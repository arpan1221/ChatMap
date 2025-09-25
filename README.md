# ChatMap 🗺️

A conversational isochrone mapping tool that combines natural language queries with real-time map visualizations. Ask questions like "coffee shops I can bike to in 15 minutes" and get instant visual results with AI explanations.

## ✨ Features

- **🗣️ Natural Language Queries**: Type conversational requests like "Thai restaurants within 10 minutes walk"
- **🗺️ Real-time Map Visualization**: Interactive maps with isochrones and POI markers
- **🧠 AI-Powered Parsing**: Uses Ollama (Llama 3.2) for intelligent query understanding
- **💾 Memory Integration**: Persistent memory with mem0ai and Qdrant for personalized experiences
- **📱 Mobile-First Design**: Optimized for mobile location queries
- **🔄 Contextual Conversations**: Follow-up queries maintain context (e.g., "how about 15 mins drive?")
- **⚡ Multi-modal Transport**: Walking, driving, cycling, and public transport support
- **🎯 Smart POI Detection**: Automatically categorizes places (restaurants, cafes, pharmacies, etc.)

## 🏗️ Architecture


- **100% Free Stack**: Ollama (local LLM) + OpenRouteService + Overpass API + OpenStreetMap


### System Flow
1. User types: "Thai restaurants I can walk to in 10 minutes"
2. Ollama parses → `{poiType: "restaurant", transport: "walking", timeMinutes: 10}`
3. OpenRouteService generates 10-minute walking isochrone
4. Overpass API finds restaurants within isochrone polygon
5. Ollama generates natural response explaining results
6. Map displays isochrone + POI markers, chat shows explanation

## 🛠️ Tech Stack

### Frontend
- **Next.js 14** with App Router
- **React 19** with TypeScript
- **Tailwind CSS** for styling
- **Leaflet** + **OpenStreetMap** for mapping
- **Lucide React** for icons

### Backend & AI
- **Ollama** (Llama 3.2 3B) for local LLM processing
- **mem0ai** for persistent memory and personalization
- **Qdrant** as vector database for embeddings
- **OpenRouteService** for isochrone generation
- **Overpass API** for POI data from OpenStreetMap
- **Nominatim** for geocoding addresses

### Development
- **TypeScript** for type safety
- **ESLint** for code quality
- **Turbopack** for fast development builds

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+ and npm
- **Docker** (for Qdrant)
- **Ollama** (for local LLM)

### 1. Clone and Install
```bash
git clone <repository-url>
cd chatmap
npm install
```

### 2. Set up Ollama
```bash
# Install Ollama
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Windows: Download from https://ollama.ai/download

# Pull required models
ollama pull nomic-text:latest  # For embeddings
ollama pull llama3.2:3b        # For LLM

# Start Ollama service
ollama serve
```

### 3. Set up Qdrant with Docker
```bash
# Start Qdrant
docker-compose up -d
```

### 4. Configure Environment
Create `.env.local`:
```env
# OpenRouteService API Key (free at https://openrouteservice.org/)
OPENROUTESERVICE_API_KEY=your_api_key_here

# Ollama Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_EMBEDDING_MODEL=nomic-text:latest

# Qdrant Configuration
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=your_qdrant_api_key_here
```

### 5. Run Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

## 🔧 Advanced Setup

### Using the Setup Script
We provide an automated setup script:

```bash
chmod +x setup-local.sh
./setup-local.sh
```

This script will:
- Check prerequisites
- Start Qdrant with Docker Compose
- Verify Ollama is running
- Test the mem0ai configuration
- Start the development server

### Manual mem0ai Setup
For detailed mem0ai configuration, see [setup-mem0-local.md](./setup-mem0-local.md).

## 📱 Usage Examples

### Basic Queries
- "Find coffee shops within 15 minutes walk"
- "Show me restaurants I can drive to in 10 minutes"
- "Where are the nearest pharmacies?"

### Contextual Follow-ups
- Previous: "Find coffee shops within 15 mins walk" → Follow-up: "how about 15 mins drive?"
- Previous: "Show me restaurants I can drive to" → Follow-up: "what about walking distance?"
- Previous: "Find gyms within 10 minutes walk" → Follow-up: "how about 15 minutes?"

### Advanced Queries
- "Upscale Italian restaurants near me"
- "24-hour pharmacies within 20 minutes drive"
- "Find the nearest coffee shop"
- "Mexican places close by"

## 🧠 Memory & Personalization

ChatMap uses mem0ai with Qdrant to provide personalized experiences:

- **User Preferences**: Remembers favorite POI types and transport modes
- **Location History**: Tracks frequently visited locations
- **Conversation Context**: Maintains context across chat sessions
- **Smart Suggestions**: Provides personalized recommendations based on history

## 🗺️ API Endpoints

### Chat API (`/api/chat`)
- **POST** `/api/chat` - Parse queries and generate responses
- Supports both `parse` and `respond` modes
- Integrates with memory system for personalization

### Geocoding API (`/api/geocode`)
- **POST** `/api/geocode` - Convert addresses to coordinates
- Supports address suggestions and autocomplete

### Isochrone API (`/api/isochrone`)
- **POST** `/api/isochrone` - Generate travel time polygons
- Supports walking, driving, cycling, and public transport

### POI API (`/api/pois`)
- **POST** `/api/pois` - Find points of interest within isochrones
- Filters POIs by type, cuisine, and other criteria

### Memory API (`/api/memory`)
- **GET** `/api/memory` - Retrieve user memories and preferences
- **POST** `/api/memory` - Store new memories
- **DELETE** `/api/memory` - Clear user memories

## 🚀 Deployment

### Vercel (Recommended)
1. Push to GitHub
2. Connect to Vercel
3. Add environment variables
4. Deploy

### Docker
```bash
# Build the application
docker build -t chatmap .

# Run with Docker Compose
docker-compose up -d
```

## 🔧 Development

### Available Scripts
```bash
npm run dev      # Start development server with Turbopack
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

### Project Structure
```
src/
├── app/                 # Next.js App Router
│   ├── api/            # API routes
│   └── page.tsx        # Main page
├── components/         # React components
│   ├── Chat.tsx        # Chat interface
│   ├── Map.tsx         # Map component
│   └── ...
└── lib/                # Utilities and types
    ├── memory/         # Memory system
    └── types.ts        # TypeScript definitions
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **OpenStreetMap** contributors for map data
- **OpenRouteService** for isochrone API
- **Ollama** for local LLM capabilities
- **mem0ai** for memory management
- **Qdrant** for vector database
- **Leaflet** for mapping library

## 📞 Support

If you encounter any issues or have questions:

1. Check the [Issues](https://github.com/your-username/chatmap/issues) page
2. Review the setup documentation
3. Ensure all services are running correctly

---

**Built with ❤️ for the open source community**